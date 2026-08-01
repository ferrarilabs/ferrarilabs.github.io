"""
audit_integrity.py — CDB2026 read-only state-integrity reconciliation tool.

Run against a LOCAL file only (never touches Supabase or any network):

  python3 audit_integrity.py                                  # uses fixtures/golden_state.json
  python3 audit_integrity.py --file /path/to/state_backup.json
  python3 audit_integrity.py --file backup.json --json         # machine-readable output

Why this exists (Fase 2 §14 of the 2026-08 modernization pass): audit_scoring.py protects the
SCORING FORMULA. audit_state_merge.mjs / audit_golden_master.mjs protect the merge and rendering
functions. None of the three protects the DATA ITSELF — a state snapshot (from a manual export,
a support ticket, or a local backup made before/after an admin operation) can be structurally
broken in ways those suites never see, because they only ever run their own fixtures through the
real functions. This tool inspects a snapshot from the outside: duplicate/orphaned records,
broken references between entries/paid/auditLog/ties, and result data that looks internally
inconsistent (e.g. a "FINAL" match with no score, a qualifiedTeamId that contradicts its own
aggregate).

Design constraints (explicit, from the modernization spec):
  - READ-ONLY. This script never writes anywhere, and has no network code at all — it cannot
    reach Supabase even by mistake, on purpose, there is no URL or key anywhere in this file.
  - Defaults to the anonymized fixture (fixtures/golden_state.json), never production data.
  - Any real snapshot passed via --file is the CALLER's responsibility to have obtained safely
    (e.g. a local backup already on disk) — this script does not fetch one itself.
  - The report anonymizes PII: entryName/payerName/participantEmail are never printed verbatim;
    only the entry's `id` and a truncated, non-reversible label are shown.

Severity levels (worst-case exit code is non-zero only for CRITICAL):
  INFO      informational, no action implied
  WARNING   worth a human look, not necessarily wrong (e.g. an unrecognized team name — could be
            a future round not yet added to data.js)
  ERROR     a real structural inconsistency (a broken reference, a malformed record)
  CRITICAL  a finding that could directly cause a wrong prize payout or a wrong publicly-shown
            result (duplicate entry id, champion contradicting the recorded score, etc.)

Two checks required by the spec ("pontuação oficial divergente do recálculo" / "ranking
divergente") do not apply to this app's data model as literal divergence checks: CDB2026 never
persists a computed score or rank in the state snapshot — scoreEntry()/rankEntriesBy() always
compute it live from picks + results in the browser, so there is no stored value to diverge FROM.
What this script does instead, honestly, is what a static snapshot CAN support: recompute each
entry's total with the same hand-transcribed formula audit_scoring.py already validates against
app.js's real functions, and flag internally-impossible results (e.g. a negative or non-integer
total, which the formula cannot legitimately produce, and would only occur if the recomputation
itself has a code defect or the input data is corrupt). This is reported at INFO level as a
transparency artifact (the recomputed leaderboard), with ERROR only on outright impossibility —
never presented as "the app got the score wrong," since there is nothing stored to compare it to.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_FIXTURE = os.path.join(SCRIPT_DIR, "fixtures", "golden_state.json")

# Transcribed from bolao/cdb2026/js/config.js `scoring` block — same constants audit_scoring.py
# uses, kept in sync by hand for the same reason documented there.
MATCH_SCORING = {"exact": 10, "result": 5, "side": 1}
TIE_BONUS = 5
PODIUM_BONUS = {"champion": 30, "runnerUp": 20}

# Known ESPN-sync one-shot migration flags, transcribed from ESPN_SYNC_ONCE_FLAGS in app.js.
KNOWN_ESPN_SYNC_FLAGS = {
    "activePhaseId",
    "seededKnownConfrontos",
    "backfilledOitavasKickoffs",
    "healedFalseAutoResults",
    "healedPhantomTies",
}

LEVELS = ("INFO", "WARNING", "ERROR", "CRITICAL")


class Finding:
    __slots__ = ("level", "code", "message", "ref")

    def __init__(self, level, code, message, ref=None):
        assert level in LEVELS, f"unknown level {level}"
        self.level = level
        self.code = code
        self.message = message
        self.ref = ref

    def to_dict(self):
        d = {"level": self.level, "code": self.code, "message": self.message}
        if self.ref:
            d["ref"] = self.ref
        return d


def mask_entry_label(entry):
    """Never print raw PII. Returns something like 'entry e-alpha (P***)' — enough to locate the
    record by id in the source file without exposing the participant's real name in a report
    that might be pasted into a chat, a doc, or a ticket."""
    eid = entry.get("id", "?")
    name = (entry.get("entryName") or "").strip()
    initial = f"{name[0]}***" if name else "?"
    return f"entry {eid} ({initial})"


def parse_iso(s):
    if not isinstance(s, str) or not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def sign(n):
    return (n > 0) - (n < 0)


def match_points(pick, result):
    """Transcribed from matchPoints() in app.js:812-825 — mutually exclusive exact/result/side,
    never summed across types. Kept in sync by hand with the same discipline audit_scoring.py's
    own copy of this function documents; verified against the golden master below at import time
    (see check_recompute_matches_golden_master), not just asserted correct."""
    if not pick or not result or result.get("goalsHome") is None or result.get("goalsAway") is None:
        return None
    if pick.get("goalsHome") == result["goalsHome"] and pick.get("goalsAway") == result["goalsAway"]:
        return MATCH_SCORING["exact"]
    if sign(pick.get("goalsHome", 0) - pick.get("goalsAway", 0)) == sign(result["goalsHome"] - result["goalsAway"]):
        return MATCH_SCORING["result"]
    pts = 0
    if pick.get("goalsHome") == result["goalsHome"]:
        pts += MATCH_SCORING["side"]
    if pick.get("goalsAway") == result["goalsAway"]:
        pts += MATCH_SCORING["side"]
    return pts


def recompute_entry_total(entry, phases):
    """Transcribed from scoreEntry()/officialPodium()/predictedPodium() in app.js:519-868 — see
    module docstring for why this is a transparency artifact, not a 'divergence' check against a
    stored value (none exists in this data model). IMPORTANT (found while writing this function,
    2026-08): champion AND runner-up bonuses both derive from the SAME final-tie qualified pick
    (there are only two teams, so a correct champion pick necessarily is also a correct
    runner-up pick) — awarding only the champion bonus undercounts by PODIUM_BONUS['runnerUp']
    whenever the final pick is correct. Caught by check_recompute_matches_golden_master() below,
    not shipped un-verified."""
    total = 0
    picks = (entry.get("picks") or {})
    pick_matches = picks.get("matches") or {}
    pick_qual = picks.get("qualified") or {}
    for phase_id, phase in phases.items():
        for tie_id, tie in (phase.get("ties") or {}).items():
            tie_pick = pick_matches.get(tie_id) or {}
            for leg, match in (tie.get("matches") or {}).items():
                pts = match_points(tie_pick.get(leg), match)
                if pts is not None:
                    total += pts
            if tie.get("qualifiedTeamId"):
                pq = pick_qual.get(tie_id)
                if pq:
                    total += TIE_BONUS if pq == tie["qualifiedTeamId"] else 0
    final_phase = phases.get("final") or {}
    final_ties = final_phase.get("ties") or {}
    if final_ties:
        tie_id, tie = next(iter(final_ties.items()))
        qid = tie.get("qualifiedTeamId")
        pq = pick_qual.get(tie_id)
        if qid and pq:
            champion_hit = pq == qid
            total += PODIUM_BONUS["champion"] if champion_hit else 0
            total += PODIUM_BONUS["runnerUp"] if champion_hit else 0
    return total


def check_recompute_matches_golden_master():
    """Self-test, run automatically before any real check (same discipline
    send_result_email.py --auto applies to audit_scoring.py): recompute_entry_total() must
    reproduce the totals bolao/cdb2026/scripts/audit_golden_master.mjs already verified against
    the REAL scoreEntry() extracted live from app.js. If this fails, the Python transcription in
    this file has drifted from app.js and score-recompute findings below must not be trusted."""
    fixture_path = os.path.join(SCRIPT_DIR, "fixtures", "golden_state.json")
    with open(fixture_path, encoding="utf-8") as f:
        fixture = json.load(f)
    expected = {"e-alpha": 105, "e-bravo": 15, "e-charlie": 0, "e-delta": 105}
    by_id = {e["id"]: e for e in fixture["entries"]}
    for eid, want in expected.items():
        got = recompute_entry_total(by_id[eid], fixture["phases"])
        if got != want:
            return False, f"{eid}: expected {want}, got {got}"
    return True, ""


def check_golden_fixture_is_clean():
    """Fase 2.1 §10: golden_state.json must represent a VALID state — no WARNING/ERROR/CRITICAL.
    The one case that used to violate this (a FINAL 0x0 leg with a future kickoff) was moved to
    its own negative fixture (invalid_future_final_0x0.json) specifically so this holds."""
    fixture_path = os.path.join(SCRIPT_DIR, "fixtures", "golden_state.json")
    with open(fixture_path, encoding="utf-8") as f:
        state = json.load(f)
    findings = run_checks(state)
    bad = [f for f in findings if f.level != "INFO"]
    if bad:
        return False, f"golden_state.json has {len(bad)} non-INFO finding(s): {[f.code for f in bad]}"
    return True, ""


# Fase 2.1 §10: each negative fixture must trip the SPECIFIC finding it exists to demonstrate —
# proves the auditor actually detects these problems, not just that it runs without crashing.
NEGATIVE_FIXTURES = [
    ("invalid_future_final_0x0.json", "suspicious-0x0-future-kickoff", "WARNING"),
    ("invalid_duplicate_entry.json", "duplicate-entry-id", "CRITICAL"),
    ("invalid_orphan_pick.json", "pick-references-unknown-tie", "ERROR"),
]


def check_negative_fixtures_are_caught():
    for filename, expected_code, expected_level in NEGATIVE_FIXTURES:
        path = os.path.join(SCRIPT_DIR, "fixtures", filename)
        with open(path, encoding="utf-8") as f:
            state = json.load(f)
        findings = run_checks(state)
        hit = [f for f in findings if f.code == expected_code and f.level == expected_level]
        if not hit:
            got = [(f.code, f.level) for f in findings]
            return False, f"{filename}: expected {expected_level} '{expected_code}' not found — got {got}"
    return True, ""


def run_self_tests():
    """--self-test: runs all built-in self-tests (recompute transcription, golden fixture
    cleanliness, negative fixtures caught) and reports pass/fail for each — same spirit as
    audit_scoring.py's run_static_audit(), for a script that otherwise has no test runner."""
    checks = [
        ("recompute matches golden master", check_recompute_matches_golden_master),
        ("golden_state.json has no WARNING/ERROR/CRITICAL", check_golden_fixture_is_clean),
        ("negative fixtures are each caught", check_negative_fixtures_are_caught),
    ]
    failures = 0
    for name, fn in checks:
        ok, detail = fn()
        print(f"  {'✓' if ok else '✗ FAIL'} {name}{f' — {detail}' if not ok and detail else ''}")
        if not ok:
            failures += 1
    print("\n" + ("✓ ALL SELF-TESTS PASSED" if failures == 0 else f"✗ {failures} SELF-TEST(S) FAILED"))
    return failures == 0


def run_checks(state):
    findings = []

    def add(level, code, message, ref=None):
        findings.append(Finding(level, code, message, ref))

    entries = state.get("entries") or []
    deleted_ids = set(state.get("deletedIds") or [])
    paid = state.get("paid") or {}
    phases = state.get("phases") or {}
    espn_sync = state.get("espnSync") or {}
    audit_log = state.get("auditLog") or []

    # ── IDs duplicados / entradas duplicadas ────────────────────────────────────────────────
    seen_ids = {}
    for e in entries:
        eid = e.get("id")
        if eid is None:
            add("ERROR", "entry-missing-id", "Entrada sem campo id", ref=mask_entry_label(e))
            continue
        if eid in seen_ids:
            add("CRITICAL", "duplicate-entry-id",
                f"ID de entrada duplicado: {eid} — risco direto de pagamento/ranking incorreto",
                ref=eid)
        seen_ids[eid] = seen_ids.get(eid, 0) + 1

    # Duplicate *content* (same participant email registered twice) is only ever WARNING — a
    # real participant is allowed to submit a second entry (see "Participante A #1/#2",
    # 2026-08-01 — this is expected product behavior, not a defect).
    by_email = {}
    for e in entries:
        email = (e.get("participantEmail") or "").strip().lower()
        if email:
            by_email.setdefault(email, []).append(e)
    for email, group in by_email.items():
        if len(group) > 1:
            ids = ",".join(str(g.get("id")) for g in group)
            add("INFO", "multiple-entries-same-email",
                f"{len(group)} entradas para o mesmo e-mail — pode ser legítimo (2a entrada do mesmo participante)",
                ref=ids)

    # ── entrada sem participante ─────────────────────────────────────────────────────────────
    # "participante sem entrada" não se aplica a este modelo de dados: não existe um cadastro de
    # participantes separado das entradas (o participante É a entrada). Ver docstring do módulo.
    for e in entries:
        if not (e.get("entryName") or "").strip():
            add("ERROR", "entry-no-name", "Entrada sem nome de participante", ref=mask_entry_label(e))
        if not (e.get("participantEmail") or "").strip():
            add("ERROR", "entry-no-email", "Entrada sem e-mail de participante", ref=mask_entry_label(e))

    # ── pagamento sem entrada ────────────────────────────────────────────────────────────────
    entry_ids = {e.get("id") for e in entries}
    for pid in paid:
        if pid not in entry_ids and pid not in deleted_ids:
            add("ERROR", "payment-no-entry", f"Marca de pagamento para entrada inexistente: {pid}", ref=pid)
        elif pid in deleted_ids:
            add("WARNING", "payment-on-deleted-entry",
                f"Marca de pagamento em entrada excluída (tombstone): {pid} — dinheiro pode precisar de reembolso manual",
                ref=pid)

    # ── entrada excluída mas ainda presente (tombstone inconsistente) ───────────────────────
    for e in entries:
        if e.get("id") in deleted_ids:
            add("ERROR", "entry-both-active-and-deleted",
                "Entrada presente em `entries` E em `deletedIds` ao mesmo tempo", ref=mask_entry_label(e))

    # ── referências quebradas: picks apontando para confrontos inexistentes ─────────────────
    known_tie_ids = set()
    for phase in phases.values():
        known_tie_ids |= set((phase.get("ties") or {}).keys())
    for e in entries:
        picks = e.get("picks") or {}
        for tie_id in list((picks.get("matches") or {}).keys()) + list((picks.get("qualified") or {}).keys()):
            if tie_id not in known_tie_ids:
                add("ERROR", "pick-references-unknown-tie",
                    f"Palpite referencia confronto inexistente: {tie_id}", ref=mask_entry_label(e))

    # ── auditLog malformado / referências quebradas ─────────────────────────────────────────
    for i, ev in enumerate(audit_log):
        if not isinstance(ev, dict):
            add("ERROR", "audit-event-malformed", f"Evento de auditoria não é um objeto (índice {i})")
            continue
        if not ev.get("action"):
            add("ERROR", "audit-event-no-action", f"Evento de auditoria sem `action` (índice {i})")
        if parse_iso(ev.get("ts")) is None:
            add("ERROR", "audit-event-bad-timestamp", f"Evento de auditoria com `ts` inválido (índice {i})", ref=ev.get("ts"))
        detail = ev.get("detail") or {}
        ref_id = detail.get("entryId")
        if ref_id and ref_id not in entry_ids and ref_id not in deleted_ids:
            add("WARNING", "audit-event-orphan-entry-ref",
                f"Evento de auditoria referencia entryId inexistente: {ref_id}", ref=ref_id)

    # ── flags de migração (espnSync) ─────────────────────────────────────────────────────────
    for k, v in espn_sync.items():
        if k == "activePhaseId":
            if v is not None and v not in phases:
                add("CRITICAL", "espnsync-unknown-active-phase",
                    f"espnSync.activePhaseId aponta para fase inexistente: {v}", ref=v)
            continue
        if k not in KNOWN_ESPN_SYNC_FLAGS:
            add("WARNING", "espnsync-unknown-flag", f"Flag de migração desconhecida em espnSync: {k}", ref=k)
        elif not isinstance(v, bool):
            add("ERROR", "espnsync-flag-not-boolean", f"Flag de migração {k} não é booleana: {v!r}", ref=k)

    # ── confrontos / partidas ────────────────────────────────────────────────────────────────
    now = datetime.now(timezone.utc)
    for phase_id, phase in phases.items():
        ties = phase.get("ties") or {}
        for tie_id, tie in ties.items():
            matches = tie.get("matches") or {}
            for leg, m in matches.items():
                status = m.get("status")
                gh, ga = m.get("goalsHome"), m.get("goalsAway")
                kickoff = parse_iso(m.get("kickoff"))
                if m.get("kickoff") is not None and kickoff is None:
                    add("ERROR", "invalid-timestamp", f"kickoff inválido em {tie_id}.{leg}: {m.get('kickoff')!r}", ref=tie_id)
                if status == "FINAL" and (gh is None or ga is None):
                    level = "CRITICAL" if phase_id == "final" else "ERROR"
                    add(level, "final-status-no-score",
                        f"Partida marcada FINAL sem placar válido: {tie_id}.{leg}", ref=tie_id)
                if status == "FINAL" and gh == 0 and ga == 0 and kickoff and kickoff > now:
                    add("WARNING", "suspicious-0x0-future-kickoff",
                        f"Placar 0x0 marcado FINAL com kickoff no futuro ({m.get('kickoff')}) em {tie_id}.{leg} "
                        "— verifique se não é um jogo adiado detectado incorretamente como resultado real",
                        ref=tie_id)
            # dados de time inconsistentes: tie sem teamA/teamB definidos mas com resultado
            if matches and (not tie.get("teamA") or not tie.get("teamB")):
                add("ERROR", "tie-missing-team-names",
                    f"Confronto {tie_id} tem partidas mas teamA/teamB não definidos", ref=tie_id)

        # ── confronto sem fase (referência espnSync.activePhaseId já coberta acima) ──────────
        cutoff = parse_iso(phase.get("cutoffAt"))
        if phase.get("cutoffAt") is not None and cutoff is None:
            add("ERROR", "invalid-timestamp", f"cutoffAt inválido na fase {phase_id}: {phase.get('cutoffAt')!r}", ref=phase_id)

    # ── campeão incompatível com a final ─────────────────────────────────────────────────────
    final_phase = phases.get("final")
    if final_phase:
        final_ties = final_phase.get("ties") or {}
        if len(final_ties) != 1:
            add("WARNING", "final-not-single-tie",
                f"Fase 'final' tem {len(final_ties)} confrontos, esperado exatamente 1", ref="final")
        else:
            tie_id, tie = next(iter(final_ties.items()))
            single = (tie.get("matches") or {}).get("single")
            qid = tie.get("qualifiedTeamId")
            if single and qid and single.get("goalsHome") is not None and single.get("goalsAway") is not None:
                gh, ga = single["goalsHome"], single["goalsAway"]
                if gh != ga:  # a draw needs penalties, can't be inferred from goals alone
                    implied = "A" if gh > ga else "B"
                    if implied != qid:
                        add("CRITICAL", "champion-contradicts-score",
                            f"Final {tie_id}: qualifiedTeamId={qid} mas o placar ({gh}x{ga}) implica {implied} "
                            "— campeão registrado é incompatível com o resultado",
                            ref=tie_id)

    # ── dados de competição errada: nomes de time desconhecidos (best-effort, INFO/WARNING) ──
    known_teams = set()
    try:
        data_js_path = os.path.join(SCRIPT_DIR, "..", "js", "data.js")
        with open(data_js_path, encoding="utf-8") as f:
            data_js_src = f.read()
        # Best-effort extraction only — not a substitute for a real JS parse. Any team name in
        # quotes anywhere in data.js is accepted; this exists to catch obvious typos/garbage,
        # not to be an exhaustive whitelist.
        import re
        known_teams = set(re.findall(r'"([A-ZÀ-Ú][\w À-ú.\-]{2,30})"', data_js_src))
    except OSError:
        pass
    if known_teams:
        for phase_id, phase in phases.items():
            for tie_id, tie in (phase.get("ties") or {}).items():
                for team in (tie.get("teamA"), tie.get("teamB")):
                    if team and team not in known_teams:
                        add("WARNING", "unrecognized-team-name",
                            f"Time '{team}' em {tie_id} não encontrado em data.js — pode ser normal "
                            "(rodada futura ainda não cadastrada) ou um typo", ref=tie_id)

    # ── recomputação de pontuação (transparência, não é uma checagem de divergência real) ───
    for e in entries:
        try:
            total = recompute_entry_total(e, phases)
        except Exception as exc:  # noqa: BLE001 — qualquer exceção aqui é um dado corrompido
            add("ERROR", "score-recompute-crashed", f"Recomputação de pontuação falhou: {exc}", ref=mask_entry_label(e))
            continue
        if not isinstance(total, int) or total < 0:
            add("ERROR", "score-recompute-impossible",
                f"Recomputação produziu total impossível: {total!r}", ref=mask_entry_label(e))
        else:
            add("INFO", "score-recompute", f"Recomputado (transparência, não é o valor oficial do app): {total} pts",
                ref=mask_entry_label(e))

    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", default=DEFAULT_FIXTURE,
                         help="Caminho para um snapshot LOCAL de estado (JSON). Nunca busca produção. "
                              f"Padrão: {os.path.relpath(DEFAULT_FIXTURE, SCRIPT_DIR)}")
    parser.add_argument("--json", action="store_true", help="Saída em JSON em vez de texto")
    parser.add_argument("--min-level", default="INFO", choices=LEVELS,
                         help="Nível mínimo a exibir (padrão: INFO, mostra tudo)")
    parser.add_argument("--self-test", action="store_true",
                         help="Roda a suíte de self-tests embutida (transcrição vs. golden master, "
                              "golden_state.json limpo, fixtures negativas detectadas) e sai — não lê --file")
    args = parser.parse_args()

    if args.self_test:
        return 0 if run_self_tests() else 1

    ok, detail = check_recompute_matches_golden_master()
    if not ok:
        print(f"SELF-TEST FAILED — score-recompute transcription has drifted from app.js: {detail}", file=sys.stderr)
        print("Refusing to run — score-recompute findings would be unreliable. Fix recompute_entry_total() first.", file=sys.stderr)
        return 2

    with open(args.file, encoding="utf-8") as f:
        state = json.load(f)

    findings = run_checks(state)
    min_idx = LEVELS.index(args.min_level)
    shown = [f for f in findings if LEVELS.index(f.level) >= min_idx]

    if args.json:
        print(json.dumps({
            "file": args.file,
            "findings": [f.to_dict() for f in shown],
            "counts": {lvl: sum(1 for f in findings if f.level == lvl) for lvl in LEVELS},
        }, ensure_ascii=False, indent=2))
    else:
        print(f"CDB2026 audit_integrity — {args.file}\n")
        for f in shown:
            ref = f" [{f.ref}]" if f.ref else ""
            print(f"  {f.level:<8} {f.code:<32} {f.message}{ref}")
        print()
        counts = {lvl: sum(1 for f in findings if f.level == lvl) for lvl in LEVELS}
        print("Resumo: " + " | ".join(f"{lvl}={counts[lvl]}" for lvl in LEVELS))

    return 1 if any(f.level == "CRITICAL" for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
