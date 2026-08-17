#!/usr/bin/env python3
"""
Coleta idempotente de resultado oficial — para os dois jogos, com recuperação de atraso.

═══ POR QUE NÃO BASTA "RODAR NA NOITE DO SORTEIO" ═══════════════════════════════════════════════

O agendador do GitHub Actions não garante horário: sob carga, uma janela agendada simplesmente não
dispara. Se a coleta dependesse de UMA execução, um slot perdido viraria resultado perdido — e o
sorteio de 2026-08-10 já mostrou o outro lado: o resultado oficial saiu DEPOIS da janela da noite,
e a execução que deveria pegá-lo havia terminado.

Então este script não tem "a hora certa". Ele responde sempre à mesma pergunta — "existe sorteio
recente sem resultado registrado?" — e registra o que encontra. Rodar cedo demais não faz nada,
rodar tarde recupera, rodar dez vezes registra uma vez. Slot perdido vira ATRASO, nunca perda.

═══ O ARQUIVO É APPEND-ONLY, COMO O LIVRO-RAZÃO ═════════════════════════════════════════════════

Cada linha é um resultado certificado com procedência (fonte, estado de verificação, hash). A
chave de idempotência é jogo+data. Um resultado já registrado NÃO é sobrescrito nem quando a fonte
muda de ideia: divergência vira incidente, porque um resultado que já pagou prêmio não pode ser
trocado em silêncio.

Este script NÃO envia e-mail, NÃO credita prêmio e NÃO compra nada. Ele só registra o que a fonte
oficial publicou.
"""

import argparse
import fcntl
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[2]
sys.path.insert(0, str(AQUI))

import lottery_core as L      # noqa: E402
import lottery_sources as S   # noqa: E402

ARQUIVO = RAIZ / "bolao" / "loterias" / "config" / "lottery_results.jsonl"

DIAS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
        "friday": 4, "saturday": 5, "sunday": 6}


def le(caminho=None):
    p = Path(caminho or ARQUIVO)
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def sorteios_esperados(jogo, cfg, ate=None, janela_dias=10):
    """
    Datas de sorteio do jogo nos últimos `janela_dias`, da mais recente para a mais antiga.

    A janela é o que dá a RECUPERAÇÃO: mesmo que o agendador falhe vários dias seguidos, a
    primeira execução que rodar depois ainda enxerga os sorteios perdidos e os registra. Uma
    coleta que só olhasse "hoje" trataria slot perdido como sorteio inexistente.
    """
    ate = ate or datetime.now(timezone.utc).date()
    dias = {DIAS[d] for d in cfg["games"][jogo]["drawDays"]}
    return [ate - timedelta(days=n) for n in range(janela_dias + 1)
            if (ate - timedelta(days=n)).weekday() in dias]


def ja_registrado(registros, jogo, dia):
    return any(r["game"] == jogo and r["drawDate"] == str(dia) for r in registros)


def coleta(jogo, cfg=None, caminho=None, fetcher=None, ate=None, janela_dias=10):
    """
    Registra os sorteios ainda ausentes. Devolve o relatório.

    Um sorteio cuja fonte ainda não publicou NÃO é erro: é o estado normal de quase toda execução
    (o cron roda de dez em dez minutos a noite inteira). Ele entra em `pendentes` com o motivo de
    cada fonte, que é o que transforma "não saiu" em diagnóstico.
    """
    cfg = cfg or L.carrega_config()
    caminho = Path(caminho or ARQUIVO)
    registros = le(caminho)
    rel = {"game": jogo, "novos": [], "ja_tinha": [], "pendentes": [], "incidentes": []}

    for dia in sorteios_esperados(jogo, cfg, ate, janela_dias):
        if ja_registrado(registros, jogo, dia):
            rel["ja_tinha"].append(str(dia))
            continue
        resultado, tentativas = S.resultado_pronto(jogo, str(dia), cfg, fetcher)
        if not resultado:
            rel["pendentes"].append({"drawDate": str(dia), "tentativas": tentativas})
            continue

        resultado["resultHash"] = L.hash_resultado(jogo, str(dia), resultado)
        linha = {"game": jogo, "drawDate": str(dia),
                 "numbers": resultado["numbers"], "special": resultado["special"],
                 "multiplier": resultado.get("multiplier"),
                 "source": resultado.get("source"),
                 "verificationState": resultado.get("verificationState"),
                 "resultHash": resultado["resultHash"],
                 "recordedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}

        caminho.parent.mkdir(parents=True, exist_ok=True)
        # Relê sob a mesma disciplina do livro-razão: entre a checagem lá em cima e esta escrita
        # cabe outra execução inteira. Sem reconferir, dois workers registram o mesmo sorteio.
        #
        # RECONFERIR NÃO BASTA, E ISSO FOI MEDIDO. A releitura sozinha continua sendo
        # check-then-act: entre `le()` e o `write()` cabe outro processo inteiro. Com seis
        # coletores simultâneos o sorteio foi gravado DUAS vezes no runner Linux do CI
        # (retornos `['1','0','1','0','0','0']`) — o mesmo teste passava no macOS só porque o
        # escalonamento serializava por sorte. Uma corrida que depende do escalonador não está
        # consertada, está escondida.
        #
        # A produção serializa por outro caminho (`concurrency: lottery-poll` em
        # lottery_poll.yml), então isto não é um incidente aberto — é a trava que faltava para a
        # invariante valer pelo próprio código, e não por uma propriedade do YAML que alguém pode
        # remover sem perceber a consequência. Sorteio duplicado credita prêmio duas vezes.
        trava = caminho.with_name(caminho.name + ".lock")
        with trava.open("w", encoding="utf-8") as lf:
            fcntl.flock(lf, fcntl.LOCK_EX)          # liberado no fim do `with`, inclusive no continue
            atuais = le(caminho)
            if ja_registrado(atuais, jogo, dia):
                rel["ja_tinha"].append(str(dia))
                continue
            with caminho.open("a", encoding="utf-8") as f:
                f.write(json.dumps(linha, ensure_ascii=False, sort_keys=True) + "\n")
                f.flush()
                os.fsync(f.fileno())                # o próximo a pegar a trava precisa ENXERGAR a linha
        registros.append(linha)
        rel["novos"].append(linha)
    return rel


def confere_divergencia(caminho=None, cfg=None, fetcher=None):
    """
    Reconfere o registrado contra as demais fontes. NUNCA reescreve — divergência vira incidente.

    Um resultado já registrado pode ter creditado prêmio. Trocá-lo por baixo apagaria o motivo de
    alguém ter recebido o que recebeu.
    """
    cfg = cfg or L.carrega_config()
    incidentes = []
    for r in le(caminho):
        rec = S.reconcilia(r, r["game"], r["drawDate"], cfg, fetcher)
        incidentes += rec["incidentes"]
    return incidentes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", default="all", choices=["all", "powerball", "megamillions"])
    ap.add_argument("--file", default=str(ARQUIVO))
    ap.add_argument("--window", type=int, default=10)
    ap.add_argument("--reconcile", action="store_true")
    args = ap.parse_args()

    cfg = L.carrega_config()
    jogos = list(cfg["games"]) if args.game == "all" else [args.game]
    saiu_algo, houve_incidente = False, False

    for jogo in jogos:
        rel = coleta(jogo, cfg, args.file, janela_dias=args.window)
        print(f"\n{cfg['games'][jogo]['label'].upper()}")
        for n in rel["novos"]:
            print(f"  NOVO      {n['drawDate']}  {n['numbers']} | {n['special']}"
                  f"  mult={n['multiplier']}  {n['verificationState']} ({n['source']})")
            saiu_algo = True
        if rel["ja_tinha"]:
            print(f"  JA TINHA  {', '.join(sorted(rel['ja_tinha'], reverse=True))}"
                  f"   (reprocessar registrou zero)")
        for p in rel["pendentes"]:
            motivos = "; ".join(f"{t['source']}: {t.get('motivo', 'ok')}"
                                for t in p["tentativas"] if not t.get("ok"))
            print(f"  PENDENTE  {p['drawDate']} — {motivos[:150]}")

    if args.reconcile:
        inc = confere_divergencia(args.file, cfg)
        print(f"\nRECONCILIACAO: {len(inc)} incidente(s)")
        for i in inc:
            print(f"  DIVERGENCIA {i['game']} {i['drawDate']}: liquidado={i['liquidado']} "
                  f"{i['fonte']} trouxe={i['trouxe']}")
            houve_incidente = True

    print(f"\nPOLL_NEW_RESULTS = {'YES' if saiu_algo else 'NO'}")
    # Divergência entre fontes é a única coisa aqui que exige gente. "Ainda não publicaram" é o
    # estado normal de quase toda execução e não pode pintar o painel de vermelho — ruído
    # constante é como uma falha de verdade passa despercebida.
    return 1 if houve_incidente else 0


if __name__ == "__main__":
    sys.exit(main())
