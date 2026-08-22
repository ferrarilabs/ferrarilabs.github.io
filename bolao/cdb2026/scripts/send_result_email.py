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


def sb_save_leg(phase_id, tie_id, leg, goals_home, goals_away, source="espn-auto"):
    """Grava UMA mao. O mando da volta (home=teamB) e calculado NO SERVIDOR a partir do confronto
    gravado -- nao e enviado daqui, senao um cliente poderia declara-lo ao contrario."""
    status, _ = _sb_rpc("save-leg", {
        "phaseId": phase_id, "tieId": tie_id, "leg": leg,
        "goalsHome": int(goals_home), "goalsAway": int(goals_away), "resultSource": source,
    }, _ref("save-leg", phase_id, tie_id, leg, int(goals_home), int(goals_away)))
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
def score_entry_total(entry, all_ties, podium):
    total, _ = audit_scoring.score_entry(entry, all_ties, podium)
    return total


def entry_detail(entry, all_ties, podium):
    _, detail = audit_scoring.score_entry(entry, all_ties, podium)
    return detail


def official_podium(all_phases_ties):
    """Champion/runnerUp from the Final phase's single tie — mirrors officialPodium() in app.js."""
    final_ties = all_phases_ties.get("final", {})
    if not final_ties:
        return {"champion": None, "runnerUp": None}
    tie_id = next(iter(final_ties))
    tie = final_ties[tie_id]
    if not tie.get("qualifiedTeamId"):
        return {"champion": None, "runnerUp": None}
    if tie["qualifiedTeamId"] == "A":
        return {"champion": tie["teamA"], "runnerUp": tie["teamB"]}
    return {"champion": tie["teamB"], "runnerUp": tie["teamA"]}


def predicted_podium(entry, all_phases_ties):
    """Mirrors predictedPodium() in app.js — derived from the entry's own qualified-pick on the
    Final phase's tie, never a separate stored field."""
    final_ties = all_phases_ties.get("final", {})
    if not final_ties:
        return {"champion": None, "runnerUp": None}
    tie_id = next(iter(final_ties))
    tie = final_ties[tie_id]
    pick = (entry.get("picks") or {}).get("qualified", {}).get(tie_id)
    if not pick:
        return {"champion": None, "runnerUp": None}
    if pick == "A":
        return {"champion": tie["teamA"], "runnerUp": tie["teamB"]}
    return {"champion": tie["teamB"], "runnerUp": tie["teamA"]}


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

    scored = sorted(
        [{"e": e, "total": score_entry_total(e, all_ties, podium),
          "detail": entry_detail(e, all_ties, podium)} for e in entries],
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
    podium = official_podium(state.get("phases", {}))

    def _name_key(item):
        return (item["e"].get("entryName") or "").upper()

    scored = sorted(
        [{"e": e, "total": score_entry_total(e, all_ties, podium), "detail": entry_detail(e, all_ties, podium)} for e in real_entries],
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
    home = tie["teamB"] if leg == "second" else tie["teamA"]
    away = tie["teamA"] if leg == "second" else tie["teamB"]
    result_str = f'{home} {match["goalsHome"]}–{match["goalsAway"]} {away}'
    leg_label_pt = "" if leg == "single" else " (ida)" if leg == "first" else " (volta)"

    winner_name = ""
    if tie_just_decided:
        winner_name = tie["teamA"] if tie["qualifiedTeamId"] == "A" else tie["teamB"]

    # ── Per-entry breakdown for this leg ──────────────────────────────────────
    # No "result" (correct W/D/L sign, wrong score) tier — matches audit_scoring.match_points()
    # exactly, which only ever returns "exact"/"side"/"miss" (see that module's 2026-08-01 fix).
    #
    # Eduardo, 2026-08-02, pasting a sent email as evidence: this table wasn't sorted by its own
    # "Pts" column at all — it inherited `scored`'s order, which is the SEASON-TOTAL ranking
    # (score_entry_total across every match so far), a different key entirely from the points a
    # given entry earned on THIS leg. Fixed by building a fresh list keyed on this leg's own
    # points (descending) with entry name (A→Z) as the tiebreak, computed as its own pass instead
    # of reusing `scored`'s order. Matches the pattern Copa's build_html() already uses
    # (`breakdown_scored`, a separate sort from its own season-ranking `scored`) — CDB2026 was the
    # one that had skipped that separation, not a platform-wide bug.
    breakdown_rows_pt = ""
    breakdown_items = []
    for item in scored:
        entry = item["e"]
        pick = (entry.get("picks") or {}).get("matches", {}).get(tie_id, {}).get(leg)
        result = {"goalsHome": match["goalsHome"], "goalsAway": match["goalsAway"]}
        r = audit_scoring.match_points(pick, result) if pick else None
        pts = r["pts"] if r else 0
        if r:
            # Texto explícito o bastante pra nunca parecer um erro à primeira vista — achado real
            # (Eduardo, 2026-08-01, sobre "+5 resultado certo" sozinho): "Talvez precise ficar
            # mais claro no email qual foi a pontuação e por que pontuou."
            det_pt = {
                "exact":  f"+{audit_scoring.MATCH_SCORING['exact']} placar exato",
                "result": f"+{audit_scoring.MATCH_SCORING['result']} resultado certo (vitória/empate/derrota) — placar não exato",
                "side":   f"+{pts} gols de 1 time certos — placar e resultado diferentes",
                "miss":   "—",
            }[r["type"]]
            pick_str = f'{pick["goalsHome"]}–{pick["goalsAway"]}'
        else:
            det_pt, pick_str = "sem palpite", "—"

        if tie_just_decided:
            qual_pick = (entry.get("picks") or {}).get("qualified", {}).get(tie_id)
            if qual_pick:
                hit = qual_pick == tie["qualifiedTeamId"]
                bonus_pts = audit_scoring.TIE_BONUS if hit else 0
                pts += bonus_pts
                bonus_pt = f"+{audit_scoring.TIE_BONUS} acertou quem avança" if hit else "errou quem avança"
                det_pt = f"{det_pt}, {bonus_pt}" if det_pt != "—" else bonus_pt

        name = entry.get("entryName", "?")
        breakdown_items.append({"name": name, "pts": pts, "pick_str": pick_str, "det_pt": det_pt})

    breakdown_items.sort(key=lambda x: (-x["pts"], x["name"].upper()))
    for b in breakdown_items:
        color = pts_color(b["pts"])
        breakdown_rows_pt += (
            f'<tr><td style="padding:6px 10px">{b["name"]}</td>'
            f'<td style="padding:6px 10px;text-align:center">{b["pick_str"]}</td>'
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
            print(f"  OK {status} → {addr}  [{subject}]")
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
            errors.append(f"{addr}: {ex}")
            print(f"  ERR → {addr}: {ex}")
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
        tie_kickoff_anchor = next((tie["matches"].get(l, {}).get("kickoff") for l in legs if tie["matches"].get(l, {}).get("kickoff")), None)
        for leg in legs:
            m = tie.get("matches", {}).get(leg) or {}
            if m.get("goalsHome") is not None:
                continue  # already saved
            home = tie["teamB"] if leg == "second" else tie["teamA"]
            away = tie["teamA"] if leg == "second" else tie["teamB"]
            ev = next((c for c in espn_candidates
                       if c["homeTeam"] == home and c["awayTeam"] == away and c["homeScore"] is not None
                       and within_result_match_window(c["dateISO"], m.get("kickoff") or tie_kickoff_anchor)), None)
            if not ev:
                continue
            found.append((phase_id, tie_id, leg, ev["homeScore"], ev["awayScore"], ev))
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
    decisive_home = tie["teamB"] if decisive_leg == "second" else tie["teamA"]
    decisive_away = tie["teamA"] if decisive_leg == "second" else tie["teamB"]
    anchor = tie["matches"].get(decisive_leg, {}).get("kickoff") or next((tie["matches"].get(l, {}).get("kickoff") for l in legs if tie["matches"].get(l, {}).get("kickoff")), None)
    ev = next((c for c in espn_candidates if c["homeTeam"] == decisive_home and c["awayTeam"] == decisive_away
               and within_result_match_window(c["dateISO"], anchor)), None)
    if ev and ev.get("homeWinner"):
        return "A" if decisive_home == tie["teamA"] else "B"
    if ev and ev.get("awayWinner"):
        return "A" if decisive_away == tie["teamA"] else "B"
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
        ev2 = next((c for c in espn_confirm if c["homeTeam"] == home and c["awayTeam"] == away and c["homeScore"] is not None), None)
        if not ev2 or ev2["homeScore"] != gh or ev2["awayScore"] != ga:
            print(f"  WARN {tie_id}:{leg}: result not stable across two checks — skipping for now, will retry next run.")
            continue
        real_ok, real_detail = audit_scoring.check_match_is_real(ev2["dateISO"], home, away)
        shape_ok, shape_detail = audit_scoring.check_result_shape({"goalsHome": gh, "goalsAway": ga})
        if not (real_ok and shape_ok):
            print(f"  🛑 WARN {tie_id}:{leg}: failed runtime sanity check — {real_detail} {shape_detail} — skipping, will NOT save or email.")
            continue
        confirmed.append((phase_id, tie_id, leg, gh, ga))

    if not confirmed:
        print("No legs confirmed stable. Nothing to do this cycle.")
        return

    print(f"Confirmed stable: {[(t, l) for _, t, l, *_ in confirmed]}")

    for i, (phase_id, tie_id, leg, gh, ga) in enumerate(confirmed):
        tie_before = state["phases"][phase_id]["ties"][tie_id]
        home = tie_before["teamB"] if leg == "second" else tie_before["teamA"]
        away = tie_before["teamA"] if leg == "second" else tie_before["teamB"]
        print(f"\n[{tie_id}:{leg}] {home} {gh}–{ga} {away}")

        sb_status, state = sb_save_leg(phase_id, tie_id, leg, gh, ga, source="espn-auto")
        print(f"  Supabase (leg save): {sb_status}")

        qualified = _maybe_decide_tie(state, phase_id, tie_id, espn)
        tie_just_decided = False
        if qualified:
            lock_status, state = sb_lock_tie(phase_id, tie_id, qualified, source="espn-auto")
            print(f"  Supabase (lock-tie): {lock_status} → {tie_before['teamA'] if qualified == 'A' else tie_before['teamB']} avança")
            tie_just_decided = True

        state = sb_fetch()  # re-fetch so this leg/lock appears in ranking + resolves final tie
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


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    args = sys.argv[1:]

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
