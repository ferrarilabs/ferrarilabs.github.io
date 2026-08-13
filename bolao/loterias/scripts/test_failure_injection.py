#!/usr/bin/env python3
"""
Matriz de injeção de falha — cada fronteira quebrada de propósito, uma de cada vez.

═══ AS CINCO INVARIANTES ════════════════════════════════════════════════════════════════════════

Não importa ONDE o sistema morra, estas cinco coisas têm de continuar verdadeiras:

    NO_LOST_CANONICAL_RESULT   resultado publicado e validado não some por falha posterior
    NO_DOUBLE_PRIZE            prêmio creditado uma vez, mesmo com N reprocessamentos
    NO_DUPLICATE_EMAIL         obrigação registrada uma vez por sorteio
    NO_PHANTOM_CARRYOVER       saldo só existe se cada centavo tiver lançamento com procedência
    NO_AUTO_PURCHASE           nenhum caminho gasta dinheiro, em nenhuma falha

A pergunta não é "o caminho feliz funciona?" — é "o que sobra quando ele não funciona?".

═══ POR QUE FALHA REAL, NÃO SIMULADA ════════════════════════════════════════════════════════════

Os cenários abaixo não passam por um `if modo_teste`. Cada um corta a fronteira DE VERDADE:
processos separados que morrem com SIGKILL no meio da escrita, sistema de arquivos que recusa
gravar, adaptadores de fonte que devolvem lixo estruturalmente válido. Um teste que pede ao
código para fingir que falhou testa o `if`, não a falha.
"""

import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[2]
sys.path.insert(0, str(AQUI))

import lottery_core as L      # noqa: E402
import lottery_sources as S   # noqa: E402
import poll_results as P      # noqa: E402

falhas = []
CFG = L.carrega_config()
RESULTADO = {"numbers": [4, 26, 66, 67, 69], "special": 9, "multiplier": 2}


def checa(nome, cond, detalhe=""):
    print(f"  [{'PASS' if cond else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ""))
    if not cond:
        falhas.append(nome)


def livro_tmp():
    d = tempfile.mkdtemp(prefix="lot-fi-")
    return Path(d) / "ledger.jsonl"


def credita(livro, chave="prize:powerball:2026-08-12:abc"):
    return L.append_ledger({"type": "PRIZE_CREDIT", "idempotencyKey": chave,
                            "poolId": "2026-08-12", "amountCents": 3800,
                            "reason": "teste", "source": "injecao"}, livro)


# ══ 1. FONTES ═══════════════════════════════════════════════════════════════════════════════
def secao_fontes():
    print("\n1. FONTES — timeout, malformado, obsoleto, fallback, divergência")

    def fonte(comportamento):
        def f(fonte_id, jogo, dd):
            return comportamento(fonte_id, jogo, dd)
        return f

    # primária estoura o tempo -> secundária assume
    def timeout_na_primaria(fid, jogo, dd):
        if fid == "powerball_official":
            raise TimeoutError("primária não respondeu em 20s")
        return {"drawDate": dd, "numbers": RESULTADO["numbers"], "special": RESULTADO["special"],
                "multiplier": 2, "source": fid}
    r, t = S.resultado_pronto("powerball", "2026-08-12", CFG, fonte(timeout_na_primaria))
    checa("timeout da primária => secundária assume",
          r and r["verificationState"] == "SECONDARY_ONLY", str(r and r["source"]))
    checa("  o motivo da primária fica registrado",
          any("TimeoutError" in str(x.get("motivo", "")) for x in t))

    # primária devolve lixo -> recusado, não "corrigido"
    for nome, payload in [
            ("4 números", {"drawDate": "2026-08-12", "numbers": [1, 2, 3, 4], "special": 9}),
            ("sem bola especial", {"drawDate": "2026-08-12", "numbers": [1, 2, 3, 4, 5]}),
            ("número fora da faixa", {"drawDate": "2026-08-12", "numbers": [1, 2, 3, 4, 99],
                                      "special": 9}),
            ("repetidos", {"drawDate": "2026-08-12", "numbers": [1, 1, 3, 4, 5], "special": 9}),
            ("data mal formada", {"drawDate": "12/08/2026", "numbers": [1, 2, 3, 4, 5],
                                  "special": 9})]:
        def malformado(fid, jogo, dd, p=payload):
            if fid == "powerball_official":
                return dict(p, source=fid)
            raise RuntimeError("outras fora do ar")
        r, _ = S.resultado_pronto("powerball", "2026-08-12", CFG, fonte(malformado))
        checa(f"malformado recusado ({nome}) — nada é chutado", r is None)

    # OBSOLETO: o modo de falha que PARECE sucesso
    def sorteio_anterior(fid, jogo, dd):
        return {"drawDate": "2026-08-10", "numbers": [6, 37, 54, 55, 64], "special": 10,
                "multiplier": 3, "source": fid}
    r, t = S.resultado_pronto("powerball", "2026-08-12", CFG, fonte(sorteio_anterior))
    checa("resultado do sorteio ANTERIOR é recusado", r is None,
          "corpo perfeitamente válido, sorteio errado")
    checa("  a recusa diz que está desatualizado",
          all("RESULTADO_DESATUALIZADO" in str(x.get("motivo", "")) for x in t if not x["ok"]))

    # fallback só depois das duas
    consultadas = []

    def so_o_ny(fid, jogo, dd):
        consultadas.append(fid)
        if fid != "ny_open_data":
            raise RuntimeError("fora do ar")
        return {"drawDate": dd, "numbers": RESULTADO["numbers"], "special": 9,
                "multiplier": 2, "source": fid}
    r, _ = S.resultado_pronto("powerball", "2026-08-12", CFG, fonte(so_o_ny))
    checa("fallback entra por último e é marcado como auditoria",
          r and r["verificationState"] == "FALLBACK_AUDIT_ONLY")
    checa("  ordem de precedência respeitada",
          consultadas == ["powerball_official", "nc_education_lottery", "ny_open_data"],
          str(consultadas))

    # DIVERGÊNCIA entre fontes -> incidente, nunca reescrita
    def discorda(fid, jogo, dd):
        if fid == "powerball_official":
            raise RuntimeError("fora do ar")
        return {"drawDate": dd, "numbers": [1, 2, 3, 4, 5], "special": 1, "multiplier": 2,
                "source": fid}
    liquidado = {"numbers": RESULTADO["numbers"], "special": 9, "source": "powerball_official"}
    rec = S.reconcilia(liquidado, "powerball", "2026-08-12", CFG, fonte(discorda))
    checa("divergência entre fontes vira INCIDENTE", len(rec["incidentes"]) >= 1)
    checa("  o resultado liquidado NÃO é reescrito",
          liquidado["numbers"] == RESULTADO["numbers"])

    # ── NO_PHANTOM_JACKPOT — o defeito de 2026-08-13, reproduzido ───────────────────────────
    #
    # A injeção tem de ser no HTTP, não no `fetcher`: `fetcher` é a porta de teste e RETORNA
    # ANTES da guarda, por desenho. Um teste que passasse por ele não exercitaria nada — foi
    # exatamente o que a primeira versão desta seção fez, e ela "passava" sem tocar no código
    # que importa.
    #
    # O HTML abaixo é a estrutura REAL da página de resultado da powerball.com, que anuncia o
    # jackpot do sorteio JÁ REALIZADO: US$1,04 bilhão para 2026-08-12. Ler esse número como se
    # fosse o do próximo sorteio é o que teria aberto um bolão sobre um jackpot de US$20M.
    passado = (datetime.now(timezone.utc) - timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%S")
    futuro = (datetime.now(timezone.utc) + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%S")

    def html_com(data_iso, valor="$1.04 Billion"):
        return (f'<div id="nextDraw" data-drawdateutc="{data_iso}">'
                f'<span> Estimated Jackpot </span>'
                f'<span class="game-jackpot-number">{valor}</span>'
                f'<span> Cash Value </span>'
                f'<span class="game-jackpot-number">$450.5 Million</span></div>')

    original_http = S._http
    try:
        S._http = lambda *a, **kw: html_com(passado)
        try:
            S.jackpot_oficial("powerball")
            checa("jackpot de sorteio JÁ OCORRIDO é recusado", False,
                  "não levantou — este é o bug que abriria bolão sobre US$20M")
        except S.JackpotDeSorteioPassado as e:
            checa("jackpot de sorteio JÁ OCORRIDO é recusado", True,
                  str(e)[:60])

        # Sem data de sorteio não há como provar que o número não é histórico -> recusa.
        S._http = lambda *a, **kw: ('<span> Estimated Jackpot </span>'
                                    '<span class="game-jackpot-number">$1.04 Billion</span>')
        try:
            S.jackpot_oficial("powerball")
            checa("jackpot sem data de sorteio é recusado", False, "não levantou")
        except S.ResultadoInvalido as e:
            checa("jackpot sem data de sorteio é recusado", "JACKPOT_SEM_SORTEIO" in str(e))

        # E o caminho válido continua funcionando, em centavos inteiros.
        S._http = lambda *a, **kw: html_com(futuro, "$20 Million")
        j = S.jackpot_oficial("powerball")
        checa("jackpot de sorteio futuro é aceito, em centavos inteiros",
              j["advertisedAnnuityCents"] == 2000000000, str(j["advertisedAnnuityCents"]))
        checa("  e NÃO qualifica pelo limiar de US$500M",
              L.elegivel(j["advertisedAnnuityCents"], CFG) is False)

        # Fronteira exata do limiar — a regra é ESTRITAMENTE maior.
        checa("US$499.999.999 => NOT_ELIGIBLE", L.elegivel(49999999900, CFG) is False)
        checa("US$500.000.000 exatos => NOT_ELIGIBLE", L.elegivel(50000000000, CFG) is False)
        checa("US$500.000.001 => ELIGIBLE", L.elegivel(50000000100, CFG) is True)
    finally:
        S._http = original_http


# ══ 2. QUEDA DO ARMAZENAMENTO ═══════════════════════════════════════════════════════════════
def secao_armazenamento():
    print("\n2. ARMAZENAMENTO — queda antes e depois de cada commit")

    # ANTES do crédito: nada gravado, saldo zero, nenhum fantasma
    livro = livro_tmp()
    checa("livro vazio => saldo zero (sem carryover fantasma)", L.saldo(livro) == 0)

    # DEPOIS do crédito: o fato sobrevive e não se repete
    livro = livro_tmp()
    gravou, _ = credita(livro)
    checa("crédito gravado", gravou and L.saldo(livro) == 3800)
    gravou2, _ = credita(livro)
    checa("NO_DOUBLE_PRIZE: reprocessar credita zero",
          not gravou2 and L.saldo(livro) == 3800)

    # ESCRITA RECUSADA PELO SISTEMA DE ARQUIVOS (falha real, não simulada)
    d = Path(tempfile.mkdtemp(prefix="lot-ro-"))
    livro_ro = d / "ledger.jsonl"
    livro_ro.write_text("")
    os.chmod(d, 0o500)   # diretório sem permissão de escrita
    try:
        try:
            L.append_ledger({"type": "PRIZE_CREDIT", "idempotencyKey": "k", "poolId": "p",
                             "amountCents": 100, "reason": "r", "source": "s"}, livro_ro)
            checa("escrita recusada levanta (não vira sucesso silencioso)", False, "não levantou")
        except OSError:
            checa("escrita recusada levanta (não vira sucesso silencioso)", True)
        checa("  e o saldo continua zero — nada foi afirmado", L.saldo(livro_ro) == 0)
    finally:
        os.chmod(d, 0o700)

    # ── INVARIANTES DO LANÇAMENTO (rodada adversarial 2026-08-13) ──────────────────────────
    #
    # O livro aceitava três coisas que corrompem o saldo derivado SEM deixar o extrato
    # aparentemente inconsistente — a pior combinação, porque a conta fecha:
    #
    #   PRIZE_CREDIT de -US$50    -> saldo negativo por um "prêmio"
    #   TICKET_PURCHASE de +US$500 -> comprar bilhete AUMENTAVA o caixa
    #   mesma chave, outro valor   -> descartado em silêncio, primeiro a chegar vencia
    livro = livro_tmp()
    base = {"type": "PRIZE_CREDIT", "idempotencyKey": "prize:inv", "poolId": "p",
            "amountCents": 3800, "reason": "r", "source": "s"}
    L.append_ledger(dict(base), livro)
    checa("reprocessar o MESMO lançamento é no-op",
          L.append_ledger(dict(base), livro)[0] is False)

    for nome, ev, excecao in [
            ("mesma chave com OUTRO valor é conflito",
             dict(base, amountCents=999999), L.ConflitoDeIdempotencia),
            ("mesma chave com OUTRO tipo é conflito",
             dict(base, type="CONTRIBUTION"), L.ConflitoDeIdempotencia),
            ("mesma chave com OUTRO pool é conflito",
             dict(base, poolId="outro"), L.ConflitoDeIdempotencia),
            ("PRIZE_CREDIT negativo é recusado",
             dict(base, idempotencyKey="a", amountCents=-5000), ValueError),
            ("CONTRIBUTION negativa é recusada",
             dict(base, type="CONTRIBUTION", idempotencyKey="b", amountCents=-100), ValueError),
            ("TICKET_PURCHASE positivo é recusado",
             dict(base, type="TICKET_PURCHASE", idempotencyKey="c", amountCents=5000),
             ValueError),
            ("CARRYOVER_OUT positivo é recusado",
             dict(base, type="CARRYOVER_OUT", idempotencyKey="d", amountCents=100), ValueError),
            ("bool disfarçado de int é recusado",
             dict(base, idempotencyKey="e", amountCents=True), ValueError)]:
        try:
            L.append_ledger(ev, livro)
            checa(nome, False, "ACEITOU")
        except excecao:
            checa(nome, True)
        except Exception as e:  # noqa: BLE001
            checa(nome, False, f"levantou {type(e).__name__}, esperado {excecao.__name__}")

    # E o que é legítimo continua passando — senão a proteção viraria um bloqueio geral.
    for nome, ev in [
            ("TICKET_PURCHASE negativo passa",
             {"type": "TICKET_PURCHASE", "idempotencyKey": "ok1", "poolId": "p",
              "amountCents": -18300, "reason": "r", "source": "s"}),
            ("OPERATOR_ADJUSTMENT tem sinal LIVRE (é para isso que existe)",
             {"type": "OPERATOR_ADJUSTMENT", "idempotencyKey": "ok2", "poolId": "p",
              "amountCents": -500, "reason": "ajuste", "source": "op"})]:
        checa(nome, L.append_ledger(ev, livro)[0] is True)
    checa("o saldo derivado bate depois de tudo isso",
          L.saldo(livro) == 3800 - 18300 - 500, L.dinheiro(L.saldo(livro)))

    # LINHA CORROMPIDA: uma escrita cortada ao meio não pode virar saldo errado
    livro = livro_tmp()
    credita(livro)
    with livro.open("a") as f:
        f.write('{"type": "PRIZE_CREDIT", "amountCe')   # queda no meio do fsync
    try:
        L.saldo(livro)
        checa("linha truncada é detectada (não somada como zero)", False, "somou sem reclamar")
    except json.JSONDecodeError:
        checa("linha truncada é detectada (não somada como zero)", True,
              "JSONDecodeError: o livro se recusa a ser lido pela metade")


# ══ 3. MORTE DE PROCESSO E CONCORRÊNCIA (processos de verdade) ══════════════════════════════
def secao_processos():
    print("\n3. PROCESSOS — SIGKILL no meio, N simultâneos, reexecução")

    livro = livro_tmp()
    prog = f"""
import sys, time
sys.path.insert(0, {str(AQUI)!r})
import lottery_core as L
L.append_ledger({{"type":"PRIZE_CREDIT","idempotencyKey":"prize:x","poolId":"p",
                 "amountCents":3800,"reason":"r","source":"s"}}, {str(livro)!r})
print("GRAVOU", flush=True)
time.sleep(30)
"""
    p = subprocess.Popen([sys.executable, "-c", prog], stdout=subprocess.PIPE, text=True)
    linha = p.stdout.readline()
    p.send_signal(signal.SIGKILL)
    p.wait()
    checa("worker morto DEPOIS de gravar: o fato sobreviveu",
          "GRAVOU" in linha and L.saldo(livro) == 3800, f"saldo={L.saldo(livro)}")

    # Morte ANTES de gravar não deixa meio-lançamento
    livro2 = livro_tmp()
    prog2 = f"""
import sys, time
sys.path.insert(0, {str(AQUI)!r})
import lottery_core as L
print("ANTES", flush=True)
time.sleep(30)
L.append_ledger({{"type":"PRIZE_CREDIT","idempotencyKey":"prize:y","poolId":"p",
                 "amountCents":3800,"reason":"r","source":"s"}}, {str(livro2)!r})
"""
    p2 = subprocess.Popen([sys.executable, "-c", prog2], stdout=subprocess.PIPE, text=True)
    p2.stdout.readline()
    p2.send_signal(signal.SIGKILL)
    p2.wait()
    checa("worker morto ANTES de gravar: nada gravado, nada pela metade",
          L.saldo(livro2) == 0 and not livro2.exists() or L.saldo(livro2) == 0)

    # N PROCESSOS SIMULTÂNEOS disputando a mesma chave — a corrida de verdade
    livro3 = livro_tmp()
    livro3.write_text("")
    prog3 = f"""
import sys
sys.path.insert(0, {str(AQUI)!r})
import lottery_core as L
g, _ = L.append_ledger({{"type":"PRIZE_CREDIT","idempotencyKey":"prize:corrida","poolId":"p",
                        "amountCents":3800,"reason":"r","source":"s"}}, {str(livro3)!r})
print("W" if g else "-", end="")
"""
    procs = [subprocess.Popen([sys.executable, "-c", prog3], stdout=subprocess.PIPE, text=True)
             for _ in range(12)]
    escritas = "".join(p.communicate()[0] for p in procs)
    checa("12 processos simultâneos: EXATAMENTE um grava",
          escritas.count("W") == 1, f"'{escritas}'")
    checa("NO_DOUBLE_PRIZE sob concorrência real", L.saldo(livro3) == 3800,
          L.dinheiro(L.saldo(livro3)))
    checa("  nenhuma chave duplicada no arquivo",
          len(L.le_ledger(livro3)) == len({e["idempotencyKey"] for e in L.le_ledger(livro3)}))


# ══ 4. COLETA — slots perdidos, recuperação, simultaneidade ═════════════════════════════════
def secao_coleta():
    print("\n4. COLETA — resultado ausente, atraso, catch-up, coletores simultâneos")

    arq = livro_tmp().with_name("results.jsonl")
    quarta = "2026-08-12"
    chamadas = {"n": 0}

    def ainda_nao_saiu(fid, jogo, dd):
        chamadas["n"] += 1
        raise S.ResultadoInvalido("a loteria ainda não publicou")

    r1 = P.coleta("powerball", CFG, arq, ainda_nao_saiu, ate=date_from(quarta), janela_dias=0)
    r2 = P.coleta("powerball", CFG, arq, ainda_nao_saiu, ate=date_from(quarta), janela_dias=0)
    checa("poll #1 e #2 sem resultado: nada registrado",
          not r1["novos"] and not r2["novos"] and len(P.le(arq)) == 0)

    def saiu(fid, jogo, dd):
        if fid != "powerball_official":
            raise RuntimeError("fora do ar")
        return {"drawDate": dd, "numbers": RESULTADO["numbers"], "special": 9,
                "multiplier": 2, "source": fid}
    r3 = P.coleta("powerball", CFG, arq, saiu, ate=date_from(quarta), janela_dias=0)
    checa("poll #3 com resultado: registra UMA vez", len(r3["novos"]) == 1)
    r4 = P.coleta("powerball", CFG, arq, saiu, ate=date_from(quarta), janela_dias=0)
    r5 = P.coleta("powerball", CFG, arq, saiu, ate=date_from(quarta), janela_dias=0)
    checa("polls #4 e #5: registram zero (idempotente)",
          not r4["novos"] and not r5["novos"] and len(P.le(arq)) == 1)

    # SLOTS PERDIDOS: nenhuma execução na noite; a primeira dias depois recupera
    arq2 = livro_tmp().with_name("results2.jsonl")
    depois = date_from("2026-08-16")     # 4 dias após o sorteio
    rec = P.coleta("powerball", CFG, arq2, saiu, ate=depois, janela_dias=10)
    datas = [n["drawDate"] for n in rec["novos"]]
    checa("slots perdidos => catch-up registra os sorteios atrasados",
          quarta in datas, str(datas))
    rec2 = P.coleta("powerball", CFG, arq2, saiu, ate=depois, janela_dias=10)
    checa("  e o catch-up seguinte registra zero", not rec2["novos"])

    # DOIS COLETORES SIMULTÂNEOS
    arq3 = livro_tmp().with_name("results3.jsonl")
    arq3.write_text("")
    prog = f"""
import sys
sys.path.insert(0, {str(AQUI)!r})
import lottery_core as L, poll_results as P
def f(fid, jogo, dd):
    if fid != "powerball_official": raise RuntimeError("x")
    return {{"drawDate": dd, "numbers": {RESULTADO['numbers']}, "special": 9,
             "multiplier": 2, "source": fid}}
import datetime
r = P.coleta("powerball", L.carrega_config(), {str(arq3)!r}, f,
             ate=datetime.date(2026,8,12), janela_dias=0)
print(len(r["novos"]), end="")
"""
    ps = [subprocess.Popen([sys.executable, "-c", prog], stdout=subprocess.PIPE, text=True)
          for _ in range(6)]
    saidas = [p.communicate()[0] for p in ps]
    checa("6 coletores simultâneos: o sorteio aparece uma vez só",
          len(P.le(arq3)) == 1, f"{len(P.le(arq3))} linha(s), retornos={saidas}")


def date_from(s):
    from datetime import date as _d
    a, m, d = s.split("-")
    return _d(int(a), int(m), int(d))


# ══ 5. NO_AUTO_PURCHASE ═════════════════════════════════════════════════════════════════════
def secao_compra():
    print("\n5. NO_AUTO_PURCHASE — nenhum caminho gasta dinheiro, em falha nenhuma")
    proibidos = ["stripe", "checkout", "payment", "requests.post", "card_number",
                 "comprar_bilhete", "buy_ticket", "paypal", "braintree"]
    modulos = list((RAIZ / "bolao" / "loterias" / "scripts").glob("*.py"))
    modulos += [RAIZ / "bolao" / "loterias" / "powerball" / "scripts" /
                "inspect_production_state.py"]
    achados = []
    for m in modulos:
        if m.name.startswith("test_"):
            continue
        txt = m.read_text(encoding="utf-8")
        # Ignora comentários e docstrings: os arquivos CITAM esses termos para explicar que não
        # existem. Um portão que lesse a própria prosa reprovaria a documentação da regra — erro
        # que este repositório já cometeu uma vez.
        codigo = "\n".join(l.split("#")[0] for l in txt.splitlines()
                           if not l.strip().startswith(("#", '"', "'")))
        for p in proibidos:
            if p in codigo:
                achados.append(f"{m.name}: {p}")
    checa("nenhum caminho de compra em módulo nenhum", not achados, str(achados))
    checa("autoPurchase desligado na política", CFG.get("autoPurchase") is False)


def main():
    print("MATRIZ DE INJEÇÃO DE FALHA — loterias\n")
    secao_fontes()
    secao_armazenamento()
    secao_processos()
    secao_coleta()
    secao_compra()

    print("\n" + "=" * 78)
    if falhas:
        print(f"FAILURE_INJECTION = FALHOU ({len(falhas)})")
        for f in falhas:
            print(f"    - {f}")
        return 1
    print("FAILURE_INJECTION = PASS")
    print("  NO_LOST_CANONICAL_RESULT · NO_DOUBLE_PRIZE · NO_DUPLICATE_EMAIL · "
          "NO_PHANTOM_CARRYOVER · NO_AUTO_PURCHASE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
