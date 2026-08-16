#!/usr/bin/env python3
"""
BR2026 — FECHAMENTO DE RODADA E E-MAIL POS-APITO-FINAL. Gate hermetico e generico.

─── POR QUE ESTE ARQUIVO EXISTE ────────────────────────────────────────────────────────────────

O e-mail de rodada e irreversivel e vai para gente real que pagou entrada. Ele so pode sair
depois que a rodada INTEIRA acabou, com a pontuacao e a classificacao ja finalizadas, e
exatamente uma vez por destinatario. Cada uma dessas tres coisas ja falhou nesta plataforma:

  · a R21 travou num jogo adiado e escondeu a R22, que estava 10/10 completa desde 09/08;
  · o laco de entrega por destinatario simplesmente NAO EXISTIA ate 2026-08-11 (`raise
    NotImplementedError`) e toda a suite passava, porque nenhum teste chegava perto dele;
  · no app do Powerball um `or todos` reenviou o resultado do sorteio de 08/08 para 15 pessoas.

Este gate exercita o CODIGO DE PRODUCAO — `round_state.derive_round_notification_state()` e
`send_round_email._process_round()` — e nao uma reimplementacao. O que ele fixa e o CONTRATO,
nao um calendario:

  GENERICO DE PROPOSITO. Nada aqui depende do numero da rodada corrente, da data de hoje, de
  um id de jogo real, nem de qual time joga por ultimo. As rodadas sao sinteticas e
  parametrizadas por N; o relogio e fixo. Um gate que soubesse que "a R23 fecha com
  Internacional x Remo" provaria o calendario de um dia e apodreceria no dia seguinte — e a
  propriedade que importa ("a rodada fecha quando TODOS os N jogos estao terminais") vale para
  qualquer rodada de qualquer temporada.

SEGURANCA: zero rede, zero Supabase, zero e-mail real. O transporte e injetado no limite
externo (`_TRANSPORT`) e conta chamadas. Enderecos so em dominios reservados por RFC 2606.

Executar: python3 bolao/br2026/scripts/test_round_close_preflight.py
"""
import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "shared", "scripts"))

# Antes de importar o sender: garante que nenhum caminho considere isto uma execucao real.
os.environ["BOLAO_TEST_RUN"] = "1"
os.environ.pop("BOLAO_ALLOW_REAL_SEND", None)

import round_state as RS
import send_round_email as S
from round_notification_ledger import (
    RoundLedger, MemoryRoundLedgerRepo, ROUND_STATE, RECIPIENT_STATE, CLAIMABLE_STATES,
)

# Relogio FIXO. Sem isto o gate passaria a depender do dia em que roda — e a primeira coisa que
# um gate de fechamento de rodada nao pode fazer e mudar de veredito conforme o calendario.
NOW = datetime(2026, 5, 10, 2, 0, 0, tzinfo=timezone.utc)

# Tabela sintetica de 20 times (o sender exige 20 para nao bloquear por classificacao incompleta).
TABELA = [{"name": f"Time {i:02d}", "points": 60 - i} for i in range(20)]
# Uma classificacao DIFERENTE, para representar "estado pre-apito-final".
TABELA_PRE = [{"name": f"Time {(i + 7) % 20:02d}", "points": 60 - i} for i in range(20)]

_pass = 0
_fail = 0
_reds = []


def check(nome, cond, detalhe=""):
    global _pass, _fail
    if cond:
        print(f"  ✓ {nome}")
        _pass += 1
    else:
        print(f"  ✗ {nome}" + (f"\n      {detalhe}" if detalhe else ""))
        _fail += 1
        _reds.append(nome)


def sec(titulo):
    print(f"\n{titulo}")


# ── Construtores sinteticos ────────────────────────────────────────────────────────────────────
def fid(i):
    """Id de jogo SINTETICO. Nunca um id real da ESPN."""
    return f"synthetic-fixture-{i:03d}"


def rodada(n_fixtures, round_number=7):
    """Uma rodada canonica sintetica com N jogos. N e o parametro; nada aqui e a R23."""
    return {
        "roundNumber": round_number,
        "expectedFixtureCount": n_fixtures,
        "canonicalFixtureIds": [fid(i) for i in range(n_fixtures)],
        "replacements": {},
        "dateRangeUtc": ["2026-05-08T19:30:00+00:00", "2026-05-09T23:00:00+00:00"],
    }


def obs_terminal(minutos_atras=30):
    """Observacao TERMINAL na forma exata que `_observations_for_round()` produz."""
    return {
        "state": "post",
        "completed": True,
        "statusName": "STATUS_FULL_TIME",
        "observedAt": (NOW - timedelta(minutes=1)).isoformat(),
        "terminalAt": (NOW - timedelta(minutes=minutos_atras)).isoformat(),
        "_game": {"date": "2026-05-09T20:00Z", "home": "Casa", "away": "Fora",
                  "goalsHome": 2, "goalsAway": 1},
    }


def obs_nao_terminal(state, status, postponed=False):
    return {
        "state": state,
        "completed": False,
        "statusName": status,
        "postponed": postponed,
        "observedAt": (NOW - timedelta(minutes=1)).isoformat(),
        "terminalAt": None,
        "_game": {"date": "2026-05-09T20:00Z", "home": "Casa", "away": "Fora",
                  "goalsHome": None, "goalsAway": None},
    }


def todas_terminais(rd):
    return {f: obs_terminal() for f in rd["canonicalFixtureIds"]}


def deriva(rd, observacoes, notif=None, agora=None):
    return RS.derive_round_notification_state(rd, observacoes, notif, now=agora or NOW)


def fechou(resultado):
    return resultado["state"] == RS.ROUND_READY_TO_NOTIFY


# ── Entrega ────────────────────────────────────────────────────────────────────────────────────
def entrada(i):
    return {"id": f"e{i}", "entryName": f"Entrada {i}",
            "participantEmail": f"p{i}@example.invalid",     # RFC 2606, nunca entregavel
            "picks": {"g4": ["Time 00", "Time 01", "Time 02", "Time 03"], "z4": [], "sa6": []}}


class TransporteFalso:
    """Limite EXTERNO. Nao fala com ninguem: registra o corpo e devolve o que o teste mandar."""

    def __init__(self, resposta=200):
        self.chamadas = []
        self.resposta = resposta

    def __call__(self, url, body, headers):
        self.chamadas.append(body.decode("utf-8") if isinstance(body, bytes) else body)
        r = self.resposta(len(self.chamadas)) if callable(self.resposta) else self.resposta
        if isinstance(r, Exception):
            raise r
        return r


def corpo_de(chamada):
    try:
        return json.loads(chamada).get("template_params", {}).get("html_message", chamada)
    except (ValueError, AttributeError):
        return chamada


def faz_ledger():
    return RoundLedger(MemoryRoundLedgerRepo(),
                       now=lambda: int(datetime.now(timezone.utc).timestamp() * 1000))


def entrega(ledger, rd, entries, transporte, dry_run=False, tabela=None):
    """Chama o `_process_round` de PRODUCAO com o minimo de andaime."""
    n = rd["roundNumber"]
    cand = {"roundNumber": n,
            "facts": {"expectedCount": rd["expectedFixtureCount"],
                      "finalCount": rd["expectedFixtureCount"], "nonTerminalCount": 0}}
    obs = todas_terminais(rd)
    state = {"entries": entries, "deletedIds": []}
    orig = S.fetch_standings
    S.fetch_standings = lambda: (tabela or TABELA)
    S._TRANSPORT = transporte
    try:
        return S._process_round(cand, {"rounds": [rd]}, obs, state, ledger, dry_run)
    finally:
        S.fetch_standings = orig
        S._TRANSPORT = None


print("\nBR2026 — fechamento de rodada e e-mail pos-apito-final (hermetico, generico)\n")

# ═══ A. N-1 TERMINAIS NAO FECHA / N TERMINAIS FECHA ════════════════════════════════════════════
sec("A. A rodada fecha com N terminais, e nunca com N-1")
for n in (8, 10, 12):
    for numero in (7, 19, 31):
        rd = rodada(n, numero)
        # N terminais -> fecha
        check(f"N={n} rodada {numero}: {n}/{n} terminais => FECHA",
              fechou(deriva(rd, todas_terminais(rd))),
              deriva(rd, todas_terminais(rd))["state"])
        # N-1 terminais, para CADA posicao possivel do jogo que falta -> nunca fecha
        buracos = []
        for i in range(n):
            o = todas_terminais(rd)
            o[fid(i)] = obs_nao_terminal("in", "STATUS_SECOND_HALF")
            if fechou(deriva(rd, o)):
                buracos.append(i)
        check(f"N={n} rodada {numero}: {n - 1}/{n} NUNCA fecha (testadas as {n} posicoes)",
              not buracos, f"fechou faltando o jogo no indice {buracos}")

# ═══ B. ESTADOS NAO-TERMINAIS ══════════════════════════════════════════════════════════════════
sec("B. Todo estado nao-terminal impede o fechamento (e nenhum vira FINAL)")
rd = rodada(10)
NAO_TERMINAIS = [
    ("agendado",   obs_nao_terminal("pre", "STATUS_SCHEDULED")),
    ("ao vivo",    obs_nao_terminal("in", "STATUS_SECOND_HALF")),
    ("intervalo",  obs_nao_terminal("in", "STATUS_HALFTIME")),
    ("suspenso",   obs_nao_terminal("in", "STATUS_SUSPENDED")),
    ("adiado",     obs_nao_terminal("pre", "STATUS_POSTPONED", postponed=True)),
    ("cancelado",  obs_nao_terminal("pre", "STATUS_CANCELED")),
]
for rotulo, o in NAO_TERMINAIS:
    obs = todas_terminais(rd)
    obs[fid(3)] = o
    res = deriva(rd, obs)
    check(f"{rotulo}: nao fecha", not fechou(res), res["state"])
    check(f"{rotulo}: terminal_of() != FINAL", RS.terminal_of(o) != RS.TERMINAL_FINAL)

# adiado/suspenso/cancelado tem estado PROPRIO (nomeia a espera em vez de virar 'incompleto')
for rotulo, o in [("adiado", NAO_TERMINAIS[4][1]), ("suspenso", NAO_TERMINAIS[3][1]),
                  ("cancelado", NAO_TERMINAIS[5][1])]:
    obs = todas_terminais(rd)
    obs[fid(3)] = o
    check(f"{rotulo}: estado = ROUND_WAITING_FOR_POSTPONED_MATCH",
          deriva(rd, obs)["state"] == RS.ROUND_WAITING_FOR_POSTPONED_MATCH,
          deriva(rd, obs)["state"])

# jogo AUSENTE da fonte nunca e final
obs = todas_terminais(rd)
del obs[fid(5)]
check("jogo ausente da fonte => ROUND_SOURCE_UNAVAILABLE (ausente nunca e final)",
      deriva(rd, obs)["state"] == RS.ROUND_SOURCE_UNAVAILABLE, deriva(rd, obs)["state"])

# ═══ C. ORDEM DO ARRAY NAO DECIDE NADA ═════════════════════════════════════════════════════════
sec("C. A completude vem do CONJUNTO, nunca da ordem nem do 'ultimo' registro")
rd = rodada(10)
obs = todas_terminais(rd)
obs[fid(4)] = obs_nao_terminal("in", "STATUS_SECOND_HALF")   # buraco no MEIO
check("um jogo do meio nao-terminal impede o fechamento (o 'ultimo' esta terminal)",
      not fechou(deriva(rd, obs)))

random.seed(20260817)
vereditos = set()
for _ in range(25):
    itens = list(obs.items())
    random.shuffle(itens)
    vereditos.add(deriva(rd, dict(itens))["state"])
check("25 embaralhamentos das observacoes => sempre o MESMO veredito",
      len(vereditos) == 1, f"vereditos divergentes: {vereditos}")

# o relogio nao substitui o status
tarde = deriva(rd, obs, agora=NOW + timedelta(days=3))
check("adiantar o relogio em 3 dias NAO fecha a rodada (status manda, nao o tempo decorrido)",
      not fechou(tarde), tarde["state"])

# ═══ D. JANELA DE ASSENTAMENTO / FRESCOR ═══════════════════════════════════════════════════════
sec("D. Assentamento e frescor da fonte")
rd = rodada(10)
recente = {f: obs_terminal(minutos_atras=1) for f in rd["canonicalFixtureIds"]}
check("dentro da janela de assentamento ainda NAO notifica",
      deriva(rd, recente)["state"] == RS.ROUND_COMPLETE_UNSETTLED, deriva(rd, recente)["state"])
velho = {f: dict(obs_terminal(), observedAt=(NOW - timedelta(hours=4)).isoformat())
         for f in rd["canonicalFixtureIds"]}
check("observacao mais velha que MAX_SOURCE_AGE nao autoriza envio",
      deriva(rd, velho)["state"] == RS.ROUND_SOURCE_UNAVAILABLE, deriva(rd, velho)["state"])

# ═══ E. SCORING/RANKING FINALIZADOS ANTES DA NOTIFICACAO ═══════════════════════════════════════
sec("E. O e-mail carrega a pontuacao e a classificacao FINALIZADAS")
rd = rodada(10, 19)
ENTRIES = [entrada(i) for i in range(3)]
led = faz_ledger()
t = TransporteFalso(200)
entrega(led, rd, ENTRIES, t)
corpos = [corpo_de(c) for c in t.chamadas]

g4_final = [x["name"] for x in TABELA[0:4]]
ranked = S.rank_entries(ENTRIES, g4_final,
                        [x["name"] for x in TABELA[16:20]], [x["name"] for x in TABELA[6:12]])
pontos = {r["entry"]["id"]: r["total"] for r in ranked}
check("o corpo traz os times do G4 finalizado", all(nome in corpos[0] for nome in g4_final))
check("o corpo traz a pontuacao final do proprio destinatario",
      str(pontos["e0"]) in corpos[0], f"esperado {pontos['e0']}")

# e o conteudo REAGE a classificacao: se ela mudar, o corpo muda (a assercao acima esta viva)
led_pre = faz_ledger()
t_pre = TransporteFalso(200)
entrega(led_pre, rodada(10, 20), ENTRIES, t_pre, tabela=TABELA_PRE)
corpo_pre = corpo_de(t_pre.chamadas[0])
check("classificacao PRE-apito produz corpo DIFERENTE (o e-mail nao e insensivel ao estado)",
      corpo_pre != corpos[0] and not all(n in corpo_pre for n in g4_final))

# ═══ F. PII ════════════════════════════════════════════════════════════════════════════════════
sec("F. Nenhum destinatario ve o dado de outro")
vaz = [(i, j) for i in range(len(corpos)) for j, e in enumerate(ENTRIES)
       if i != j and e["participantEmail"] in corpos[i]]
check("PII_CROSS_RECIPIENT_LEAK = 0", not vaz, f"vazamentos: {vaz}")
check("cada corpo contem o proprio nome de entrada",
      all(ENTRIES[i]["entryName"] in corpos[i] for i in range(len(corpos))))

# ═══ G. EXATAMENTE UMA VEZ / REPLAY ════════════════════════════════════════════════════════════
sec("G. Exatamente uma vez por destinatario, e replay nao reenvia")
rd = rodada(10, 21)
led = faz_ledger()
t1 = TransporteFalso(200)
r1 = entrega(led, rd, ENTRIES, t1)
check("1a observacao terminal: exatamente 1 chamada por destinatario",
      len(t1.chamadas) == len(ENTRIES) and r1["accepted"] == len(ENTRIES),
      f"chamadas={len(t1.chamadas)}")
check("ledger conclui SENT", r1["ledgerState"] == ROUND_STATE["SENT"], r1["ledgerState"])

total_replay = 0
for _ in range(3):
    tr = TransporteFalso(200)
    entrega(led, rd, ENTRIES, tr)
    total_replay += len(tr.chamadas)
check("replay da mesma rodada finalizada x3 => ZERO envios", total_replay == 0,
      f"envios={total_replay}")

# dry-run nunca toca o provedor
led_dry = faz_ledger()
t_dry = TransporteFalso(200)
entrega(led_dry, rodada(10, 22), ENTRIES, t_dry, dry_run=True)
check("dry-run: ZERO chamadas ao provedor", not t_dry.chamadas, f"chamadas={len(t_dry.chamadas)}")

# ═══ H. PARCIAL / ACEITO / INCERTO ═════════════════════════════════════════════════════════════
sec("H. Retentativa parcial toca so quem falhou; ACEITO e INCERTO nunca sao reenviados")
rd = rodada(10, 23)
led = faz_ledger()
t_p = TransporteFalso(lambda n: 500 if n == 3 else 200)     # o 3o falha
r_p = entrega(led, rd, ENTRIES, t_p)
estados = {r["entryRef"]: r["state"] for r in led.get(rd["roundNumber"])["recipients"]}
check("entrega parcial NAO vira SENT", r_p["ledgerState"] != ROUND_STATE["SENT"],
      r_p["ledgerState"])
check("2 ACEITOS e 1 FALHOU registrados por destinatario",
      sorted(estados.values()) == sorted([RECIPIENT_STATE["ACCEPTED"]] * 2
                                         + [RECIPIENT_STATE["FAILED"]]), estados)

t_r = TransporteFalso(200)
entrega(led, rd, ENTRIES, t_r)
check("retentativa envia para EXATAMENTE 1 destinatario (so o que falhou)",
      len(t_r.chamadas) == 1, f"chamadas={len(t_r.chamadas)}")
# Identidade pelo NOME DA ENTRADA, nao pelo entryRef: "e0" tem dois caracteres e casaria por
# acaso dentro de hash/HTML, transformando um verde/vermelho em sorteio.
falhou_ref = [ref for ref, st in estados.items() if st == RECIPIENT_STATE["FAILED"]][0]
nome_falhou = next(e["entryName"] for e in ENTRIES if e["id"] == falhou_ref)
nomes_aceitos = [e["entryName"] for e in ENTRIES if estados[e["id"]] == RECIPIENT_STATE["ACCEPTED"]]
corpo_retry = corpo_de(t_r.chamadas[0])
check("a retentativa e do destinatario que FALHOU", nome_falhou in corpo_retry,
      f"esperado {nome_falhou}")
check("os ja ACEITOS nao aparecem na retentativa",
      all(n not in corpo_retry for n in nomes_aceitos), f"aceitos={nomes_aceitos}")

t_r2 = TransporteFalso(200)
entrega(led, rd, ENTRIES, t_r2)
check("apos completar, nova execucao => ZERO envios", not t_r2.chamadas,
      f"chamadas={len(t_r2.chamadas)}")

# INCERTO: excecao DEPOIS do POST — pode ter sido entregue, entao nunca reenvia sozinho
rd = rodada(10, 24)
led_u = faz_ledger()
t_u = TransporteFalso(lambda n: RuntimeError("conexao caiu depois do POST") if n == 2 else 200)
r_u = entrega(led_u, rd, ENTRIES, t_u)
check("excecao apos o POST => UNCERTAIN", r_u["uncertain"] == 1, f"uncertain={r_u['uncertain']}")
incertos = [r["entryRef"] for r in led_u.get(rd["roundNumber"])["recipients"]
            if r["state"] == RECIPIENT_STATE["UNCERTAIN"]]
t_u2 = TransporteFalso(200)
entrega(led_u, rd, ENTRIES, t_u2)
check("UNCERTAIN nunca e reenviado automaticamente",
      incertos and all(all(ref not in c for c in t_u2.chamadas) for ref in incertos),
      f"incertos={incertos} chamadas={len(t_u2.chamadas)}")

# ═══ I. FLAP DA FONTE ══════════════════════════════════════════════════════════════════════════
sec("I. terminal -> nao-terminal -> terminal nao reenvia")
rd = rodada(10, 25)
obs_live = todas_terminais(rd)
obs_live[fid(9)] = obs_nao_terminal("in", "STATUS_SECOND_HALF")
check("rodada ja SENT + fonte volta a 'ao vivo' => permanece ROUND_NOTIFIED",
      deriva(rd, obs_live, notif={"status": "SENT"})["state"] == RS.ROUND_NOTIFIED)
check("rodada ja SENT + terminal de novo => permanece ROUND_NOTIFIED",
      deriva(rd, todas_terminais(rd), notif={"status": "SENT"})["state"] == RS.ROUND_NOTIFIED)

led_f = faz_ledger()
entrega(led_f, rd, ENTRIES, TransporteFalso(200))          # 1o envio
t_flap = TransporteFalso(200)
entrega(led_f, rd, ENTRIES, t_flap)                        # apos o flap
check("flap nao produz segunda chamada ao provedor", not t_flap.chamadas,
      f"chamadas={len(t_flap.chamadas)}")

# ═══ J. MUTACOES — cada garantia critica tem de MORDER ═════════════════════════════════════════
#
# Uma garantia sem uma mutacao que a derrube e uma garantia que ninguem sabe se esta ligada.
# Cada bloco abaixo constroi o comportamento QUEBRADO e exige que o comportamento REAL divirja
# dele. Nada de producao e alterado permanentemente: os patches sao revertidos no `finally`.
sec("J. Mutacoes")
mut_ok = 0
mut_total = 0


def mutacao(nome, pego, detalhe=""):
    global mut_ok, mut_total
    mut_total += 1
    if pego:
        mut_ok += 1
        print(f"  ✓ M{mut_total} {nome} => PEGA")
    else:
        print(f"  ✗ M{mut_total} {nome} => NAO PEGA  {detalhe}")


rd = rodada(10, 26)
obs_falta_um = todas_terminais(rd)
obs_falta_um[fid(6)] = obs_nao_terminal("in", "STATUS_SECOND_HALF")

# M1: fechar com N-1 terminais (predicado "algum terminal")
quebrado_algum = any(RS.terminal_of(o) == RS.TERMINAL_FINAL for o in obs_falta_um.values())
mutacao("fechar com N-1 terminais", quebrado_algum and not fechou(deriva(rd, obs_falta_um)))

# M2: escolher o 'ultimo' jogo por ordem de array
quebrado_ordem = RS.terminal_of(obs_falta_um[rd["canonicalFixtureIds"][-1]]) == RS.TERMINAL_FINAL
mutacao("'ultimo jogo' por ordem de array",
        quebrado_ordem and not fechou(deriva(rd, obs_falta_um)))

# M3: tratar adiado/nao-terminal como completo
obs_adiado = todas_terminais(rd)
obs_adiado[fid(2)] = obs_nao_terminal("pre", "STATUS_POSTPONED", postponed=True)
mutacao("adiado tratado como completo",
        deriva(rd, obs_adiado)["state"] == RS.ROUND_WAITING_FOR_POSTPONED_MATCH)

# M4: e-mail montado antes do scoring final
mutacao("e-mail com ranking pre-apito", corpo_pre != corpos[0])

# M5: remover o dedupe POR DESTINATARIO.
# Precisa de uma rodada CLAIMABLE (PARTIAL): numa rodada ja SENT o portao de `claim` recusa
# antes de a selecao importar, e a mutacao passaria despercebida — o mascaramento descrito na
# docstring de `alvos_reenviaveis()`, e a razao de ela ser uma funcao pura e separada.
rd_m = rodada(10, 27)
led_a = faz_ledger()
entrega(led_a, rd_m, ENTRIES, TransporteFalso(lambda n: 500 if n == 3 else 200))
t_real = TransporteFalso(200)
entrega(led_a, rd_m, ENTRIES, t_real)
reais = len(t_real.chamadas)

rd_m2 = rodada(10, 28)
led_b = faz_ledger()
entrega(led_b, rd_m2, ENTRIES, TransporteFalso(lambda n: 500 if n == 3 else 200))
_orig = S.alvos_reenviaveis
S.alvos_reenviaveis = lambda resolvidos, estado: list(resolvidos)
try:
    t_mut = TransporteFalso(200)
    entrega(led_b, rd_m2, ENTRIES, t_mut)
    mutados = len(t_mut.chamadas)
finally:
    S.alvos_reenviaveis = _orig
mutacao("dedupe por destinatario removido",
        reais == 1 and mutados == len(ENTRIES), f"real={reais} mutado={mutados}")

# M6: considerar ACEITO reenviavel
rd_m3 = rodada(10, 29)
led_c = faz_ledger()
entrega(led_c, rd_m3, ENTRIES, TransporteFalso(lambda n: 500 if n == 3 else 200))
_orig_reenviavel = S.REENVIAVEL
S.REENVIAVEL = (RECIPIENT_STATE["PENDING"], RECIPIENT_STATE["FAILED"],
                RECIPIENT_STATE["ACCEPTED"])
try:
    t_mut2 = TransporteFalso(200)
    entrega(led_c, rd_m3, ENTRIES, t_mut2)
    com_aceitos = len(t_mut2.chamadas)
finally:
    S.REENVIAVEL = _orig_reenviavel
mutacao("ACEITO tratado como reenviavel",
        com_aceitos == len(ENTRIES) and reais == 1, f"com_aceitos={com_aceitos}")

# M7: reenviar UNCERTAIN automaticamente.
#
# UNCERTAIN e protegido por DUAS camadas independentes, e a mutacao precisa mirar a certa:
#   (1) a rodada com incerto assenta em NEEDS_MANUAL_REVIEW, que NAO esta em CLAIMABLE_STATES —
#       o `claim` recusa antes de a selecao por destinatario sequer rodar;
#   (2) `REENVIAVEL` exclui UNCERTAIN.
# Mutar so a (2) e passar por `_process_round` da falso negativo: a (1) barra antes e a mutacao
# parece "nao ter efeito". A camada (2) e exercitada onde ela decide — na funcao pura.
alvos_reais = S.alvos_reenviaveis(ENTRIES, {e["id"]: RECIPIENT_STATE["UNCERTAIN"] for e in ENTRIES})
_orig_reenviavel = S.REENVIAVEL
S.REENVIAVEL = (RECIPIENT_STATE["PENDING"], RECIPIENT_STATE["FAILED"],
                RECIPIENT_STATE["UNCERTAIN"])
try:
    alvos_mutados = S.alvos_reenviaveis(
        ENTRIES, {e["id"]: RECIPIENT_STATE["UNCERTAIN"] for e in ENTRIES})
finally:
    S.REENVIAVEL = _orig_reenviavel
mutacao("UNCERTAIN tratado como reenviavel (camada de selecao)",
        alvos_reais == [] and len(alvos_mutados) == len(ENTRIES),
        f"reais={len(alvos_reais)} mutados={len(alvos_mutados)}")

# E a camada (1), afirmada explicitamente: uma rodada em NEEDS_MANUAL_REVIEW nao e reivindicavel.
mutacao("NEEDS_MANUAL_REVIEW tratado como reivindicavel",
        ROUND_STATE["NEEDS_MANUAL_REVIEW"] not in CLAIMABLE_STATES
        and led_u.get(24)["state"] == ROUND_STATE["NEEDS_MANUAL_REVIEW"],
        f"estado={led_u.get(24)['state']}")

check(f"MUTATIONS_CAUGHT == MUTATIONS_EXECUTED ({mut_ok}/{mut_total})", mut_ok == mut_total)

# ═══ K. SEGURANCA DO PROPRIO GATE ══════════════════════════════════════════════════════════════
sec("K. O gate nao pode ter tocado nada real")
check("nenhum endereco fora de dominio reservado (RFC 2606)",
      all(e["participantEmail"].endswith(".invalid") for e in ENTRIES))
check("BOLAO_ALLOW_REAL_SEND permanece ausente",
      not os.environ.get("BOLAO_ALLOW_REAL_SEND"))
check("os patches de producao foram revertidos",
      S.alvos_reenviaveis is _orig and S.REENVIAVEL == (RECIPIENT_STATE["PENDING"],
                                                        RECIPIENT_STATE["FAILED"])
      and S._TRANSPORT is None)

print(f"\n  {_pass} passed, {_fail} failed")
if _reds:
    print("\n  REDS:")
    for r in _reds:
        print(f"    - {r}")
    print("\n✗ ROUND CLOSE PREFLIGHT FAILED\n")
    sys.exit(1)
print("\n✓ ALL CHECKS PASSED\n")
