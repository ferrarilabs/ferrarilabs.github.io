"""
audit_scoring.py — Bolão Copa do Brasil 2026 scoring/ranking self-audit.

Run standalone:
  python3 audit_scoring.py

Why this exists: item 1 of docs/bolao/CONSISTENCY_MATRIX.md — the Copa has
had an equivalent script since a real July 2026 incident (a participant
questioned a rank change; the audit found send_result_email.py had
silently drifted from the site's own scoring logic — see
bolao/scripts/audit_scoring.py and bolao/CHANGELOG.md v4.57). CDB2026 moves
real money (US$5/entry) with real games starting 2026-08-01 and had no
equivalent protection at all.

This Python transcription of app.js's scoring formula (matchPoints/scoreEntry/tiebreak in
bolao/cdb2026/js/app.js) is transcribed by hand below and must be kept in sync manually whenever
that formula changes in app.js. If you change scoring in app.js, update
MATCH_SCORING/TIE_BONUS/PODIUM_BONUS below in the same patch, or this audit will keep passing
while silently testing the wrong formula.

2026-08-01: send_result_email.py (added alongside this comment) now exists and IMPORTS this
module's match_points()/score_entry() directly rather than reimplementing them a second time —
unlike the Copa's script (a truly independent reimplementation, where drift between the audit and
the email script is the actual risk being guarded against), there is only ONE Python
transcription of the scoring formula here, so drift between "the audit" and "the email script"
can't happen by construction. The risk that remains — this file vs. app.js itself — is exactly
what run_static_audit() below already guards, and is why send_result_email.py --auto still runs
it before touching anything.
Also runtime-checked by send_result_email.py --auto: check_match_is_real() and
check_result_shape() below, mirroring the exact same two functions in the Copa's
audit_scoring.py (CLAUDE.md's standing rule: any auto-email script must re-validate each
individual leg result at runtime -- event date not in the future, teams resolved, result shape
sane -- right before trusting it enough to save + email) — added 2026-08-01 alongside
send_result_email.py itself.

2026-08-01, same day, two corrections: `result` (5 pts, correct W/D/L sign with a wrong score)
was briefly removed under the mistaken belief it didn't match the Copa's rules, then reverted a
few hours later once Eduardo confirmed directly (pasting the full scoring table) that it IS a
real, intended CDB2026 rule -- CDB2026 and the Copa are not required to share identical per-match
scoring tiers, only the platform-shared values (10/5/1) happened to already line up. See
CHANGELOG.md for the full incident trail, both directions.
"""
import re
import pathlib
import sys
from datetime import datetime, timezone

# Valores AUTORITATIVOS das regras do bolao. Transcritos aqui de proposito -- este arquivo e a
# referencia contra a qual o config.js e conferido, nao uma copia que segue o config.
MATCH_SCORING = {"exact": 10, "result": 5, "side": 1}
TIE_BONUS = 5
PODIUM_BONUS = {"champion": 30, "runnerUp": 20}


def check_config_matches_rules():
    """O config.js REALMENTE vale o que as regras dizem?

    Ate 2026-08-12 este arquivo apenas TRANSCREVIA os valores ("keep in sync by hand") e nunca
    olhava o config. Medido por mutacao: trocar `exact: 10` por 15, ou `champion: 30` por 25, no
    config.js -- e a auditoria continuava VERDE. Ela conferia estrutura e exclusividade mutua,
    nunca os numeros que pagam.

    Duas copias da mesma constante e uma divergencia esperando acontecer; a diferenca aqui e que
    a divergencia sai em dinheiro. Agora a transcricao acima e a AUTORIDADE, e o config e
    conferido contra ela.
    """
    import re
    problemas = []
    cfg = (pathlib.Path(__file__).resolve().parents[1] / "js" / "config.js").read_text()
    bloco = cfg[cfg.index("scoring:"):]
    bloco = bloco[:bloco.index("emailjs:")]

    def num(campo):
        m = re.search(rf"\b{campo}\s*:\s*(\d+)", bloco)
        if not m:
            problemas.append(f"nao achei `{campo}` no bloco scoring do config.js")
            return None
        return int(m.group(1))

    esperado = {
        "exact": MATCH_SCORING["exact"], "result": MATCH_SCORING["result"],
        "side": MATCH_SCORING["side"], "tieBonus": TIE_BONUS,
        "champion": PODIUM_BONUS["champion"], "runnerUp": PODIUM_BONUS["runnerUp"],
    }
    for campo, valor in esperado.items():
        real = num(campo)
        if real is not None and real != valor:
            problemas.append(
                f"config.js diz {campo}={real}; as regras dizem {valor}. Se a regra mudou, ela "
                "muda NOS DOIS lugares no mesmo commit -- e mudanca de scoring exige "
                "autorizacao explicita do Eduardo")

    # Sem terceiro lugar na Copa do Brasil: um bonus de 3o/4o aqui seria outra competicao.
    if re.search(r"\b(third|fourth|terceiro|quarto)\s*:", bloco):
        problemas.append("apareceu bonus de 3o/4o lugar — a Copa do Brasil nao tem disputa de terceiro")

    return (not problemas), "; ".join(problemas)


def match_points(pick, result):
    """Mirrors matchPoints() in bolao/cdb2026/js/app.js — mutually exclusive:
    exact score beats correct result (by goal-difference sign) beats one
    side's goal count correct, never summed."""
    if not pick or not result or result.get("goalsHome") is None or result.get("goalsAway") is None:
        return None
    if pick["goalsHome"] == result["goalsHome"] and pick["goalsAway"] == result["goalsAway"]:
        return {"pts": MATCH_SCORING["exact"], "type": "exact"}
    pick_sign = _sign(pick["goalsHome"] - pick["goalsAway"])
    real_sign = _sign(result["goalsHome"] - result["goalsAway"])
    if pick_sign == real_sign:
        return {"pts": MATCH_SCORING["result"], "type": "result"}
    pts = 0
    if pick["goalsHome"] == result["goalsHome"]:
        pts += MATCH_SCORING["side"]
    if pick["goalsAway"] == result["goalsAway"]:
        pts += MATCH_SCORING["side"]
    return {"pts": pts, "type": "side" if pts > 0 else "miss"}


def _sign(n):
    return (n > 0) - (n < 0)


def score_entry(entry, ties, podium):
    """Mirrors scoreEntry() — ties: {tieId: {matches: {leg: {goalsHome,goalsAway}}, qualifiedTeamId}}
    podium: {"champion": name|None, "runnerUp": name|None} (official result)."""
    total = 0
    detail = {"matches": {}, "ties": {}, "champion": None, "runnerUp": None}
    picks = entry.get("picks", {})

    for tie_id, tie in ties.items():
        pick_matches = picks.get("matches", {}).get(tie_id, {})
        for leg, result in tie.get("matches", {}).items():
            r = match_points(pick_matches.get(leg), result)
            if r is None:
                continue
            detail["matches"][f"{tie_id}:{leg}"] = r
            total += r["pts"]
        if tie.get("qualifiedTeamId"):
            pick_qual = picks.get("qualified", {}).get(tie_id)
            if pick_qual:
                hit = pick_qual == tie["qualifiedTeamId"]
                detail["ties"][tie_id] = {"pts": TIE_BONUS if hit else 0, "type": "hit" if hit else "miss"}
                total += detail["ties"][tie_id]["pts"]

    predicted_champion = entry.get("predictedChampion")
    predicted_runner_up = entry.get("predictedRunnerUp")
    if podium.get("champion") and predicted_champion:
        hit = predicted_champion == podium["champion"]
        detail["champion"] = {"pts": PODIUM_BONUS["champion"] if hit else 0, "type": "exact" if hit else "miss"}
        total += detail["champion"]["pts"]
    if podium.get("runnerUp") and predicted_runner_up:
        hit = predicted_runner_up == podium["runnerUp"]
        detail["runnerUp"] = {"pts": PODIUM_BONUS["runnerUp"] if hit else 0, "type": "exact" if hit else "miss"}
        total += detail["runnerUp"]["pts"]

    return total, detail


def hit_champion(detail):
    return 1 if detail.get("champion", {}).get("type") == "exact" else 0


def hit_runner_up(detail):
    return 1 if detail.get("runnerUp", {}).get("type") == "exact" else 0


def count_exact_matches(detail):
    return sum(1 for d in detail.get("matches", {}).values() if d["type"] == "exact")


# ─── PARIDADE COM O SITE (2026-11-01) ────────────────────────────────────────────────────────
#
# O DEFEITO QUE ISTO FECHA. `score_entry()` acima recebe os confrontos ACHATADOS por id e procura
# o palpite pelo id REAL do confronto, compara o classificado pela LETRA do lado e le campeao/vice
# de `entry.predictedChampion`, campo que nenhuma entrada tem. O site (scoreEntry() em
# bolao/cdb2026/js/app.js) faz outra coisa nas fases DERIVADAS (semifinal/final):
#   - o palpite foi salvo sob o id de VAGA (sf-1/sf-2/final-1) antes de o confronto real existir;
#     o placar migra por VAGA (legacyDerivedTieIds()/pickByTieId());
#   - o bonus de classificado compara o TIME previsto pela entrada (virtualDerivedTies()), nao a
#     letra A/B -- o lado A real pode ser outro clube;
#   - campeao/vice saem da final PREVISTA da entrada (predictedPodium()).
# Resultado verificado: o e-mail da semifinal dizia "sem palpite" para todo mundo, e o ranking do
# e-mail nunca daria 30/20 nem o rateio da final igual ao do site.
#
# A REGRA: o site e a fonte da verdade da semantica. As funcoes abaixo sao transcricao LINHA A
# LINHA das funcoes de app.js com o mesmo nome em camelCase, incluindo as esquisitices (ver os
# comentarios "JS:"), e test_email_scoring_parity.mjs roda as funcoes REAIS de app.js contra
# estas no mesmo estado, entrada por entrada, perna por perna. Mudou app.js? Esse teste quebra.
#
# Tudo aqui depende so de `phases` (s.phases no site) e da entrada -- nunca de rede.

# Mirrors DATA.phases (bolao/cdb2026/js/data.js) — conferido por check_phases_match_data_js().
SITE_PHASES = [
    ("fase-1", "SINGLE_MATCH"), ("fase-2", "SINGLE_MATCH"), ("fase-3", "SINGLE_MATCH"),
    ("fase-4", "SINGLE_MATCH"), ("fase-5", "TWO_LEG"), ("oitavas", "TWO_LEG"),
    ("quartas", "TWO_LEG"), ("semifinal", "TWO_LEG"), ("final", "SINGLE_MATCH"),
]
DERIVED_PHASES = {"semifinal": "quartas", "final": "semifinal"}
TOPOLOGY_REQUIRED_FIELDS = ["authority", "source", "ingestedAt", "validatedAt"]


def _truthy(v):
    """Truthiness do JavaScript: objeto/array vazio e VERDADEIRO (em Python, {} e falso)."""
    if v is None or v is False:
        return False
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v == v and v != 0  # NaN e 0 sao falsos
    if isinstance(v, str):
        return v != ""
    return True


def _num(v):
    """Coercao numerica do JS para `a - b` (null -> 0, "2" -> 2, lixo -> NaN)."""
    if v is None:
        return 0
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        t = v.strip()
        if t == "":
            return 0
        try:
            return float(t)
        except ValueError:
            return float("nan")
    return float("nan")


def _js_sign(n):
    if n != n:
        return float("nan")
    return (n > 0) - (n < 0)


def _get(obj, key):
    """`obj?.[key]` -- None quando obj nao e objeto."""
    return obj.get(key) if isinstance(obj, dict) else None


def legs_for_format(fmt):
    return ["first", "second"] if fmt == "TWO_LEG" else ["single"]


def match_points_site(pick, result):
    """matchPoints() de app.js, com a coercao do JS (o `match_points()` acima assume inteiros)."""
    if not _truthy(pick) or not _truthy(result) or _get(result, "goalsHome") is None \
            or _get(result, "goalsAway") is None:
        return None
    ph, pa = _get(pick, "goalsHome"), _get(pick, "goalsAway")
    rh, ra = result["goalsHome"], result["goalsAway"]

    def same(a, b):  # `===`: mesmo tipo e mesmo valor (bool nunca e numero)
        if isinstance(a, bool) or isinstance(b, bool):
            return a is b
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            return a == b
        return type(a) is type(b) and a == b

    if same(ph, rh) and same(pa, ra):
        return {"pts": MATCH_SCORING["exact"], "type": "exact"}
    pick_sign = _js_sign(_num(ph) - _num(pa))
    real_sign = _js_sign(_num(rh) - _num(ra))
    if pick_sign == real_sign:
        return {"pts": MATCH_SCORING["result"], "type": "result"}
    pts = 0
    if same(ph, rh):
        pts += MATCH_SCORING["side"]
    if same(pa, ra):
        pts += MATCH_SCORING["side"]
    return {"pts": pts, "type": "side" if pts > 0 else "miss"}


def _parse_js_date_ok(v):
    """`!Number.isNaN(new Date(v).getTime())` para os formatos que de fato aparecem (ISO 8601)."""
    if isinstance(v, bool):
        return True
    if isinstance(v, (int, float)):
        return v == v
    if not isinstance(v, str):
        return False
    t = v.strip()
    try:
        datetime.fromisoformat(t.replace("Z", "+00:00"))
        return True
    except ValueError:
        pass
    for fmt in ("%Y-%m", "%Y"):
        try:
            datetime.strptime(t, fmt)
            return True
        except ValueError:
            pass
    return False


def topology_provenance_is_valid(prov):
    if not isinstance(prov, dict):
        return False
    for f in TOPOLOGY_REQUIRED_FIELDS:
        if not _truthy(prov.get(f)):
            return False
    if prov.get("authority") != "CBF":
        return False
    return all(_parse_js_date_ok(prov.get(f)) for f in ("ingestedAt", "validatedAt"))


def _phase_ties(phases, phase_id):
    t = _get(_get(phases, phase_id), "ties")
    return t if _truthy(t) and isinstance(t, dict) else {}


def tie_qualified_team(phases, tie_id):
    for phase in (phases or {}).values():
        ties = _get(phase, "ties")
        tie = _get(ties, tie_id)
        if not _truthy(tie):
            continue
        if not _truthy(tie.get("qualifiedTeamId")):
            return None
        team = tie.get("teamA") if tie["qualifiedTeamId"] == "A" else tie.get("teamB")
        return team if _truthy(team) else None
    return None


def resolve_participant(phases, ref):
    frm = _get(ref, "winnerOf") if _truthy(ref) else None
    if not _truthy(frm):
        return {"resolved": False, "team": None, "winnerOf": None}
    team = tie_qualified_team(phases, frm)
    if team:
        return {"resolved": True, "team": team, "winnerOf": frm}
    return {"resolved": False, "team": None, "winnerOf": frm}


def _predecessor_phase_of_tie(phases, tie_id):
    for phase_id, phase in (phases or {}).items():
        ties = _get(phase, "ties")
        if _truthy(ties) and isinstance(ties, dict) and tie_id in ties:
            return phase_id
    return None


def resolve_participant_predicted(phases, side, live_picks):
    tie_id = _get(side, "winnerOf") if _truthy(side) else None
    if _truthy(tie_id):
        pred = _predecessor_phase_of_tie(phases, tie_id)
        tie = _get(_get(_get(phases, pred), "ties"), tie_id) if pred else None
        escolhido = _get(_get(live_picks, "qualified"), tie_id)
        if _truthy(tie) and escolhido in ("A", "B"):
            nome = tie.get("teamA") if escolhido == "A" else tie.get("teamB")
            if _truthy(nome):
                return {"resolved": True, "team": nome, "winnerOf": tie_id, "fromPrediction": True}
    return resolve_participant(phases, side)


def derived_phase_view(phases, phase_id):
    phase = _get(phases, phase_id)
    topo = _get(phase, "topology") if _truthy(phase) else None
    valid = _truthy(topo) and topology_provenance_is_valid(_get(topo, "provenance")) \
        and _truthy(_get(topo, "slots"))
    if not valid:
        return {"phaseId": phase_id, "topologyKnown": False, "slots": []}
    slots = []
    for slot_id, slot in topo["slots"].items():
        a = resolve_participant(phases, _get(slot, "sideA"))
        b = resolve_participant(phases, _get(slot, "sideB"))
        slots.append({"slotId": slot_id, "sideA": a, "sideB": b,
                      "_rawA": _get(slot, "sideA"), "_rawB": _get(slot, "sideB"),
                      "bothResolved": a["resolved"] and b["resolved"]})
    return {"phaseId": phase_id, "topologyKnown": True, "slots": slots}


def _pair_key(a, b):
    # JS: [a, b].sort().join("|") -- so chamado com times resolvidos (strings) do lado da vaga;
    # do lado do confronto real, null/undefined viram "" no join (e nunca casam com um par real).
    vals = [x for x in (a, b)]
    def k(x):
        return (1, "") if x is None else (0, str(x))
    vals.sort(key=k)
    return "|".join("" if x is None else str(x) for x in vals)


def legacy_derived_tie_ids(phases, phase_id):
    out = {}
    reais = list(_phase_ties(phases, phase_id).items())
    if not reais:
        return out
    view = derived_phase_view(phases, phase_id)
    if not view["topologyKnown"]:
        return out
    for slot in view["slots"]:
        if not slot["sideA"]["resolved"] or not slot["sideB"]["resolved"]:
            continue
        par = _pair_key(slot["sideA"]["team"], slot["sideB"]["team"])
        real = next((r for r in reais if _pair_key(_get(r[1], "teamA"), _get(r[1], "teamB")) == par), None)
        if real:
            out[real[0]] = slot["slotId"]
    return out


_MISSING = object()


def pick_by_tie_id(picks_obj, tie_id, legacy_map):
    """pickByTieId(): chave PRESENTE (mesmo com valor null) vence; so cai no id de vaga sem ela."""
    if isinstance(picks_obj, dict) and tie_id in picks_obj:
        return picks_obj[tie_id]
    legacy_id = (legacy_map or {}).get(tie_id)
    return _get(picks_obj, legacy_id) if _truthy(legacy_id) else None


def virtual_derived_ties(phases, phase_id, live_picks):
    empty = {"topologyKnown": False, "ties": [], "pendentes": []}
    if phase_id == "semifinal":
        view = derived_phase_view(phases, phase_id)
        if not view["topologyKnown"]:
            return empty
        real_to_slot = legacy_derived_tie_ids(phases, "semifinal")
        slot_to_real = {v: k for k, v in real_to_slot.items()}
        ties, pendentes = [], []
        for slot in view["slots"]:
            a = resolve_participant_predicted(phases, slot["_rawA"], live_picks)
            b = resolve_participant_predicted(phases, slot["_rawB"], live_picks)
            tie_id = slot_to_real.get(slot["slotId"]) or slot["slotId"]
            if a["resolved"] and b["resolved"]:
                ties.append([tie_id, {"teamA": a["team"], "teamB": b["team"], "matches": {},
                                      "__virtual": True, "__slotId": slot["slotId"]}])
            else:
                pendentes.append({"slotId": tie_id, "legacySlotId": slot["slotId"], "a": a, "b": b,
                                  "sideA": slot["_rawA"], "sideB": slot["_rawB"]})
        return {"topologyKnown": True, "ties": ties, "pendentes": pendentes}

    if phase_id == "final":
        semi = virtual_derived_ties(phases, "semifinal", live_picks)
        if not semi["topologyKnown"]:
            return empty
        top_final = _get(_get(_get(_get(phases, "final"), "topology"), "slots"), "final-1")
        ids = [t[0] for t in semi["ties"]] + [p["slotId"] for p in semi["pendentes"]]
        if _truthy(_get(_get(top_final, "sideA"), "winnerOf")) and _truthy(_get(_get(top_final, "sideB"), "winnerOf")):
            legacy_semi = legacy_derived_tie_ids(phases, "semifinal")

            def real_for(wanted):
                if wanted in ids:
                    return wanted
                found = next((k for k, v in legacy_semi.items() if v == wanted), None)
                return found or wanted
            slots = [real_for(top_final["sideA"]["winnerOf"]), real_for(top_final["sideB"]["winnerOf"])]
        else:
            slots = sorted(ids)
        if len(slots) != 2:
            return {"topologyKnown": True, "ties": [], "pendentes": []}
        legado_semi = legacy_derived_tie_ids(phases, "semifinal")
        lados = []
        for tid in slots:
            escolhido = pick_by_tie_id(_get(live_picks, "qualified"), tid, legado_semi)
            tie = next((t[1] for t in semi["ties"] if t[0] == tid), None)
            if tie and escolhido in ("A", "B"):
                lados.append({"resolved": True, "team": tie["teamA"] if escolhido == "A" else tie["teamB"], "winnerOf": tid})
            else:
                lados.append({"resolved": False, "team": None, "winnerOf": tid})
        legado_final = legacy_derived_tie_ids(phases, "final")
        real_final_id = next((k for k, v in legado_final.items() if v == "final-1"), None)
        final_id = real_final_id or "final-1"
        if lados[0]["resolved"] and lados[1]["resolved"]:
            return {"topologyKnown": True,
                    "ties": [[final_id, {"teamA": lados[0]["team"], "teamB": lados[1]["team"],
                                         "matches": {}, "__virtual": True, "__slotId": "final-1"}]],
                    "pendentes": []}
        return {"topologyKnown": True, "ties": [],
                "pendentes": [{"slotId": final_id, "legacySlotId": "final-1", "a": lados[0], "b": lados[1],
                               "sideA": {"winnerOf": slots[0]}, "sideB": {"winnerOf": slots[1]}}]}
    return empty


def official_podium_site(phases):
    """officialPodium(): o primeiro confronto de phases.final.ties (nao de phases.final!)."""
    final_ties = _phase_ties(phases, "final")
    if not final_ties:
        return {"champion": None, "runnerUp": None}
    tie = next(iter(final_ties.values()))
    if not _truthy(_get(tie, "qualifiedTeamId")):
        return {"champion": None, "runnerUp": None}
    a = tie["qualifiedTeamId"] == "A"
    return {"champion": tie.get("teamA") if a else tie.get("teamB"),
            "runnerUp": tie.get("teamB") if a else tie.get("teamA")}


def predicted_podium_site(entry, phases):
    picks = _get(entry, "picks") or {}
    virt = virtual_derived_ties(phases, "final", picks)
    entrada = virt["ties"][0] if virt["ties"] else None
    if not entrada and not virt["topologyKnown"]:
        final_ties = _phase_ties(phases, "final")
        if final_ties:
            tid = next(iter(final_ties))
            entrada = [tid, final_ties[tid]]
    if not entrada:
        return {"champion": None, "runnerUp": None}
    tie_id, tie = entrada
    pick = pick_by_tie_id(_get(picks, "qualified"), tie_id, legacy_derived_tie_ids(phases, "final"))
    if pick not in ("A", "B"):
        return {"champion": None, "runnerUp": None}
    return {"champion": tie.get("teamA") if pick == "A" else tie.get("teamB"),
            "runnerUp": tie.get("teamB") if pick == "A" else tie.get("teamA")}


def score_entry_site(entry, phases):
    """scoreEntry(entry, s) de app.js. Devolve (total, detail) com detail no MESMO formato do site:
    {"matches": {"tieId:leg": {pts,type}}, "ties": {tieId: {pts,type}}, ["champion"], ["runnerUp"]}
    (champion/runnerUp so existem quando se aplicam, como no site)."""
    total = 0
    detail = {"matches": {}, "ties": {}}
    picks = _get(entry, "picks") or {}
    for phase_id, fmt in SITE_PHASES:
        ties = _phase_ties(phases, phase_id)
        legado = legacy_derived_tie_ids(phases, phase_id) if phase_id in DERIVED_PHASES else {}
        for tie_id, tie in ties.items():
            pick_matches = pick_by_tie_id(_get(picks, "matches"), tie_id, legado)
            if not _truthy(pick_matches):
                pick_matches = {}
            for leg in legs_for_format(fmt):
                r = match_points_site(_get(pick_matches, leg), _get(_get(tie, "matches"), leg))
                if not r:
                    continue
                detail["matches"][f"{tie_id}:{leg}"] = r
                total += r["pts"]
            if _truthy(_get(tie, "qualifiedTeamId")):
                pick_qual = pick_by_tie_id(_get(picks, "qualified"), tie_id, legado)
                if _truthy(pick_qual):
                    if phase_id in DERIVED_PHASES:
                        pv = virtual_derived_ties(phases, phase_id, picks)
                        found = next((t[1] for t in pv["ties"] if t[0] == tie_id), None)
                        predicted_tie = found or (tie if not pv["topologyKnown"] else None)
                    else:
                        predicted_tie = tie
                    # JS: `pickQual === "A" ? teamA : teamB` -- qualquer outro valor verdadeiro e B.
                    predicted_q = (predicted_tie.get("teamA") if pick_qual == "A" else predicted_tie.get("teamB")) \
                        if predicted_tie else None
                    real_q = tie.get("teamA") if tie["qualifiedTeamId"] == "A" else tie.get("teamB")
                    hit = _truthy(predicted_q) and predicted_q == real_q
                    detail["ties"][tie_id] = {"pts": TIE_BONUS if hit else 0, "type": "hit" if hit else "miss"}
                    total += detail["ties"][tie_id]["pts"]
    official = official_podium_site(phases)
    predicted = predicted_podium_site(entry, phases)
    if _truthy(official["champion"]) and _truthy(predicted["champion"]):
        hit = predicted["champion"] == official["champion"]
        detail["champion"] = {"pts": PODIUM_BONUS["champion"] if hit else 0, "type": "exact" if hit else "miss"}
        total += detail["champion"]["pts"]
    if _truthy(official["runnerUp"]) and _truthy(predicted["runnerUp"]):
        hit = predicted["runnerUp"] == official["runnerUp"]
        detail["runnerUp"] = {"pts": PODIUM_BONUS["runnerUp"] if hit else 0, "type": "exact" if hit else "miss"}
        total += detail["runnerUp"]["pts"]
    return total, detail


def leg_teams(tie, leg, match):
    return {
        "home": _get(match, "homeTeam") or (tie.get("teamB") if leg == "second" else tie.get("teamA")),
        "away": _get(match, "awayTeam") or (tie.get("teamA") if leg == "second" else tie.get("teamB")),
    }


def _fmt_score(m):
    return f"{m['goalsHome']}–{m['goalsAway']}" if _truthy(m) and m.get("goalsHome") is not None else None


_EXPLAIN = {
    "exact": f"Placar exato — {MATCH_SCORING['exact']} pts",
    "result": f"Resultado certo (vitória/empate/derrota), placar não exato — {MATCH_SCORING['result']} pts",
    "side": f"Gols de um dos times certos — {MATCH_SCORING['side']} pt por time acertado",
    "miss": "Nenhum critério atingido — 0 pt",
}


def explain_score_site(entry, phases):
    """explainScore(entry, s) de app.js: a decomposicao item a item que o site mostra."""
    total, detail = score_entry_site(entry, phases)
    picks = _get(entry, "picks") or {}
    breakdown = []
    for phase_id, fmt in SITE_PHASES:
        legado = legacy_derived_tie_ids(phases, phase_id) if phase_id in DERIVED_PHASES else {}
        for tie_id, tie in _phase_ties(phases, phase_id).items():
            for leg in legs_for_format(fmt):
                d = detail["matches"].get(f"{tie_id}:{leg}")
                if not d:
                    continue
                m = _get(_get(tie, "matches"), leg)
                lt = leg_teams(tie, leg, m)
                leg_name = "" if leg == "single" else " (ida)" if leg == "first" else " (volta)"
                breakdown.append({
                    "ruleId": f"match.{d['type']}", "entityType": "match", "entityId": f"{tie_id}:{leg}",
                    "label": f"{lt['home']} × {lt['away']}{leg_name}",
                    "expected": _fmt_score(_get(pick_by_tie_id(_get(picks, "matches"), tie_id, legado), leg)),
                    "actual": _fmt_score(m), "points": d["pts"],
                    "explanation": _EXPLAIN.get(d["type"], d["type"]),
                })
            dt = detail["ties"].get(tie_id)
            if dt:
                pick = pick_by_tie_id(_get(picks, "qualified"), tie_id, legado)
                name_of = lambda side: tie.get("teamA") if side == "A" else tie.get("teamB")  # noqa: E731
                breakdown.append({
                    "ruleId": f"tie.qualified.{dt['type']}", "entityType": "tie", "entityId": tie_id,
                    "label": f"Classificado — {tie.get('teamA')} × {tie.get('teamB')}",
                    "expected": name_of(pick) if _truthy(pick) else None,
                    "actual": name_of(tie.get("qualifiedTeamId")), "points": dt["pts"],
                    "explanation": f"Acertou quem se classificou — {TIE_BONUS} pts" if dt["type"] == "hit"
                    else "Errou quem se classificou — 0 pt",
                })
    official = official_podium_site(phases)
    predicted = predicted_podium_site(entry, phases)
    for k, label, pts in (("champion", "Campeão", PODIUM_BONUS["champion"]),
                          ("runnerUp", "Vice-campeão", PODIUM_BONUS["runnerUp"])):
        d = detail.get(k)
        if not d:
            continue
        breakdown.append({
            "ruleId": f"podium.{k}.{d['type']}", "entityType": "podium", "entityId": k, "label": label,
            "expected": predicted[k], "actual": official[k], "points": d["pts"],
            "explanation": f"Acertou o {label.lower()} — {pts} pts" if d["type"] == "exact"
            else f"Errou o {label.lower()} — 0 pt",
        })
    s = sum(b["points"] for b in breakdown)
    return {"total": total, "reconciles": s == total, "breakdown": breakdown}


def derived_tie_display_labels(phases, phase_id, tie_id, tie, picks):
    """derivedTieDisplayLabels(): "Real (Previsto)" quando o time previsto pela entrada para o
    mesmo lado estrutural difere do real -- o rotulo de "Ver palpites"."""
    base = {"teamA": _get(tie, "teamA") or "", "teamB": _get(tie, "teamB") or ""}
    if phase_id not in DERIVED_PHASES:
        return base
    pv = virtual_derived_ties(phases, phase_id, picks or {})
    pt = next((t[1] for t in pv["ties"] if t[0] == tie_id), None)
    if not pt:
        return base

    def label(real, pred):
        if real and pred and real != pred:
            return f"{real} ({pred})"
        return real or pred or ""
    return {"teamA": label(_get(tie, "teamA"), pt.get("teamA")),
            "teamB": label(_get(tie, "teamB"), pt.get("teamB"))}


def leg_pick_view(entry, phases, phase_id, tie_id, leg):
    """A linha de UMA perna para UMA entrada, como "Ver palpites" (renderPickDisplay) mostra:
    o palpite que o site usou (inclusive o salvo sob id de vaga), na orientacao nominal da perna,
    com os nomes "Real (Previsto)" e os pontos do scoreEntry(). None quando nao ha palpite."""
    tie = _phase_ties(phases, phase_id).get(tie_id)
    # flatLegsChronological() pula confronto sem os dois times.
    if not tie or not _truthy(tie.get("teamA")) or not _truthy(tie.get("teamB")):
        return None
    picks = _get(entry, "picks") or {}
    legado = legacy_derived_tie_ids(phases, phase_id) if phase_id in DERIVED_PHASES else {}
    pick_matches = pick_by_tie_id(_get(picks, "matches"), tie_id, legado)
    if not _truthy(pick_matches):
        return None
    pick = _get(pick_matches, leg)
    if not _truthy(pick):
        return None
    lt = leg_teams(tie, leg, _get(_get(tie, "matches"), leg))
    disp = derived_tie_display_labels(phases, phase_id, tie_id, tie, picks)

    def show(team):
        if team == tie.get("teamA"):
            return disp["teamA"]
        if team == tie.get("teamB"):
            return disp["teamB"]
        return team
    return {"home": show(lt["home"]), "away": show(lt["away"]),
            "goalsHome": pick.get("goalsHome"), "goalsAway": pick.get("goalsAway")}


def _hit_champion_site(detail):
    return 1 if (detail.get("champion") or {}).get("type") == "exact" else 0


def _hit_runner_up_site(detail):
    return 1 if (detail.get("runnerUp") or {}).get("type") == "exact" else 0


def rank_entries_site(entries, phases):
    """rankEntriesBy(entries, scoreEntry): ordenacao ESTAVEL (sem desempate por nome) e rank
    compartilhado por chave total:campeao:vice:exatos -- exatamente o do site."""
    scored = []
    for e in entries:
        total, detail = score_entry_site(e, phases)
        scored.append({"e": e, "total": total, "detail": detail})
    key = lambda x: (x["total"], _hit_champion_site(x["detail"]), _hit_runner_up_site(x["detail"]),  # noqa: E731
                     count_exact_matches(x["detail"]))
    scored.sort(key=lambda x: tuple(-v for v in key(x)))
    rank, prev = 0, None
    for i, item in enumerate(scored):
        k = key(item)
        if k != prev:
            rank, prev = i + 1, k
        item["rank"] = rank
    return scored


def check_phases_match_data_js():
    """SITE_PHASES acima == DATA.phases de data.js (id e formato, na mesma ordem)."""
    src = (pathlib.Path(__file__).resolve().parents[1] / "js" / "data.js").read_text()
    achados = re.findall(r'\{\s*id:\s*"([^"]+)",\s*name:\s*"[^"]*",\s*format:\s*"([A-Z_]+)"', src)
    if achados != [list(x) for x in SITE_PHASES] and achados != [tuple(x) for x in SITE_PHASES]:
        return False, f"data.js tem {achados}, audit_scoring.SITE_PHASES tem {SITE_PHASES}"
    return True, ""


def check_site_scorer_slot_pick_and_team_qualifier():
    """Palpite salvo sob id de VAGA pontua no confronto real; classificado e por TIME; campeao e
    vice saem da final PREVISTA (as tres coisas que o `score_entry()` legado nao faz)."""
    prov = {"authority": "CBF", "source": "fixture", "ingestedAt": "2020-01-01T00:00:00Z",
            "validatedAt": "2020-01-01T00:00:00Z"}
    q = lambda a, b, w: {"teamA": a, "teamB": b, "matches": {}, "qualifiedTeamId": w}  # noqa: E731
    phases = {
        "quartas": {"ties": {"q1": q("Alfa", "Beta", "A"), "q2": q("Gama", "Delta", "B"),
                             "q3": q("Eps", "Zeta", "A"), "q4": q("Eta", "Teta", "B")}},
        "semifinal": {"topology": {"provenance": prov, "slots": {
            "sf-1": {"sideA": {"winnerOf": "q1"}, "sideB": {"winnerOf": "q2"}},
            "sf-2": {"sideA": {"winnerOf": "q3"}, "sideB": {"winnerOf": "q4"}}}},
            "ties": {
                "r-alfa_delta": {"teamA": "Alfa", "teamB": "Delta", "qualifiedTeamId": "A",
                                 "matches": {"first": {"goalsHome": 1, "goalsAway": 0},
                                             "second": {"goalsHome": 0, "goalsAway": 0}}},
                "r-eps_teta": {"teamA": "Eps", "teamB": "Teta", "qualifiedTeamId": "A",
                               "matches": {"first": {"goalsHome": 2, "goalsAway": 2},
                                           "second": {"goalsHome": 1, "goalsAway": 0}}}}},
        "final": {"topology": {"provenance": prov, "slots": {
            "final-1": {"sideA": {"winnerOf": "r-alfa_delta"}, "sideB": {"winnerOf": "r-eps_teta"}}}},
            # Decidida nos penaltis: 1-1 no tempo normal, Alfa campeao.
            "ties": {"r-alfa_eps": {"teamA": "Alfa", "teamB": "Eps", "qualifiedTeamId": "A",
                                    "penaltiesHome": 4, "penaltiesAway": 3, "penaltiesWinnerTeamId": "A",
                                    "matches": {"single": {"goalsHome": 1, "goalsAway": 1}}}}},
    }
    entry = {"picks": {
        # Previu Zeta (e nao Eps) na sf-2: semifinal prevista Zeta x Teta.
        "qualified": {"q1": "A", "q2": "B", "q3": "B", "q4": "B", "sf-1": "A", "sf-2": "A", "final-1": "A"},
        "matches": {"sf-1": {"first": {"goalsHome": 1, "goalsAway": 0}},
                    "sf-2": {"first": {"goalsHome": 2, "goalsAway": 2}},
                    "final-1": {"single": {"goalsHome": 1, "goalsAway": 1}}},
    }}
    total, detail = score_entry_site(entry, phases)
    # quartas 5+5+0+5; sf-1 ida exata (palpite da VAGA) 10 + Alfa 5; sf-2 ida exata 10, mas
    # classificado "A" = Zeta previsto, nao Eps real -> 0 (letra igual, TIME diferente); final
    # exata 10 + Alfa 5 + campeao Alfa 30; vice previsto Zeta, real Eps -> 0.
    esperado = 15 + 15 + 10 + 10 + 5 + 30
    if total != esperado:
        return False, f"total={total}, esperado {esperado}; detail={detail}"
    if detail["ties"].get("r-eps_teta", {}).get("type") != "miss":
        return False, f"classificado por LETRA em vez de TIME: {detail['ties'].get('r-eps_teta')}"
    if detail.get("runnerUp", {}).get("pts") != 0 or detail.get("champion", {}).get("pts") != PODIUM_BONUS["champion"]:
        return False, f"podio previsto errado: {detail.get('champion')} / {detail.get('runnerUp')}"
    return True, ""


# ─── Checks ──────────────────────────────────────────────────────────────────

def check_match_points_mutually_exclusive():
    """Exact, result, and side points must never sum on the same match."""
    cases = [
        ({"goalsHome": 2, "goalsAway": 1}, {"goalsHome": 2, "goalsAway": 1}, "exact", 10),
        ({"goalsHome": 2, "goalsAway": 3}, {"goalsHome": 2, "goalsAway": 1}, "side", 1),   # opposite winner, home goals match only
        ({"goalsHome": 2, "goalsAway": 0}, {"goalsHome": 1, "goalsAway": 0}, "result", 5),  # same winner sign, wrong score
        ({"goalsHome": 1, "goalsAway": 1}, {"goalsHome": 2, "goalsAway": 0}, "miss", 0),    # predicted draw, real win
        ({"goalsHome": 2, "goalsAway": 2}, {"goalsHome": 2, "goalsAway": 2}, "exact", 10),  # draw predicted exactly
    ]
    for pick, result, expected_type, expected_pts in cases:
        r = match_points(pick, result)
        if r is None or r["type"] != expected_type or r["pts"] != expected_pts:
            return False, f"match_points({pick}, {result}) = {r}, expected type={expected_type} pts={expected_pts}"
    return True, ""


def check_tie_bonus_and_podium_applied():
    """A fully-correct entry (every match exact, every tie/podium pick right)
    must add up to match points + tie bonus + podium bonus — the exact class
    of bug the Copa's July 2026 audit found (bonus silently not summed)."""
    ties = {
        "t1": {"matches": {"first": {"goalsHome": 2, "goalsAway": 0}, "second": {"goalsHome": 0, "goalsAway": 1}},
               "qualifiedTeamId": "A", "teamA": "Vasco", "teamB": "Fluminense"},
    }
    entry = {
        "picks": {
            "matches": {"t1": {"first": {"goalsHome": 2, "goalsAway": 0}, "second": {"goalsHome": 0, "goalsAway": 1}}},
            "qualified": {"t1": "A"},
        },
        "predictedChampion": "Vasco",
        "predictedRunnerUp": "Palmeiras",
    }
    podium = {"champion": "Vasco", "runnerUp": "Palmeiras"}
    total, detail = score_entry(entry, ties, podium)
    expected = 10 + 10 + TIE_BONUS + PODIUM_BONUS["champion"] + PODIUM_BONUS["runnerUp"]
    if total != expected:
        return False, f"total={total}, expected {expected} (2x exact + tie bonus + champion + runnerUp)"
    if detail["ties"]["t1"]["pts"] != TIE_BONUS:
        return False, f"tie bonus not applied: {detail['ties']['t1']}"
    if detail["champion"]["pts"] != PODIUM_BONUS["champion"] or detail["runnerUp"]["pts"] != PODIUM_BONUS["runnerUp"]:
        return False, f"podium bonus not applied correctly: champion={detail['champion']} runnerUp={detail['runnerUp']}"
    return True, ""


def check_wrong_tie_pick_no_bonus():
    """Picking the wrong side to advance must score 0 tie bonus even with
    both legs' scores exactly right — bonus is strictly about the
    qualification pick, not inferred from the score picks."""
    ties = {
        "t1": {"matches": {"first": {"goalsHome": 2, "goalsAway": 0}, "second": {"goalsHome": 0, "goalsAway": 1}},
               "qualifiedTeamId": "A"},
    }
    entry = {"picks": {
        "matches": {"t1": {"first": {"goalsHome": 2, "goalsAway": 0}, "second": {"goalsHome": 0, "goalsAway": 1}}},
        "qualified": {"t1": "B"},  # wrong side
    }}
    total, detail = score_entry(entry, ties, {})
    if detail["ties"]["t1"]["pts"] != 0 or detail["ties"]["t1"]["type"] != "miss":
        return False, f"wrong qualifier pick should score 0 bonus, got {detail['ties']['t1']}"
    if total != 20:  # just the two exact-score match points, no bonus
        return False, f"total={total}, expected 20 (match points only, no tie bonus)"
    return True, ""


def check_no_result_yet_scores_nothing():
    """A match/tie with no result recorded yet must contribute 0, not throw
    and not silently score against a None/undefined result."""
    ties = {"t1": {"matches": {"first": {"goalsHome": None, "goalsAway": None}}, "qualifiedTeamId": None}}
    entry = {"picks": {"matches": {"t1": {"first": {"goalsHome": 2, "goalsAway": 0}}}, "qualified": {}}}
    total, detail = score_entry(entry, ties, {})
    if total != 0 or detail["matches"]:
        return False, f"expected 0 points / no match detail for unresolved match, got total={total} detail={detail['matches']}"
    return True, ""


def check_tiebreak_order():
    """Sort must be total DESC, then champion-hit DESC, then runnerUp-hit
    DESC, then exact-match-count DESC — same cascade as renderRanking() in
    bolao/cdb2026/js/app.js."""
    entries = [
        {"name": "A", "total": 50, "detail": {"champion": {"type": "exact"}, "matches": {}}},
        {"name": "B", "total": 50, "detail": {"champion": {"type": "miss"}, "matches": {"m1": {"type": "exact"}}}},
        {"name": "C", "total": 60, "detail": {"matches": {}}},
    ]
    scored = sorted(
        entries,
        key=lambda x: (-x["total"], -hit_champion(x["detail"]), -hit_runner_up(x["detail"]), -count_exact_matches(x["detail"])),
    )
    order = [e["name"] for e in scored]
    if order != ["C", "A", "B"]:
        return False, f"expected order [C, A, B] (highest total first, then champion hit breaks the 50-50 tie), got {order}"
    return True, ""


def check_match_is_real(event_date_str, team_a, team_b):
    """
    Runtime, per-leg check right before a result is trusted enough to save + email. Catches the
    historical failure mode (Copa's audit_scoring.py docstring): a result appearing for a match
    that hasn't actually been played (stale cache, test data, an ESPN glitch, a timezone bug).
    No W/L slot check needed here (unlike Copa's bracket) -- CDB2026 ties always carry real team
    names from the moment they're drawn/created, never a placeholder.
    """
    problems = []
    ev_date = None
    try:
        ev_date = datetime.strptime((event_date_str or "")[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        problems.append(f"unparseable event date {event_date_str!r}")
    if ev_date and ev_date.date() > datetime.now(timezone.utc).date():
        problems.append(f"event date {event_date_str} is in the future — match can't have finished yet")
    if not team_a or not team_b or team_a == team_b:
        problems.append(f"invalid team pairing: {team_a!r} vs {team_b!r}")
    return (not problems), "; ".join(problems)


def check_result_shape(result):
    """The result dict itself must be well-formed before it's trusted."""
    problems = []
    for k in ("goalsHome", "goalsAway"):
        v = result.get(k)
        if not isinstance(v, int) or isinstance(v, bool) or v < 0 or v > 20:
            problems.append(f"{k}={v!r} out of range/invalid")
    return (not problems), "; ".join(problems)


def run_static_audit(verbose=True):
    checks = [
        ("config.js vale o que as regras dizem", check_config_matches_rules),
        ("Match points mutually exclusive (exact/result/side/miss)", check_match_points_mutually_exclusive),
        ("Tie bonus + podium bonus applied and summed", check_tie_bonus_and_podium_applied),
        ("Wrong qualifier pick scores no tie bonus", check_wrong_tie_pick_no_bonus),
        ("Unresolved match/tie scores nothing (no crash)", check_no_result_yet_scores_nothing),
        ("Tiebreak sort order (total, champion, runnerUp, exact)", check_tiebreak_order),
        ("Fases de data.js == SITE_PHASES", check_phases_match_data_js),
        ("Pontuacao do site: vaga, classificado por time, podio previsto", check_site_scorer_slot_pick_and_team_qualifier),
    ]
    all_ok = True
    results = []
    for name, fn in checks:
        try:
            ok, detail = fn()
        except Exception as ex:
            ok, detail = False, f"raised {type(ex).__name__}: {ex}"
        results.append((name, ok, detail))
        if not ok:
            all_ok = False
        if verbose:
            mark = "✓" if ok else "✗ FAIL"
            print(f"  {mark} {name}" + (f" — {detail}" if detail and not ok else ""))
    return all_ok, results


if __name__ == "__main__":
    print("Running CDB2026 scoring/ranking static self-audit...\n")
    ok, _ = run_static_audit(verbose=True)
    print("\n" + ("✓ ALL CHECKS PASSED" if ok else "✗ AUDIT FAILED — see above"))
    sys.exit(0 if ok else 1)
