"""
send_result_email.py — Bolão Ferrari Copa do Brasil 2026
Sends a bilingual PT/EN score-update email to all participants after each match (leg) result.

EXATAMENTE igual à Copa do Mundo (bolao/copa2026/scripts/send_result_email.py) em arquitetura,
gates de segurança e formato de e-mail — Eduardo, 2026-08-01: "Tem que ser EXATAMENTE igual copa
do mundo!" A única diferença real é o MODELO DE DADOS: a Copa tem um chaveamento fixo conhecido
de antemão (MATCH_TEAMS, resolução de slots W73/L101); o CDB2026 é mata-mata de ida e volta com
confrontos sorteados fase a fase (não são conhecidos de antemão — ver data.js), então este script
lê os confrontos diretamente de `state.phases[phaseId].ties` em vez de um dicionário de bracket
fixo, e casa cada perna com a ESPN por NOME DE TIME (mesmo mecanismo de autoSyncEspnResults() em
app.js), não por ID numérico de partida fixo.

Reaproveita audit_scoring.py DIRETAMENTE (match_points()/score_entry()) em vez de reimplementar a
fórmula de pontuação uma segunda vez — ver o comentário no topo de audit_scoring.py: isso elimina
por construção o tipo de risco de "drift" que o script da Copa protege (lá, send_result_email.py
é uma reimplementação Python verdadeiramente independente do app.js).

Usage:
  python3 send_result_email.py                                  # send about latest saved leg
  python3 send_result_email.py --update <tieId> <leg> <gH> <gA>  # save leg only, no email
  python3 send_result_email.py --auto                            # check ESPN, save+email new legs
  python3 send_result_email.py --clear-leg <tieId> <leg>         # remove a leg result
  python3 send_result_email.py --render <phaseId> <tieId> <leg> --state-file s.json --out e.html
                                                                 # DRY-RUN: render only, never sends

--update <tieId> <leg> <goalsHome> <goalsAway>
  Writes the leg result to Supabase and exits. leg: "first"|"second"|"single".

--auto
  Fetches ESPN, detects legs of the ACTIVE phase's ties not yet in Supabase, saves and emails
  each one, in the same run if a tie's 2nd leg completion also decides it. Idempotent.

--clear-leg <tieId> <leg>
  Removes a leg's result from Supabase (sets goalsHome/goalsAway back to null, status SCHEDULED)
  and unlocks the tie (qualifiedTeamId cleared) if it had been locked from that leg's data.
"""

import os
import sys
import urllib.error
import json
import hashlib
import html as _html
import os, re, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import audit_scoring  # match_points(), score_entry(), MATCH_SCORING, TIE_BONUS, PODIUM_BONUS
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "scripts"))
import subject_policy as _subject_policy  # politica UNICA de icone de assunto

# ── Config — mirrors bolao/cdb2026/js/config.js exactly ───────────────────────
SUPABASE_URL   = "https://cmhqkkfczotdnssupkni.supabase.co"
ANON_KEY       = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"
STATE_ID       = "cdb2026"
EMAILJS_URL    = "https://api.emailjs.com/api/v1.0/email/send"
EMAILJS_KEY    = "GBZFujsJBET6modve"
EMAILJS_SVC    = "service_o4hyzxr"
EMAILJS_TMPL   = "template_xq7yzzb"
ADMIN_EMAIL    = "emferrari@gmail.com"
SITE_URL       = "https://ferrarilabs.github.io/bolao/cdb2026/"
ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.copa_do_brazil/scoreboard?dates=20260101-20261231&limit=500"

EMAILJS_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Origin":  "https://ferrarilabs.github.io",
    "Referer": "https://ferrarilabs.github.io/bolao/cdb2026/",
}

# Phase structure — mirrors DATA.phases in bolao/cdb2026/js/data.js exactly (only the
# STRUCTURE is known ahead of time; which teams play in each phase is drawn live and lives in
# Supabase, never here — see data.js's own top-of-file comment).
PHASES = [
    {"id": "fase-1",    "name": "1ª Fase",           "format": "SINGLE_MATCH", "order": 1},
    {"id": "fase-2",    "name": "2ª Fase",            "format": "SINGLE_MATCH", "order": 2},
    {"id": "fase-3",    "name": "3ª Fase",            "format": "SINGLE_MATCH", "order": 3},
    {"id": "fase-4",    "name": "4ª Fase",            "format": "SINGLE_MATCH", "order": 4},
    {"id": "fase-5",    "name": "5ª Fase",            "format": "TWO_LEG",      "order": 5},
    {"id": "oitavas",   "name": "Oitavas de Final",   "format": "TWO_LEG",      "order": 6},
    {"id": "quartas",   "name": "Quartas de Final",   "format": "TWO_LEG",      "order": 7},
    {"id": "semifinal", "name": "Semifinal",          "format": "TWO_LEG",      "order": 8},
    {"id": "final",     "name": "Final",              "format": "SINGLE_MATCH", "order": 9},
]
PHASE_BY_ID = {p["id"]: p for p in PHASES}


def legs_for_format(fmt):
    return ["first", "second"] if fmt == "TWO_LEG" else ["single"]


# ESPN display-name aliases — mirrors CDB_ESPN_NAME_ALIASES in bolao/cdb2026/js/app.js exactly.
# Keep in sync by hand if the ESPN feed adds another nickname mismatch.
ESPN_ALIASES = {"Vasco da Gama": "Vasco"}


def _espn_normalize(name):
    return ESPN_ALIASES.get(name, name)


# ── ESPN helpers ──────────────────────────────────────────────────────────────
def any_cdb_match_live():
    req = urllib.request.Request(ESPN_SCOREBOARD_URL)
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read())
    return any(
        e.get("competitions", [{}])[0].get("status", {}).get("type", {}).get("state") == "in"
        for e in data.get("events", [])
    )


class SourceUnavailable(Exception):
    """A fonte de descoberta não pôde ser consultada NEM havia snapshot utilizável em disco.
    Distinta de "consultei e não havia nada novo": nada foi descoberto, nada foi descartado."""


def fetch_espn_candidates():
    """Candidatos de resultado a partir do SNAPSHOT NORMALIZADO canônico — o MESMO arquivo que os
    três apps de futebol leem.

    Antes daqui esta função tinha a sua própria implementação de ESPN: montava a request para
    ESPN_SCOREBOARD_URL e abria a conexão direto, SEM definir User-Agent, e parseava os `events`
    crus. (O código antigo não é citado literalmente aqui de propósito: um teste de contrato desta
    suíte falha se qualquer chamada de rede reaparecer no corpo desta função, e um exemplo em
    docstring dispararia esse teste como se fosse código de verdade.)

    Dois problemas reais:

      1. Era uma SEGUNDA implementação de ESPN em paralelo à do provider compartilhado — dois
         parsers, duas listas de alias, duas noções de "partida acabou". Divergência silenciosa
         entre o que o site mostra e o que o email afirma é exatamente o risco que a auditoria de
         julho/2026 encontrou em `send_result_email.py` (ver CHANGELOG v4.57).
      2. Sem `User-Agent` a ESPN recusa a conexão nos runners do GitHub (403/TLS). Era a causa do
         cron ficar vermelho: o provider compartilhado passa `curl/8.7.1` de propósito
         (`_default_opener`, descoberto empiricamente) e funciona no CI — comprovado com o workflow
         de snapshot rodando com sucesso lá.

    Agora existe UM caminho canônico: o provider compartilhado atualiza o snapshot (com o UA certo,
    timeout, retry e preservação do último-bom-conhecido) e esta função LÊ esse snapshot. Zero
    parsing de ESPN aqui.

    Levanta SourceUnavailable quando não há snapshot utilizável — o chamador trata como "nada
    descoberto neste ciclo" e sai com 0.
    """
    here = Path(__file__).parent
    shared = str(here.parent.parent / "shared" / "scripts")
    if shared not in sys.path:
        sys.path.insert(0, shared)
    if str(here) not in sys.path:
        sys.path.insert(0, str(here))
    import espn_provider as ep
    import sync_espn  # expõe CONFIG e NÃO executa nada no import (guarda __main__)

    # Tenta atualizar. Falha aqui NÃO é fatal: run_sync() preserva o snapshot anterior marcado
    # `stale`, e um resultado já finalizado é um fato imutável — snapshot velho pode ATRASAR a
    # descoberta, nunca produzir um resultado errado.
    try:
        outcome = ep.run_sync(sync_espn.CONFIG)
        print(f"AUTO — snapshot: wrote={outcome.wrote} stale={outcome.stale} reason={outcome.reason}")
        if outcome.problems:
            print(f"AUTO — snapshot problems: {outcome.problems}")
    except Exception as ex:  # noqa: BLE001 — qualquer falha cai para o snapshot em disco
        print(f"AUTO — refresh do snapshot falhou ({ex}); tentando o snapshot em disco")

    snap = ep.read_snapshot(sync_espn.CONFIG["output_path"])
    if not snap or not isinstance(snap.get("matches"), list):
        raise SourceUnavailable("nenhum snapshot normalizado utilizável em disco")
    if not ep.is_schema_compatible(snap):
        # Schema futuro/incompatível nunca é lido "no chute" — mesma regra do run_sync().
        raise SourceUnavailable(f"snapshot com schemaVersion incompatível: {snap.get('schemaVersion')!r}")
    if snap.get("stale"):
        print(f"AUTO — ATENÇÃO: snapshot marcado stale ({snap.get('staleReason')}), "
              f"generatedAt={snap.get('generatedAt')} — resultado novo pode demorar um ciclo")

    out = []
    for m in snap["matches"]:
        ev_state = m.get("state") or "pre"
        # `completed is False` com state "post" = adiado/cancelado. Mesma leitura do app.
        postponed = ev_state == "post" and m.get("completed") is False
        scored = ev_state == "post" and not postponed
        out.append({
            "dateISO":   m.get("date") or "",
            # O provider já aplicou os aliases dele; `_espn_normalize` continua aplicado porque é
            # idempotente e mantém a normalização local como rede de segurança.
            "homeTeam":  _espn_normalize(m.get("homeTeam") or ""),
            "awayTeam":  _espn_normalize(m.get("awayTeam") or ""),
            "state":     ev_state,
            "postponed": postponed,
            "homeScore": _parse(m.get("homeScore")) if scored else None,
            "awayScore": _parse(m.get("awayScore")) if scored else None,
            "homeWinner": bool(scored and m.get("homeWinner") is True),
            "awayWinner": bool(scored and m.get("awayWinner") is True),
            "venue":     m.get("venue") or "",
            "city":      m.get("city") or "",
        })
    return out


RESULT_MATCH_WINDOW_DAYS = 21


def within_result_match_window(candidate_date_iso, known_kickoff_iso):
    """Mirrors withinResultMatchWindow() in app.js — guards against matching an unrelated event
    with the same team-name pair from a different round/season window."""
    if not known_kickoff_iso:
        return True
    try:
        c = datetime.fromisoformat(candidate_date_iso.replace("Z", "+00:00"))
        k = datetime.fromisoformat(known_kickoff_iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return True
    return abs((c - k).total_seconds()) <= RESULT_MATCH_WINDOW_DAYS * 86400


# ── Supabase helpers ──────────────────────────────────────────────────────────
def _sb_key():
    """Credencial para a linha CRUA do cdb2026. NUNCA impressa.

    Desde 2026-08-12 a `anon` nao enxerga nem grava essa linha (migracao
    20260812080000): ela carrega participantEmail/payerName/paymentMethod dos 12 participantes,
    e a chave publicavel vai em todo config.js servido ao navegador.

    Este sender e um caminho CONFIAVEL -- roda no Actions, onde a credencial privilegiada existe.
    Sem ela, falha FECHADO: continuar com a anon devolveria uma lista vazia e o script trataria
    "nao posso ver" como "nao existe".
    """
    k = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not k:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY ausente. A linha crua do cdb2026 nao e acessivel pela "
            "chave anon desde a migracao 20260812080000 — este sender precisa da credencial "
            "privilegiada do runner.")
    return k


def sb_fetch():
    k = _sb_key()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/bolao_state?id=eq.{STATE_ID}&select=state",
        headers={"apikey": k, "Authorization": f"Bearer {k}"}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        linhas = json.loads(r.read())
    # LISTA VAZIA NAO E "ESTADO VAZIO". Era `[0]["state"]` direto, e quando a RLS passou a
    # esconder a linha o script morreu com `IndexError: list index out of range` -- tres
    # execucoes agendadas seguidas, com uma mensagem que nao dizia nada sobre permissao.
    # "Nao consigo ver" e "nao existe" sao coisas diferentes, e so uma delas e um bug de dados.
    if not linhas:
        raise RuntimeError(
            f"bolao_state[{STATE_ID}] devolveu ZERO linhas. Ou a linha sumiu, ou a credencial "
            f"nao tem permissao de le-la. Nao ha estado para processar — recusando continuar.")
    return linhas[0]["state"]


def _sb_rpc(tipo, payload, client_ref):
    """Mutacao ESTREITA no servidor. NAO existe mais gravacao de documento inteiro aqui.

    O que estava neste bloco era `_sb_upsert(state)`: lia o documento, mudava um campo em Python e
    regravava o TODO. Duas gravacoes de legs diferentes perdiam uma, e nada carregava token de
    concorrencia. `cdb_apply_operator_mutation` aplica um caminho jsonb sob `for update`, com
    idempotencia por client_ref, e devolve {"applied": false} quando o mesmo ref chega de novo.
    """
    k = _sb_key()
    body = json.dumps({"p_type": tipo, "p_payload": payload,
                       "p_actor": os.environ.get("CDB_ACTOR") or "send_result_email",
                       "p_client_ref": client_ref}).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/cdb_apply_operator_mutation", data=body, method="POST",
        headers={"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt.strip() else None)
    except urllib.error.HTTPError as e:
        # O corpo traz a mensagem do RAISE, que e o diagnostico util. O cabecalho traria a
        # credencial, por isso so o corpo e lido.
        print(f"🛑 HTTP {e.code}: {e.read().decode()[:300]}")
        sys.exit(2)


def _ref(op, *partes):
    """Idempotencia DETERMINISTICA: um retry de rede nao pode virar segunda aplicacao."""
    return "cdb-results:" + op + ":" + ":".join(str(x) for x in partes)


def sb_save_leg(phase_id, tie_id, leg, goals_home, goals_away, source="espn-auto", event_key=None):
    """Grava UMA mao. O mando da volta (home=teamB) e calculado NO SERVIDOR a partir do confronto
    gravado -- nao e enviado daqui, senao um cliente poderia declara-lo ao contrario.

    `event_key` (data do evento da ESPN) entra no client_ref: sem ele, a perna limpa depois de uma
    gravacao errada nunca mais aceitaria o MESMO placar vindo do jogo certo (o servidor responde
    {"applied": false} a um ref repetido)."""
    partes = [phase_id, tie_id, leg, int(goals_home), int(goals_away)] + ([event_key] if event_key else [])
    status, _ = _sb_rpc("save-leg", {
        "phaseId": phase_id, "tieId": tie_id, "leg": leg,
        "goalsHome": int(goals_home), "goalsAway": int(goals_away), "resultSource": source,
    }, _ref("save-leg", *partes))
    return status, None


def sb_backfill_schedule(espn_candidates):
    """Backfill de horario, uma mao por chamada. So o kickoff: um leg ja FINAL nao volta a
    SCHEDULED porque a data detalhada chegou depois."""
    aplicados = 0
    for c in espn_candidates:
        if not (c.get("phaseId") and c.get("tieId") and c.get("leg") and c.get("dateISO")):
            continue
        _sb_rpc("backfill-kickoff", {
            "phaseId": c["phaseId"], "tieId": c["tieId"], "leg": c["leg"], "kickoff": c["dateISO"],
        }, _ref("kickoff", c["phaseId"], c["tieId"], c["leg"], c["dateISO"]))
        aplicados += 1
    return aplicados


def sb_lock_tie(phase_id, tie_id, qualified_side, source="espn-auto"):
    """Trava o confronto com o classificado. lockedAt/lockedBy sao gravados pelo servidor."""
    status, _ = _sb_rpc("lock-tie", {
        "phaseId": phase_id, "tieId": tie_id, "qualifiedTeamId": qualified_side, "lockedBy": source,
    }, _ref("lock", phase_id, tie_id, qualified_side))
    return status, None


def sb_clear_leg(phase_id, tie_id, leg):
    """Retrata o placar E destrava o confronto -- os dois juntos, porque limpar o resultado sem
    destravar deixaria um classificado apoiado num placar que nao existe mais."""
    status, _ = _sb_rpc("clear-leg", {"phaseId": phase_id, "tieId": tie_id, "leg": leg},
                        _ref("clear", phase_id, tie_id, leg))
    print(f"{tie_id}:{leg} limpo e confronto destravado. Status: {status}")


def _parse(v):
    """Mirrors app.js's parseScore()/matchPoints() input guard: digits only, 0-20 range."""
    if v is None:
        return None
    s = str(v).strip()
    if not re.match(r'^\d+$', s):
        return None
    n = int(s)
    return n if 0 <= n <= 20 else None


# ── Scoring — reuses audit_scoring.py directly, see module docstring ─────────
#
# 2026-11-01: a pontuacao do e-mail passou a ser a do SITE (audit_scoring.score_entry_site(),
# transcricao de scoreEntry() de app.js com paridade testada em test_email_scoring_parity.mjs).
# Antes, `audit_scoring.score_entry()` recebia os confrontos achatados e: (1) procurava o palpite
# so pelo id REAL do confronto -- a semifinal inteira saiu "sem palpite", porque os palpites foram
# salvos sob o id de VAGA (sf-1/sf-2/final-1) antes de o confronto real existir; (2) comparava o
# classificado pela LETRA do lado, nao pelo TIME previsto; (3) lia campeao/vice de um campo que
# nenhuma entrada tem, entao 30/20 nunca entravam e o rateio da final divergiria do site.
#
# `phases` (state["phases"]) e o que o site usa. Sem ele (chamada antiga, so com os confrontos
# achatados) nao ha como achar o palpite de vaga nem a final prevista: cai no transcritor legado,
# que so e correto para fases nao derivadas. Todo chamador deste arquivo passa `phases`.
def score_entry_total(entry, all_ties, podium, phases=None):
    if phases is not None:
        return audit_scoring.score_entry_site(entry, phases)[0]
    total, _ = audit_scoring.score_entry(entry, all_ties, podium)
    return total


def entry_detail(entry, all_ties, podium, phases=None):
    if phases is not None:
        return audit_scoring.score_entry_site(entry, phases)[1]
    _, detail = audit_scoring.score_entry(entry, all_ties, podium)
    return detail


def official_podium(all_phases_ties):
    """Champion/runnerUp from the Final phase's single tie — officialPodium() in app.js.

    Recebe `state["phases"]`. Ate 2026-11-01 isto iterava `phases["final"]` (o objeto da FASE:
    cutoffAt/ties/topology) como se fossem os confrontos -- pegava a chave "ties" ou "cutoffAt"
    como id de confronto e nunca achava campeao (ou quebrava com AttributeError)."""
    return audit_scoring.official_podium_site(all_phases_ties)


def predicted_podium(entry, all_phases_ties):
    """predictedPodium() in app.js — campeao/vice da final PREVISTA pela entrada (os vencedores
    que ELA escolheu nas semifinais), nunca o lado A/B aplicado aos times reais."""
    return audit_scoring.predicted_podium_site(entry, all_phases_ties)


def exact_match_count(detail):
    return sum(1 for d in detail.get("matches", {}).values() if d["type"] == "exact")


def hit_champion(detail):
    # detail["champion"] is explicitly None (not just absent) whenever the podium bonus doesn't
    # apply yet (audit_scoring.score_entry() always sets the key) — .get(..., {}) doesn't help
    # when the key IS present with value None, so the fallback has to happen after the lookup.
    return 1 if (detail.get("champion") or {}).get("type") == "exact" else 0


def hit_runner_up(detail):
    return 1 if (detail.get("runnerUp") or {}).get("type") == "exact" else 0


# Prêmio do BOLÃO (participantes, não times) — mirrors finalPodiumPayouts()/CONFIG.prizes in
# app.js/config.js exactly (70/20/10%, entryFee $5). Same architecture as Copa's
# compute_final_payouts(): groups genuine ties (same total/champion/runnerUp/exact) and splits
# that position's prize evenly.
PRIZES = {"first": 0.70, "second": 0.20, "third": 0.10}
ENTRY_FEE = 5


def _all_ties(state):
    """{tieId: tie} flattened across every phase — score_entry()/audit_scoring expect this
    shape (mirrors how scoreEntry() in app.js iterates DATA.phases.forEach)."""
    out = {}
    for phase in PHASES:
        out.update(state.get("phases", {}).get(phase["id"], {}).get("ties", {}) or {})
    return out


def compute_final_payouts(state):
    """Only returns a result once the Final phase's tie is locked -- before that the bolão's own
    standings don't exist yet (mirrors Copa's gate on M103+M104 both being locked; CDB2026 has no
    3rd-place match, so there's only the one gate here)."""
    all_ties = _all_ties(state)
    podium = official_podium(state.get("phases", {}))
    if not podium["champion"]:
        return None
    deleted = set(state.get("deletedIds", []))
    entries = [e for e in state.get("entries", []) if e.get("id") not in deleted]
    if not entries:
        return None
    paid_count = sum(1 for e in entries if state.get("paid", {}).get(e.get("id")))
    pot = paid_count * ENTRY_FEE
    if not pot:
        return None

    phases = state.get("phases", {}) or {}
    scored = sorted(
        [{"e": e, "total": score_entry_total(e, all_ties, podium, phases=phases),
          "detail": entry_detail(e, all_ties, podium, phases=phases)} for e in entries],
        key=lambda x: (-x["total"], -hit_champion(x["detail"]), -hit_runner_up(x["detail"]), -exact_match_count(x["detail"])),
    )

    by_rank = {1: [], 2: [], 3: []}
    rank, prev_key = 0, None
    for i, item in enumerate(scored):
        key = (item["total"], hit_champion(item["detail"]), hit_runner_up(item["detail"]), exact_match_count(item["detail"]))
        if key != prev_key:
            rank = i + 1
        prev_key = key
        if rank in by_rank:
            by_rank[rank].append(item)

    payouts = []
    for r, pct_key in ((1, "first"), (2, "second"), (3, "third")):
        group = by_rank[r]
        if not group:
            continue
        amount = (pot * PRIZES[pct_key]) / len(group)
        for item in group:
            payouts.append({"entryName": item["e"].get("entryName", "?"), "rank": r, "amount": amount, "tied": len(group) > 1})
    return {"pot": pot, "payouts": payouts, "podium": podium}


def build_podium_html(payouts_info):
    """PT-only podium reveal — same visual treatment as Copa's build_podium_html(), minus the
    3rd/4th-place team congrats (CDB2026 has no 3rd-place match, only champion/runnerUp) and
    minus the English half (Eduardo, 2026-08-01: "Não precisa versão em inglês")."""
    medal = {1: "🥇", 2: "🥈", 3: "🥉"}
    label_pt = {1: "Campeão", 2: "Vice-campeão", 3: "3º lugar"}
    team_for_rank = {1: payouts_info["podium"].get("champion"), 2: payouts_info["podium"].get("runnerUp"), 3: None}

    def _amount(a):
        s = f"{a:.2f}"
        return s[:-3] if s.endswith(".00") else s

    def _congrats(item):
        team = team_for_rank.get(item["rank"])
        if not team:
            return ""
        name = item["entryName"]
        text = f"Parabéns, {name}! Assim como {team}, você também é {label_pt[item['rank']]} — só que do nosso bolão! 🏆"
        return f'<div style="font-size:11px;color:#374151;margin-top:6px;font-style:italic">{text}</div>'

    def _card(item):
        note = '<div style="font-size:11px;color:#9ca3af;margin-top:4px">Empate — valor dividido entre os empatados</div>' if item["tied"] else ""
        return f"""<div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center">
      <div style="font-size:30px;line-height:1;margin-bottom:6px">{medal[item['rank']]}</div>
      <div style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:4px">{label_pt[item['rank']]}</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">{item['entryName']}</div>
      <div style="font-size:22px;font-weight:900;color:#16a34a">${_amount(item['amount'])}</div>
      {note}
      {_congrats(item)}
    </div>"""

    cards_pt = "".join(_card(p) for p in payouts_info["payouts"])

    return f"""
  <div style="background:linear-gradient(135deg,#78350f,#451a03);border:2px solid #f59e0b;border-radius:14px;padding:22px 18px;margin-bottom:22px;text-align:center">
    <div style="font-size:20px;font-weight:900;color:white;margin-bottom:16px">🏆 Resultado Final do Bolão!</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
      {cards_pt}
    </div>
    <div style="font-size:13px;color:#fde68a;margin-bottom:14px">
      Obrigado a todos que participaram! Foi um prazer acompanhar a Copa do Brasil com vocês.
    </div>
    <div style="font-size:11px;color:#fbbf2480">Pote total: ${_amount(payouts_info['pot'])}</div>
  </div>
"""


# ── Email HTML builder ────────────────────────────────────────────────────────
def pts_color(pts):
    if pts >= 10: return "#16a34a"
    if pts >= 5:  return "#ca8a04"
    if pts > 0:   return "#2563eb"
    return "#9ca3af"


def leg_breakdown_items(state, phase_id, tie_id, leg, tie_just_decided, entries=None):
    """As linhas da tabela "Pontuação — <perna>" do e-mail, uma por entrada.

    Pontos e palpite saem EXATAMENTE de onde o site tira (audit_scoring.score_entry_site() e
    leg_pick_view(), que espelham scoreEntry() e renderPickDisplay() de app.js): numa fase
    derivada o palpite salvo sob o id de VAGA (sf-1/sf-2/final-1) aparece e pontua, o bonus de
    "quem avança" e por TIME previsto, e os nomes vem como "Real (Previsto)" quando a entrada
    previu outro clube para aquele lado. Nunca "sem palpite" quando o site acha um palpite.

    Devolve [{name, pts, pick_str, pick_teams, det_pt}] ordenado por pts desc, nome A→Z."""
    phases = state.get("phases", {}) or {}
    if entries is None:
        deleted = set(state.get("deletedIds", []))
        entries = [e for e in state.get("entries", []) if e.get("id") not in deleted]
    tie = (phases.get(phase_id, {}).get("ties", {}) or {})[tie_id]
    items = []
    for entry in entries:
        _, detail = audit_scoring.score_entry_site(entry, phases)
        r = detail["matches"].get(f"{tie_id}:{leg}")
        view = audit_scoring.leg_pick_view(entry, phases, phase_id, tie_id, leg)
        pts = r["pts"] if r else 0
        pick_teams = ""
        if r and view:
            # Texto explícito o bastante pra nunca parecer um erro à primeira vista — achado real
            # (Eduardo, 2026-08-01, sobre "+5 resultado certo" sozinho): "Talvez precise ficar
            # mais claro no email qual foi a pontuação e por que pontuou."
            det_pt = {
                "exact":  f"+{audit_scoring.MATCH_SCORING['exact']} placar exato",
                "result": f"+{audit_scoring.MATCH_SCORING['result']} resultado certo (vitória/empate/derrota) — placar não exato",
                "side":   f"+{pts} gols de 1 time certos — placar e resultado diferentes",
                "miss":   "—",
            }[r["type"]]
            pick_str = f'{view["goalsHome"]}–{view["goalsAway"]}'
            lt = audit_scoring.leg_teams(tie, leg, (tie.get("matches") or {}).get(leg))
            if (view["home"], view["away"]) != (lt["home"], lt["away"]):
                pick_teams = f'{view["home"]} × {view["away"]}'
        else:
            det_pt, pick_str = "sem palpite", "—"

        if tie_just_decided:
            dt = detail["ties"].get(tie_id)
            if dt:
                pts += dt["pts"]
                bonus_pt = f"+{audit_scoring.TIE_BONUS} acertou quem avança" if dt["type"] == "hit" else "errou quem avança"
                det_pt = f"{det_pt}, {bonus_pt}" if det_pt != "—" else bonus_pt

        items.append({"name": entry.get("entryName", "?"), "pts": pts, "pick_str": pick_str,
                      "pick_teams": pick_teams, "det_pt": det_pt})
    items.sort(key=lambda x: (-x["pts"], x["name"].upper()))
    return items


def build_html(state, phase_id, tie_id, leg, tie_just_decided):
    """Builds the result email HTML for one leg's completion. tie_just_decided: True when this
    same leg's completion also resolved the tie's qualifiedTeamId THIS run -- folds the tie
    bonus into the per-entry breakdown row, mirroring Copa's match_podium_bonus_note() fold-in
    for M103/M104.

    PT-only — Eduardo, 2026-08-01: "Não precisa versão em inglês" (unlike the Copa's script,
    which stays bilingual PT/EN by its own design — this is a CDB2026-specific choice, not a
    platform-wide one)."""
    entries = state.get("entries", [])
    deleted_ids = set(state.get("deletedIds", []))
    real_entries = [e for e in entries if e.get("id") not in deleted_ids]

    all_ties = _all_ties(state)
    phases = state.get("phases", {}) or {}
    podium = official_podium(phases)

    def _name_key(item):
        return (item["e"].get("entryName") or "").upper()

    scored = sorted(
        [{"e": e, "total": score_entry_total(e, all_ties, podium, phases=phases),
          "detail": entry_detail(e, all_ties, podium, phases=phases)} for e in real_entries],
        key=lambda x: (-x["total"], -hit_champion(x["detail"]), -hit_runner_up(x["detail"]), -exact_match_count(x["detail"])),
    )
    i = 0
    while i < len(scored):
        j = i
        key = (scored[i]["total"], hit_champion(scored[i]["detail"]), hit_runner_up(scored[i]["detail"]), exact_match_count(scored[i]["detail"]))
        while j < len(scored) and (scored[j]["total"], hit_champion(scored[j]["detail"]), hit_runner_up(scored[j]["detail"]), exact_match_count(scored[j]["detail"])) == key:
            j += 1
        scored[i:j] = sorted(scored[i:j], key=_name_key, reverse=True)
        i = j

    tie = all_ties[tie_id]
    match = tie["matches"][leg]
    lt = audit_scoring.leg_teams(tie, leg, match)
    home, away = lt["home"], lt["away"]
    result_str = f'{home} {match["goalsHome"]}–{match["goalsAway"]} {away}'
    leg_label_pt = "" if leg == "single" else " (ida)" if leg == "first" else " (volta)"

    winner_name = ""
    if tie_just_decided:
        winner_name = tie["teamA"] if tie["qualifiedTeamId"] == "A" else tie["teamB"]

    # ── Per-entry breakdown for this leg ──────────────────────────────────────
    # Eduardo, 2026-08-02, pasting a sent email as evidence: this table wasn't sorted by its own
    # "Pts" column at all — it inherited `scored`'s order (season total). Sorted by this leg's own
    # points (descending), entry name (A→Z) as the tiebreak — see leg_breakdown_items().
    breakdown_rows_pt = ""
    breakdown_items = leg_breakdown_items(state, phase_id, tie_id, leg, tie_just_decided,
                                          entries=[item["e"] for item in scored])
    for b in breakdown_items:
        color = pts_color(b["pts"])
        pick_cell = b["pick_str"]
        if b.get("pick_teams"):
            # Os times DO PALPITE, como "Ver palpites" mostra: "Real (Previsto)" quando a entrada
            # previu outro clube naquele lado da vaga.
            pick_cell += f'<div style="font-size:10px;color:#6b7280;margin-top:2px">{_html.escape(b["pick_teams"])}</div>'
        breakdown_rows_pt += (
            f'<tr><td style="padding:6px 10px">{b["name"]}</td>'
            f'<td style="padding:6px 10px;text-align:center">{pick_cell}</td>'
            f'<td style="padding:6px 10px;text-align:center;font-weight:700;color:{color}">{b["pts"]}</td>'
            f'<td style="padding:6px 10px;font-size:11px;color:#6b7280">{b["det_pt"]}</td></tr>'
        )

    # ── Ranking ───────────────────────────────────────────────────────────────
    ranking_rows = ""
    prev_key = None
    rank = 0
    for i, item in enumerate(scored):
        key = (item["total"], hit_champion(item["detail"]), hit_runner_up(item["detail"]), exact_match_count(item["detail"]))
        if key != prev_key:
            rank = i + 1
        prev_key = key
        medal = {1: "🥇", 2: "🥈", 3: "🥉"}.get(rank, f"{rank}.")
        bg = "#fffbe6" if rank <= 3 else "white"
        ranking_rows += (
            f'<tr style="background:{bg}">'
            f'<td style="padding:7px 10px;text-align:center">{medal}</td>'
            f'<td style="padding:7px 10px">{item["e"].get("entryName","?")}</td>'
            f'<td style="padding:7px 10px;text-align:center;font-weight:700;color:{pts_color(item["total"])}">{item["total"]}</td></tr>'
        )

    matches_played = sum(1 for t in all_ties.values() for m in t.get("matches", {}).values() if m.get("goalsHome") is not None)
    phase_name = PHASE_BY_ID[phase_id]["name"]
    label_pt = f"{phase_name} — {tie['teamA']} × {tie['teamB']}{leg_label_pt}"
    winner_line_pt = f'✓ {winner_name} avança' if winner_name else ""

    thead_style = 'style="background:#f1f5f9"'
    th = 'style="padding:8px 10px;text-align:left;font-weight:600;color:#374151"'
    tbl = 'style="width:100%;border-collapse:collapse;background:white;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:13px;margin-bottom:20px"'

    return f"""
<div style="font-family:sans-serif;max-width:620px;margin:0 auto;color:#1a1a1a">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#059669,#065f46);color:white;padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:26px;font-weight:700;margin-bottom:4px">🏅 Bolão do Ferrari — Copa do Brasil 2026</div>
    <div style="opacity:.8;font-size:13px">Atualização de resultados</div>
  </div>

  <div style="background:#f8fafc;padding:20px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">

    <div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:16px">
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">{label_pt}</div>
      <div style="font-size:16px;font-weight:700">{result_str}</div>
      <div style="font-size:13px;color:#16a34a;margin-top:4px">{winner_line_pt}</div>
    </div>

    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">Pontuação — {label_pt}</div>
    <table {tbl}>
      <thead><tr {thead_style}>
        <th {th}>Entrada</th>
        <th {th} style="text-align:center">Palpite</th>
        <th {th} style="text-align:center">Pts</th>
        <th {th}>Detalhes</th>
      </tr></thead>
      <tbody>{breakdown_rows_pt}</tbody>
    </table>
    <div style="font-size:11px;color:#9ca3af;margin-top:-14px;margin-bottom:20px">
      Placar exato = {audit_scoring.MATCH_SCORING['exact']} pts &nbsp;·&nbsp;
      Resultado certo (V/E/D), placar não exato = {audit_scoring.MATCH_SCORING['result']} pts &nbsp;·&nbsp;
      Gols exatos de 1 time = {audit_scoring.MATCH_SCORING['side']} pt <em>(por time, não por gol — só conta se nem o placar nem o resultado bateram)</em> &nbsp;·&nbsp;
      Quem avança = {audit_scoring.TIE_BONUS} pts &nbsp;·&nbsp; Campeão = {audit_scoring.PODIUM_BONUS['champion']} pts &nbsp;·&nbsp; Vice = {audit_scoring.PODIUM_BONUS['runnerUp']} pts
    </div>

    <div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">🏅 Ranking atual ({matches_played} partidas)</div>
    <table {tbl}>
      <thead><tr {thead_style}>
        <th {th} style="text-align:center">#</th>
        <th {th}>Entrada</th>
        <th {th} style="text-align:center">Total</th>
      </tr></thead>
      <tbody>{ranking_rows}</tbody>
    </table>

    <div style="height:1px;background:#e2e8f0;margin:20px 0"></div>
    <div style="text-align:center;font-size:12px;color:#9ca3af">
      <a href="{SITE_URL}" style="color:#059669;text-decoration:none">ferrarilabs.github.io/bolao/cdb2026/</a>
      &nbsp;·&nbsp; Bolão do Ferrari · Copa do Brasil 2026
    </div>

  </div>
</div>
"""


# ── Email sender — identical mechanism to the Copa's script ──────────────────
# ─── AUD-02 (auditoria 2026-08-09): TRANSPORTE REAL FALHA FECHADO ───────────────────────────
#
# O sender do Powerball já tinha trava (`_SEND_AUTHORIZED` + detecção de pytest). Este não tinha
# NADA: bastava executar o script — num teste, numa máquina local, por engano — para o provedor
# ser chamado de verdade e a mensagem chegar em gente real. Este repositório já viveu isso: um
# envio errado saiu para 15 pessoas.
#
# AUTORIZAÇÃO POSITIVA, não heurística negativa. O envio real só acontece quando alguém DECLARA
# que quer, via variável de ambiente, e a declaração vive no workflow de produção — não no código.
# Assim o padrão de qualquer execução não declarada (teste, CI, local, interativa) é: não envia.
#
# `_TRANSPORT` existe para o teste exercitar toda a lógica de montagem/envio sem rede: injetando
# um transporte falso, o caminho inteiro roda e nada sai. Sem ele, um teste que quisesse cobrir
# essa lógica teria de alcançar o provedor — que é exatamente o que não pode acontecer.
_TRANSPORT = None          # teste injeta um callable(url, body, headers) -> (status, texto)
_ALLOW_ENV = "BOLAO_ALLOW_REAL_SEND"
_ALLOW_TOKEN = "I UNDERSTAND"


def real_send_allowed():
    """(permitido, motivo). Fail-closed: só True com autorização explícita e fora de teste."""
    if os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("BOLAO_TEST_RUN"):
        return False, "processo de teste"
    if os.environ.get(_ALLOW_ENV) == _ALLOW_TOKEN:
        return True, None
    return False, f"sem autorizacao explicita ({_ALLOW_ENV})"


def send_email(addr, subject, html):
    # AUD-02: portão ANTES de qualquer chamada ao provedor. Zero chamadas quando bloqueado.
    if _TRANSPORT is None:
        allowed, why = real_send_allowed()
        if not allowed:
            msg = f"EMAIL_SEND_BLOCKED: {why}. Nenhuma mensagem enviada."
            print(f"BLOQUEADO {msg}")
            return False, msg
    addr = addr.strip().rstrip(",").strip()
    body = json.dumps({
        "service_id":  EMAILJS_SVC, "template_id": EMAILJS_TMPL, "user_id": EMAILJS_KEY,
        "template_params": {"to_email": addr, "entry_name": subject, "receipt_code": subject, "html_message": html},
    }).encode()
    # AUD-02: transporte injetável — o teste exercita todo o caminho sem tocar na rede.
    if _TRANSPORT is not None:
        return _TRANSPORT(EMAILJS_URL, body, EMAILJS_HEADERS)
    req = urllib.request.Request(EMAILJS_URL, data=body, headers=EMAILJS_HEADERS, method="POST")
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status


def _build_recipients(state):
    deleted_ids = set(state.get("deletedIds", []))
    recipients = {}
    for e in state.get("entries", []):
        if e.get("id") in deleted_ids:
            continue
        addr = (e.get("participantEmail") or "").strip().rstrip(",").strip()
        if "@" not in addr or "." not in addr.split("@")[-1]:
            continue
        recipients.setdefault(addr.lower(), addr)
    return recipients


def _entry_ref_for(state, addr):
    """Referência estável do participante para o ledger. NUNCA o e-mail.

    `bolao_notif_jobs.entry_ref` vira evidência operacional lida em log e em Issue; endereço de
    participante não entra ali. O id da entrada já identifica de forma única e não é PII.
    """
    alvo = (addr or "").strip().lower()
    deleted_ids = set(state.get("deletedIds", []))
    for e in state.get("entries", []):
        if e.get("id") in deleted_ids:
            continue
        if (e.get("participantEmail") or "").strip().rstrip(",").strip().lower() == alvo:
            return str(e.get("id"))
    return None


def _log_ref(state, addr):
    """Como um destinatário aparece NO LOG. Nunca o endereço.

    Este job roda num repositório PÚBLICO, e log de Actions de repo público é legível por qualquer
    pessoa, sem autenticação. A linha de sucesso imprimia `→ {addr}` cru — os 12 participantes reais
    em texto claro, permanentemente, a cada envio (Issue #397).

    A convenção correta já existia dez linhas acima, em `_entry_ref_for()`: o id da entrada
    identifica de forma única e NÃO é PII, e é exatamente o que o ledger grava. O log passa a usar a
    mesma referência.

    Fallback para endereço sem entrada correspondente (participante removido, digitação divergente):
    digest no MESMO formato de `mask()` em `scripts/pii_detectors.mjs` — o formato que o detector de
    PII deste repositório já reconhece —, nunca o endereço.
    """
    ref = _entry_ref_for(state, addr)
    if ref:
        return f"entry:{ref}"
    digest = hashlib.sha256(str(addr or "").encode()).hexdigest()[:8]
    return f"<redacted sha256:{digest} len:{len(str(addr or ''))}>"


def _send_to_all(state, html, subject, ledger_ref=None, ledger=None):
    """Envia para todos os participantes e, quando `ledger_ref` é dado, REGISTRA a entrega.

    ─── O LEDGER NUNCA BLOQUEIA O ENVIO ─────────────────────────────────────────────────────────
    Toda interação com o ledger aqui é fail-open. Se ele estiver fora, o e-mail sai do mesmo jeito e
    o log ganha uma linha `LEDGER_DEGRADED`. Isso é deliberado: este app já teve um incidente de
    DUPLICATA (#221, rodada 23 enviada 4× para 11 participantes reais) e um de AUSÊNCIA (HIST-037).
    Um portão que barra o envio quando o ledger não responde troca o segundo pelo primeiro, e o
    primeiro chega ao participante.

    Efeito na exatamente-uma-vez: PRESERVADA quando o ledger está fora (é o comportamento de hoje,
    onde a única guarda é a perna já estar salva e portanto não ser redescoberta); FORTALECIDA
    quando ele responde, porque `already_delivered` passa a ser uma segunda guarda independente.
    """
    recipients = _build_recipients(state)
    print(f"Sending to {len(recipients)} recipients...")

    reg = None
    if ledger_ref is not None:
        phase_id, tie_id, leg = ledger_ref
        reg = ledger if ledger is not None else _default_ledger()
        if reg is not None:
            refs = [r for r in (_entry_ref_for(state, a) for a in recipients.values()) if r]
            try:
                reg.reserve(phase_id, tie_id, leg, refs)
            except Exception as ex:  # noqa: BLE001 — jamais impedir o envio
                print(f"  LEDGER_DEGRADED reserve: {ex} — o envio CONTINUA.")

    sent, errors = 0, []
    for _, addr in recipients.items():
        try:
            status = send_email(addr, subject, html)
            print(f"  OK {status} → {_log_ref(state, addr)}  [{subject}]")
            sent += 1
            if reg is not None and ledger_ref is not None:
                ref = _entry_ref_for(state, addr)
                if ref:
                    try:
                        reg.mark_sent(ledger_ref[0], ledger_ref[1], ledger_ref[2], ref, status)
                    except Exception as ex:  # noqa: BLE001 — o e-mail já saiu; só o registro falhou
                        print(f"  LEDGER_DEGRADED mark_sent: {ex}")
            time.sleep(3)
        except Exception as ex:
            errors.append(f"{_log_ref(state, addr)}: {ex}")
            print(f"  ERR → {_log_ref(state, addr)}: {ex}")
            # Falha de provedor tem de virar `FAILED` no ledger (#352). Sem isto a linha ficava em
            # `pending`, indistinguivel de uma reserva que nunca chegou a tentar -- e o ambiguo e
            # justamente o que trava uma recuperacao depois.
            if reg is not None and ledger_ref is not None:
                ref = _entry_ref_for(state, addr)
                if ref and hasattr(reg, "mark_failed"):
                    try:
                        reg.mark_failed(ledger_ref[0], ledger_ref[1], ledger_ref[2], ref, str(ex))
                    except Exception:  # noqa: BLE001 — o ledger nunca bloqueia o envio
                        pass
    return sent, errors


def _default_ledger():
    """O ledger real, ou `None` se ele não puder sequer ser construído — nunca uma exceção."""
    try:
        from result_email_ledger import SupabaseResultEmailLedger
        return SupabaseResultEmailLedger()
    except Exception as ex:  # noqa: BLE001
        print(f"  LEDGER_DEGRADED init: {ex} — o envio CONTINUA sem registro.")
        return None


# ── Auto mode ─────────────────────────────────────────────────────────────────
def _kickoff_dt(iso):
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (ValueError, AttributeError, TypeError):
        return None


def espn_event_for_leg(candidates, tie, leg, legs, accept=lambda c: True):
    """Evento da ESPN que corresponde a uma perna, e o placar na ORIENTACAO DO BOLAO.

    Devolve (evento, gols_do_mandante_nominal, gols_do_visitante_nominal) ou (None, None, None).

    O mando nominal do bolao (ida: teamA em casa; volta: teamB) e estrutura de palpite, nao o
    mando real. Na semifinal de 2026 a CBF inverteu: Palmeiras x Vasco teve a ida no Allianz,
    enquanto o bolao tinha Vasco em casa na ida. Casar por mandante gravou o placar da ida na volta
    (2026-11-01) e deixou a ida vazia.

    Com TODAS as pernas datadas (inclusive o jogo unico da final), casa pelo PAR de times e escolhe
    a perna cuja data e a mais proxima do evento; o placar e traduzido pelo NOME do time, nunca pela posicao. Sem todas as
    datas, a perna mais proxima nao e decidivel e vale a regra antiga (mandante igual, janela).
    """
    home = tie["teamB"] if leg == "second" else tie["teamA"]
    away = tie["teamA"] if leg == "second" else tie["teamB"]
    kicks = {l: _kickoff_dt((tie.get("matches", {}).get(l) or {}).get("kickoff")) for l in legs}
    # Jogo unico (final): uma perna so, entao "a mais proxima" e ela mesma -- mas o mando real
    # (definido pela CBF) pode ser o inverso do nominal do bolao, e o casamento tem de ser por par.
    if all(kicks.values()):
        par = {tie["teamA"], tie["teamB"]}
        for c in candidates:
            if {c["homeTeam"], c["awayTeam"]} != par or not accept(c):
                continue
            quando = _kickoff_dt(c.get("dateISO"))
            if not quando:
                continue
            mais_perto = min(legs, key=lambda l: abs((quando - kicks[l]).total_seconds()))
            if mais_perto != leg or not within_result_match_window(c["dateISO"], (tie["matches"][leg] or {}).get("kickoff")):
                continue
            if c["homeTeam"] == home:
                return c, c.get("homeScore"), c.get("awayScore")
            return c, c.get("awayScore"), c.get("homeScore")
        return None, None, None
    anchor = (tie.get("matches", {}).get(leg) or {}).get("kickoff") or next(
        ((tie.get("matches", {}).get(l) or {}).get("kickoff") for l in legs
         if (tie.get("matches", {}).get(l) or {}).get("kickoff")), None)

    def _e_de_outra_perna(c):
        # Sem data nesta perna, um jogo a menos de 48h do horario CONHECIDO de outra perna e o jogo
        # daquela perna (mando invertido), nunca deste -- foi assim que a ida virou volta.
        quando = _kickoff_dt(c.get("dateISO"))
        return bool(quando) and any(
            kicks[l] and abs((quando - kicks[l]).total_seconds()) < 48 * 3600
            for l in legs if l != leg)

    ev = next((c for c in candidates
               if c["homeTeam"] == home and c["awayTeam"] == away and accept(c)
               and within_result_match_window(c["dateISO"], anchor)
               and (kicks[leg] or not _e_de_outra_perna(c))), None)
    if not ev:
        return None, None, None
    return ev, ev.get("homeScore"), ev.get("awayScore")


def _find_new_legs(state, espn_candidates):
    """Scans ONLY the active phase's ties (mirrors autoSyncEspnResults()' own scope in app.js —
    the phase the admin/ESPN sync currently considers 'live'), returns a list of
    (phase_id, tie_id, leg, goalsHome, goalsAway, event) for legs not yet saved."""
    phase_id = state.get("espnSync", {}).get("activePhaseId")
    if not phase_id or phase_id not in PHASE_BY_ID:
        return []
    fmt = PHASE_BY_ID[phase_id]["format"]
    legs = legs_for_format(fmt)
    ties = state.get("phases", {}).get(phase_id, {}).get("ties", {}) or {}
    found = []
    for tie_id, tie in ties.items():
        if not tie.get("teamA") or not tie.get("teamB"):
            continue
        for leg in legs:
            m = tie.get("matches", {}).get(leg) or {}
            if m.get("goalsHome") is not None:
                continue  # already saved
            ev, gh, ga = espn_event_for_leg(espn_candidates, tie, leg, legs,
                                            accept=lambda c: c["homeScore"] is not None)
            if not ev:
                continue
            found.append((phase_id, tie_id, leg, gh, ga, ev))
    return found


def _maybe_decide_tie(state, phase_id, tie_id, espn_candidates):
    """After a leg save, checks whether the tie is now fully resolved (both legs have scores) and
    not yet locked -- if so, determines the winner exactly like aggregateOrSingleTotals() +
    autoSyncEspnResults()' penalty-winner fallback in app.js, and locks it. Returns the qualified
    side ('A'/'B') if newly decided this call, else None."""
    tie = state["phases"][phase_id]["ties"][tie_id]
    if tie.get("qualifiedTeamId"):
        return None
    fmt = PHASE_BY_ID[phase_id]["format"]
    legs = legs_for_format(fmt)
    if not all(tie["matches"].get(l, {}).get("goalsHome") is not None for l in legs):
        return None

    if fmt == "TWO_LEG":
        first, second = tie["matches"]["first"], tie["matches"]["second"]
        total_a = first["goalsHome"] + second["goalsAway"]
        total_b = first["goalsAway"] + second["goalsHome"]
    else:
        single = tie["matches"]["single"]
        total_a, total_b = single["goalsHome"], single["goalsAway"]

    if total_a != total_b:
        return "A" if total_a > total_b else "B"

    # Aggregate tied — only decides via penalties if ESPN reports an explicit winner on the
    # decisive leg, never guessed (same as autoSyncEspnResults()).
    decisive_leg = "second" if fmt == "TWO_LEG" else "single"
    ev, _, _ = espn_event_for_leg(espn_candidates, tie, decisive_leg, legs)
    # O vencedor e o TIME que a ESPN marcou; o lado sai do nome, nao do mando nominal da perna.
    if ev and ev.get("homeWinner"):
        return "A" if ev["homeTeam"] == tie["teamA"] else "B"
    if ev and ev.get("awayWinner"):
        return "A" if ev["awayTeam"] == tie["teamA"] else "B"
    return None  # no explicit penalty-winner signal yet — stays for the admin's manual flow


def run_auto():
    print("AUTO — running scoring/ranking self-audit before touching anything...")
    audit_ok, _ = audit_scoring.run_static_audit(verbose=True)
    if not audit_ok:
        print("\n🛑 SELF-AUDIT FAILED — refusing to send any emails until this is fixed.")
        sys.exit(1)
    print("✓ Self-audit passed.\n")

    print("AUTO — fetching Supabase state...")
    state = sb_fetch()

    print("AUTO — fetching ESPN candidates...")
    try:
        espn = fetch_espn_candidates()
    except Exception as ex:
        print(f"ESPN fetch failed: {ex}")
        # FONTE INDISPONÍVEL != FALHA NOSSA (2026-08-07). Antes daqui isto era `sys.exit(1)`, o que
        # deixava o cron VERMELHO a cada 10 minutos quando a ESPN recusava a conexão — observado em
        # produção com `SSL: TLSV1_ALERT_INTERNAL_ERROR` (a ESPN rejeitando o handshake TLS dos
        # runners do GitHub; antes já houve o bloqueio por user-agent, ver a branch fix-espn-403-ua).
        # Um cron cronicamente vermelho treina todo mundo a ignorar falha de cron — e a falha REAL
        # que importa (tinha resultado e não conseguimos enviar) fica indistinguível do ruído.
        #
        # A ESPN aqui é a fonte de DESCOBERTA: sem ela não há nada para agir, e nada conhecido é
        # descartado (o estado do Supabase já foi lido acima e não é modificado). Então o correto é
        # encerrar limpo e tentar no ciclo seguinte, com uma linha de log distintiva e "grepável"
        # para a indisponibilidade continuar OBSERVÁVEL.
        #
        # Não é invenção: este é exatamente o padrão que a re-checagem da Copa já usava
        # ("skipping this cycle, will retry next run"). Aqui ele passa a valer também para a busca
        # principal. Mesma semântica do teste de "delayed source" do outbox do Batch 1: a fonte
        # atrasa, o ciclo seguinte recupera, nada é perdido nem duplicado.
        print("SOURCE_UNAVAILABLE — nada descoberto neste ciclo; tentando de novo na próxima execução.")
        sys.exit(0)

    try:
        patched = sb_backfill_schedule(espn)
        if patched:
            print(f"AUTO — backfilled kickoff/venue for {patched} leg(s) missing schedule info.")
            state = sb_fetch()  # re-fetch so downstream logic sees the patched kickoff fields
    except Exception as ex:
        print(f"Schedule backfill failed: {ex} — continuing with result check.")

    new_legs = _find_new_legs(state, espn)

    if not new_legs:
        try:
            live_now = [c for c in espn if c.get("state") == "in"]
            if live_now:
                # Anchored to the live match's REAL kickoff time, not to time.time() at loop
                # start — real incident, 2026-08-04: Athletico-PR x Vitória (CDB2026) kicked off
                # 00:00 UTC; this workflow's own cron tick didn't start running until 00:11:42
                # (ordinary */10 cron granularity, not itself a bug); the OLD `time.time()+80*60`
                # deadline measured 80 minutes from THAT run-start, not from kickoff, so it closed
                # at 01:32:04 — about 4 minutes before the match's real finish (~01:36 UTC,
                # 90min+stoppage+halftime per ESPN's own clock/period data) — and gave up with
                # nothing saved or emailed until manually re-triggered. A cron tick landing a few
                # minutes late (routine — cron fires on a 10-minute grid, kickoff doesn't) was
                # silently eating into a fixed run-relative window instead of the actual match
                # duration. 130min = 90 regulation + ~15 halftime + ~10 stoppage + margin.
                try:
                    anchor_iso = min(c["dateISO"] for c in live_now if c.get("dateISO"))
                    deadline = datetime.fromisoformat(anchor_iso.replace("Z", "+00:00")).timestamp() + 130 * 60
                except (ValueError, TypeError, KeyError):
                    deadline = time.time() + 80 * 60  # dateISO missing/unparseable — old behavior as a fallback, not the norm
                print(f"Jogo ao vivo detectado — monitorando até terminar (poll a cada 2 min, prazo ancorado no kickoff real)...")
                while time.time() < deadline:
                    remaining = int((deadline - time.time()) / 60)
                    print(f"  [{remaining} min restantes] Aguardando 120s...")
                    time.sleep(120)
                    try:
                        espn = fetch_espn_candidates()
                    except Exception as ex:
                        print(f"  ESPN re-fetch falhou: {ex} — continuando loop")
                        continue
                    new_legs = _find_new_legs(state, espn)
                    if new_legs:
                        print(f"  Perna(s) finalizada(s) detectada(s)!")
                        break
                    try:
                        if not any_cdb_match_live():
                            print("  Nenhum jogo ao vivo detectado. Encerrando monitoramento.")
                            break
                    except Exception:
                        pass
                else:
                    print("Monitoramento encerrado por timeout (prazo ancorado no kickoff esgotado). Próximo cron tentará novamente.")
                    return
                if not new_legs:
                    print("Nenhum resultado detectado após monitoramento. Encerrando.")
                    return
            else:
                print("ESPN: nenhum jogo novo ou ao vivo. Nada a fazer.")
                return
        except Exception as ex:
            print(f"Verificação de jogo ao vivo falhou: {ex} — encerrando normalmente.")
            return

    print(f"New legs found: {[(t, l) for _, t, l, *_ in new_legs]}")

    # Stability re-check — same anti-flicker safeguard as the Copa's script: re-fetch ESPN after
    # 20s and require the score to match exactly before trusting it enough to email everyone.
    print("AUTO — re-checking ESPN after 20s to confirm results are stable before emailing...")
    time.sleep(20)
    try:
        espn_confirm = fetch_espn_candidates()
    except Exception as ex:
        print(f"ESPN re-check fetch failed: {ex} — skipping this cycle, will retry next run.")
        return

    confirmed = []
    for phase_id, tie_id, leg, gh, ga, ev in new_legs:
        home, away = ev["homeTeam"], ev["awayTeam"]
        # Mesmo evento (mesmos times, mesma data) na segunda leitura; compara o placar CRU da ESPN,
        # nao o ja traduzido para a orientacao do bolao.
        ev2 = next((c for c in espn_confirm if c["homeTeam"] == home and c["awayTeam"] == away
                    and c["dateISO"] == ev["dateISO"] and c["homeScore"] is not None), None)
        if not ev2 or ev2["homeScore"] != ev["homeScore"] or ev2["awayScore"] != ev["awayScore"]:
            print(f"  WARN {tie_id}:{leg}: result not stable across two checks — skipping for now, will retry next run.")
            continue
        real_ok, real_detail = audit_scoring.check_match_is_real(ev2["dateISO"], home, away)
        shape_ok, shape_detail = audit_scoring.check_result_shape({"goalsHome": gh, "goalsAway": ga})
        if not (real_ok and shape_ok):
            print(f"  🛑 WARN {tie_id}:{leg}: failed runtime sanity check — {real_detail} {shape_detail} — skipping, will NOT save or email.")
            continue
        confirmed.append((phase_id, tie_id, leg, gh, ga, ev["dateISO"]))

    if not confirmed:
        print("No legs confirmed stable. Nothing to do this cycle.")
        return

    print(f"Confirmed stable: {[(t, l) for _, t, l, *_ in confirmed]}")

    for i, (phase_id, tie_id, leg, gh, ga, event_key) in enumerate(confirmed):
        tie_before = state["phases"][phase_id]["ties"][tie_id]
        home = tie_before["teamB"] if leg == "second" else tie_before["teamA"]
        away = tie_before["teamA"] if leg == "second" else tie_before["teamB"]
        print(f"\n[{tie_id}:{leg}] {home} {gh}–{ga} {away}")

        sb_status, _ = sb_save_leg(phase_id, tie_id, leg, gh, ga, source="espn-auto", event_key=event_key)
        print(f"  Supabase (leg save): {sb_status}")

        # O estado vem do SERVIDOR depois de cada mutacao -- nunca do retorno do gravador.
        #
        # Ate 2026-08-26 esta linha era `sb_status, state = sb_save_leg(...)`. Isso valia enquanto
        # `sb_save_leg()` era read-modify-write e devolvia o documento inteiro; com a migracao para
        # mutacao estreita (commit 6ecd9fdf, 2026-08-12) ela passou a devolver `(status, None)` e a
        # chamada aqui nao acompanhou. O resultado era gravado, `_maybe_decide_tie(None, ...)`
        # estourava `TypeError` no primeiro `state["phases"]`, e o processo morria ANTES de renderizar
        # o e-mail, ANTES de reservar no ledger e ANTES de chamar o provedor: placar salvo, ninguem
        # avisado. Foi assim que a perna `quartas:espn-atletico-mg_cruzeiro:first` (Cruzeiro 1-1
        # Atletico-MG, 2026-08-26T02:01:38Z) ficou sem e-mail -- e foi o vigia da #180 que apontou.
        #
        # Buscar aqui nao e leitura redundante: e a leitura que ja existia logo abaixo, movida para
        # ANTES da primeira decisao que depende do estado. A mutacao continua estreita e do lado do
        # servidor; o que muda e de onde o processo aprende o resultado dela.
        state = sb_fetch()

        qualified = _maybe_decide_tie(state, phase_id, tie_id, espn)
        tie_just_decided = False
        if qualified:
            lock_status, _ = sb_lock_tie(phase_id, tie_id, qualified, source="espn-auto")
            print(f"  Supabase (lock-tie): {lock_status} → {tie_before['teamA'] if qualified == 'A' else tie_before['teamB']} avança")
            tie_just_decided = True
            # So relemos de novo quando o travamento mudou o documento -- o ranking e o bloco de
            # campeao precisam enxergar `qualifiedTeamId`. Sem travamento, o estado acima ja e o
            # posterior a gravacao desta perna.
            state = sb_fetch()

        tie = state["phases"][phase_id]["ties"][tie_id]
        html = build_html(state, phase_id, tie_id, leg, tie_just_decided)
        result_line = f"{home} {gh}–{ga} {away}"
        subj = f"Resultado Parcial — {tie_before['teamA']} × {tie_before['teamB']}: {result_line}"

        if phase_id == "final" and tie_just_decided:
            payouts_info = compute_final_payouts(state)
            if payouts_info:
                html = build_podium_html(payouts_info) + html
                champion = tie["teamA"] if tie["qualifiedTeamId"] == "A" else tie["teamB"]
                subj = f"🏆 Resultado Final do Bolão! · Final Bolão Result! — Campeão: {champion}"
                print(f"  🏆 Tournament complete — including podium/prize block ({len(payouts_info['payouts'])} payouts, pot ${payouts_info['pot']})")

        sent, errors = _send_to_all(state, html, subj, ledger_ref=(phase_id, tie_id, leg))
        print(f"  → {sent} sent, {len(errors)} errors")
        for err in errors:
            print(f"    ERROR: {err}")

        if i < len(confirmed) - 1:
            print("  Waiting 10s before next leg...")
            time.sleep(10)

    print(f"\n✓ AUTO done: {len(confirmed)} new leg(s) processed.")


# ── Dry-run: renderizar o e-mail a partir de um arquivo, SEM enviar ─────────────────────────
#
# `--render <phaseId> <tieId> <leg> --state-file <estado.json> --out <arquivo.html>`
#
# Para o operador conferir o e-mail EXATO (ex.: o da correcao de uma perna) antes de qualquer
# envio. Le o estado de um arquivo (o documento de bolao_state, ou {"state": ...}), monta o mesmo
# HTML de build_html() e grava em --out. NAO fala com Supabase, NAO toca no ledger, e NAO chama
# send_email() nem _send_to_all() -- nem com BOLAO_ALLOW_REAL_SEND. `--tie-decided` /
# `--no-tie-decided` forcam a linha de "quem avança"; sem eles vale: confronto ja travado E esta e
# a ultima perna do formato.
def subject_for(phase_id, tie):
    e_o_campeao = phase_id == "final" and bool(tie.get("qualifiedTeamId"))
    if e_o_campeao:
        campeao = tie["teamA"] if tie["qualifiedTeamId"] == "A" else tie["teamB"]
        return _subject_policy.assunto(
            "FUTEBOL_RESULTADO_FINAL_CAMPEAO",
            f"Resultado final — Copa do Brasil 2026: {campeao} campeão")
    return _subject_policy.assunto(
        "FUTEBOL_RESULTADO_PARCIAL",
        f"Resultado Parcial — {tie['teamA']} × {tie['teamB']}")


def render_from_file(phase_id, tie_id, leg, state_file, out_path, tie_decided=None):
    """Dry-run puro: (assunto, html). Nunca envia, nunca grava fora de `out_path`."""
    with open(state_file, encoding="utf-8") as f:
        doc = json.load(f)
    state = doc["state"] if isinstance(doc, dict) and isinstance(doc.get("state"), dict) else doc
    if phase_id not in PHASE_BY_ID:
        raise SystemExit(f"fase desconhecida: {phase_id!r}")
    ties = (state.get("phases", {}).get(phase_id, {}) or {}).get("ties", {}) or {}
    if tie_id not in ties:
        raise SystemExit(f"confronto {tie_id!r} nao existe em phases.{phase_id}.ties")
    legs = legs_for_format(PHASE_BY_ID[phase_id]["format"])
    if leg not in legs:
        raise SystemExit(f"perna {leg!r} invalida para {phase_id} (validas: {legs})")
    tie = ties[tie_id]
    m = (tie.get("matches") or {}).get(leg) or {}
    if m.get("goalsHome") is None or m.get("goalsAway") is None:
        raise SystemExit(f"{tie_id}:{leg} nao tem placar no estado -- nao ha e-mail de resultado a renderizar")
    if tie_decided is None:
        tie_decided = bool(tie.get("qualifiedTeamId")) and leg == legs[-1]
    if tie_decided and not tie.get("qualifiedTeamId"):
        raise SystemExit("--tie-decided pedido, mas o confronto nao tem qualifiedTeamId")
    html = build_html(state, phase_id, tie_id, leg, tie_just_decided=tie_decided)
    if out_path:
        Path(out_path).write_text(html, encoding="utf-8")
    # O assunto vem de subject_for() -> _subject_policy.assunto(), o mesmo do envio real.
    return subject_for(phase_id, tie), html


def _main_render(args):
    idx = args.index("--render")
    try:
        phase_id, tie_id, leg = args[idx + 1], args[idx + 2], args[idx + 3]
    except IndexError:
        print("Usage: --render <phaseId> <tieId> <leg> --state-file <estado.json> --out <arquivo.html>")
        sys.exit(1)

    def _opt(name):
        if name not in args:
            return None
        j = args.index(name)
        if j + 1 >= len(args):
            print(f"{name} precisa de um valor")
            sys.exit(1)
        return args[j + 1]
    state_file, out = _opt("--state-file"), _opt("--out")
    if not state_file or not out:
        print("--render exige --state-file e --out (o dry-run nunca le o Supabase).")
        sys.exit(1)
    decided = True if "--tie-decided" in args else False if "--no-tie-decided" in args else None
    subject, html = render_from_file(phase_id, tie_id, leg, state_file, out, tie_decided=decided)
    print(f"DRY-RUN (nada enviado): assunto: {subject}")
    print(f"  html: {out} ({len(html)} bytes)")


# ── Correção de uma perna já gravada (2026-11-01) ─────────────────────────────────────────────
#
# `--send-leg <phaseId> <tieId> <leg> --note-file <aviso.html> [--only-entry <nome> | --all]`
#
# Reenvia o e-mail de UMA perna já gravada no servidor, com um aviso de correção no topo. Nasceu da
# semifinal de 2026-11-01: o 1-0 da ida foi gravado na volta e saiu e-mail errado; depois de corrigir
# o dado (apply_correction.py), a ida já está salva, então o --auto nunca a redescobre e nenhum
# e-mail certo sairia sozinho.
#
#   --only-entry <nome>  TESTE: só para o e-mail daquela entrada, assunto com [TESTE], sem ledger.
#   --all                todos, registrando no ledger na identidade (fase, confronto, perna).
#                        RECUSA se o ledger já tiver entrega dessa perna -- duas correções iguais na
#                        caixa de 12 pessoas é o incidente #221 de novo.
# Um dos dois é obrigatório: não existe padrão que mande para todos.
def _send_leg(args):
    idx = args.index("--send-leg")
    try:
        phase_id, tie_id, leg = args[idx + 1], args[idx + 2], args[idx + 3]
    except IndexError:
        raise SystemExit("Usage: --send-leg <phaseId> <tieId> <leg> --note-file <html> (--only-entry <nome> | --all)")

    def _opt(name):
        if name not in args:
            return None
        j = args.index(name)
        if j + 1 >= len(args):
            raise SystemExit(f"{name} precisa de um valor")
        return args[j + 1]
    note_file, only = _opt("--note-file"), _opt("--only-entry")
    todos = "--all" in args
    if not note_file or (bool(only) == todos):
        raise SystemExit("--send-leg exige --note-file e exatamente um entre --only-entry <nome> e --all")
    nota = Path(note_file).read_text(encoding="utf-8")

    state = sb_fetch()
    tie = (state.get("phases", {}).get(phase_id, {}).get("ties", {}) or {}).get(tie_id)
    if not tie:
        raise SystemExit(f"confronto {phase_id}/{tie_id} inexistente")
    m = (tie.get("matches", {}) or {}).get(leg) or {}
    if m.get("goalsHome") is None or m.get("goalsAway") is None:
        raise SystemExit(f"{phase_id}/{tie_id}/{leg} sem placar gravado -- nada a corrigir")
    home = tie["teamB"] if leg == "second" else tie["teamA"]
    away = tie["teamA"] if leg == "second" else tie["teamB"]
    html = nota + build_html(state, phase_id, tie_id, leg, tie_just_decided=bool(tie.get("qualifiedTeamId")))
    texto = f"CORREÇÃO — Resultado Parcial — {tie['teamA']} × {tie['teamB']}: {home} {m['goalsHome']}–{m['goalsAway']} {away}"

    if only:
        alvo = [e for e in state.get("entries", []) if (e.get("entryName") or "").strip() == only.strip()
                and e.get("id") not in set(state.get("deletedIds", []))]
        if len(alvo) != 1:
            raise SystemExit(f"--only-entry {only!r}: esperava 1 entrada, achei {len(alvo)}")
        teste = dict(state)
        teste["entries"] = alvo
        subject = _subject_policy.assunto("FUTEBOL_RESULTADO_PARCIAL", "[TESTE] " + texto)
        sent, errors = _send_to_all(teste, html, subject, ledger_ref=None)
    else:
        reg = _default_ledger()
        if reg is None:
            raise SystemExit("ledger indisponivel: sem ele nao da para provar que esta correcao ainda nao saiu")
        from result_email_ledger import entity_id
        if entity_id(phase_id, tie_id, leg) in reg.delivered_entity_ids("2026-01-01T00:00:00Z"):
            raise SystemExit(f"o ledger ja tem entrega de {phase_id}/{tie_id}/{leg}: correcao NAO reenviada")
        subject = _subject_policy.assunto("FUTEBOL_RESULTADO_PARCIAL", texto)
        sent, errors = _send_to_all(state, html, subject, ledger_ref=(phase_id, tie_id, leg), ledger=reg)
    print(f"\n{'✓' if not errors else '⚠'} {sent} sent, {len(errors)} errors  [{subject}]")
    for err in errors:
        print(f"  ERROR: {err}")
    if errors:
        sys.exit(1)


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    args = sys.argv[1:]

    if "--render" in args:
        _main_render(args)
        return

    if "--send-leg" in args:
        _send_leg(args)
        return

    if "--auto" in args:
        run_auto()
        return

    if "--clear-leg" in args:
        idx = args.index("--clear-leg")
        try:
            tie_id, leg = args[idx + 1], args[idx + 2]
        except IndexError:
            print("Usage: --clear-leg <tieId> <leg>")
            sys.exit(1)
        state = sb_fetch()
        phase_id = next((p["id"] for p in PHASES if tie_id in (state.get("phases", {}).get(p["id"], {}).get("ties", {}) or {})), None)
        if not phase_id:
            print(f"Tie {tie_id} not found in any phase.")
            sys.exit(1)
        sb_clear_leg(phase_id, tie_id, leg)
        return

    if "--update" in args:
        idx = args.index("--update")
        try:
            tie_id, leg, gh, ga = args[idx + 1], args[idx + 2], args[idx + 3], args[idx + 4]
        except IndexError:
            print("Usage: --update <tieId> <leg> <goalsHome> <goalsAway>")
            sys.exit(1)
        state = sb_fetch()
        phase_id = next((p["id"] for p in PHASES if tie_id in (state.get("phases", {}).get(p["id"], {}).get("ties", {}) or {})), None)
        if not phase_id:
            print(f"Tie {tie_id} not found in any phase.")
            sys.exit(1)
        tie = state["phases"][phase_id]["ties"][tie_id]
        home = tie["teamB"] if leg == "second" else tie["teamA"]
        away = tie["teamA"] if leg == "second" else tie["teamB"]
        print(f"Saving {tie_id}:{leg}: {home} {gh}–{ga} {away}...")
        status, _ = sb_save_leg(phase_id, tie_id, leg, gh, ga, source="admin")
        print(f"  Supabase: {status}")
        return

    # Default: send about the latest leg result already in Supabase
    print("Fetching state from Supabase...")
    state = sb_fetch()
    latest = None
    for phase in PHASES:
        for tie_id, tie in (state.get("phases", {}).get(phase["id"], {}).get("ties", {}) or {}).items():
            for leg, m in tie.get("matches", {}).items():
                if m.get("goalsHome") is not None:
                    latest = (phase["id"], tie_id, leg)
    if not latest:
        print("No completed leg results in Supabase. Nothing to send.")
        return
    phase_id, tie_id, leg = latest
    tie = state["phases"][phase_id]["ties"][tie_id]
    html = build_html(state, phase_id, tie_id, leg, tie_just_decided=bool(tie.get("qualifiedTeamId")))
    # O 🏆 é reservado ao e-mail que ANUNCIA O CAMPEÃO — e só ele. Na Copa do Brasil isso é
    # exatamente uma coisa: a fase `final` com o confronto já decidido. Resultado de qualquer
    # outra fase, inclusive a semifinal, é ⚽. Ver `bolao/shared/scripts/subject_policy.py`.
    e_o_campeao = phase_id == "final" and bool(tie.get("qualifiedTeamId"))
    if e_o_campeao:
        campeao = tie["teamA"] if tie["qualifiedTeamId"] == "A" else tie["teamB"]
        subject = _subject_policy.assunto(
            "FUTEBOL_RESULTADO_FINAL_CAMPEAO",
            f"Resultado final — Copa do Brasil 2026: {campeao} campeão")
    else:
        subject = _subject_policy.assunto(
            "FUTEBOL_RESULTADO_PARCIAL",
            f"Resultado Parcial — {tie['teamA']} × {tie['teamB']}")
    sent, errors = _send_to_all(state, html, subject, ledger_ref=(phase_id, tie_id, leg))
    print(f"\n{'✓' if not errors else '⚠'} {sent} sent, {len(errors)} errors")
    for err in errors:
        print(f"  ERROR: {err}")


if __name__ == "__main__":
    main()
