"""
round_catchup_dryrun.py — preflight de catch-up de rodada. LEITURA APENAS, NUNCA ENVIA.

Roda o modelo canônico (manifesto + resolver + reconciliador) contra os dados reais de produção
e produz o artefato privado de revisão. Não escreve no Supabase, não chama o provedor de email,
não altera estado nenhum.

O HTML gerado contém nome de participante — por isso vai para a área privada de revisão
(`~/Documents/GitHub/ferrarilabs-work/reviews/`), nunca para o repositório publicado.

Uso:
  python3 bolao/br2026/scripts/round_catchup_dryrun.py [--round N]
"""

import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

os.environ.setdefault("BOLAO_TEST_RUN", "1")   # trava dura: nenhum envio real possível
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import round_state as R
import build_round_manifest as M
import send_round_email as S
import legacy_round_state as L

OUT_DIR = os.path.expanduser("~/Documents/GitHub/ferrarilabs-work/reviews")


def observations_for(round_def):
    """Observações reais dos jogos de uma rodada, incluindo eventuais rejogos."""
    ids = set(round_def["canonicalFixtureIds"]) | set((round_def.get("replacements") or {}).values())
    lo = datetime.fromisoformat(round_def["dateRangeUtc"][0]).date() - timedelta(days=2)
    hi = date.today() + timedelta(days=1)
    raw = S.fetch_scoreboard_window(lo, hi)
    now_iso = datetime.now(timezone.utc).isoformat()

    obs = {}
    for fid in ids:
        g = raw.get(fid)
        if not g:
            continue
        obs[fid] = {
            "state": g.get("statusState") or ("post" if g["completed"] else "in"),
            "completed": g["completed"],
            # Nome de status REAL do upstream. Derivar de `completed` apagaria STATUS_POSTPONED
            # e faria uma rodada travada em adiamento parecer meramente "incompleta".
            "statusName": g.get("statusName") or ("STATUS_FULL_TIME" if g["completed"] else "STATUS_UNKNOWN"),
            "observedAt": now_iso,
            # Sem instante real de encerramento no payload do scoreboard, usamos a data do jogo:
            # é conservador (só ATRASA a elegibilidade, nunca a antecipa).
            "terminalAt": g["date"].isoformat() if g["completed"] else None,
            "_game": g,
        }
    return obs, raw


def main():
    args = sys.argv[1:]
    manifest = M.load()
    problems = M.validate(manifest)
    if problems:
        print("🛑 manifesto inválido — abortando:", problems)
        sys.exit(1)

    target = None
    if "--round" in args:
        target = int(args[args.index("--round") + 1])

    print("Auto-auditoria de scoring antes de qualquer coisa...")
    ok, _ = __import__("audit_scoring").run_static_audit(verbose=False)
    ok2, _ = S._self_check_rank_entries()
    if not (ok and ok2):
        print("🛑 auto-auditoria falhou — abortando.")
        sys.exit(1)
    print("✓ auto-auditoria passou.\n")

    state = S.sb_fetch()
    legacy = state.get("roundEmail") or {}
    # Estado durável novo, quando existir; senão traduz o legado. Sem isto, toda rodada
    # historica pareceria nao notificada.
    notification_states = dict(legacy.get("notifications") or {})
    migrated, mig_report = L.migrate(legacy, manifest)
    for k, v in migrated.items():
        notification_states.setdefault(k, v)
    print("MIGRACAO DO ESTADO LEGADO")
    print(f"  LEGACY_SENT_GAME_IDS_MIGRATED = {mig_report['sentGameIdsCount']}")
    print(f"  LEGACY_SENT_BATCHES_MIGRATED  = {mig_report['sentBatchesCount']}")
    print(f"  rodadas marcadas SENT         = {mig_report['roundsMarkedSent']}")
    print(f"  rodadas marcadas PARTIAL      = {mig_report['roundsMarkedPartial']}")
    print(f"  LEGACY_PENDING_BATCH          = {mig_report['legacyPendingBatchDisposition']}\n")

    # Reconciliação sobre as rodadas já iniciadas (as futuras não têm o que reconciliar).
    today = datetime.now(timezone.utc)
    relevant = [r for r in manifest["rounds"]
                if datetime.fromisoformat(r["dateRangeUtc"][0]) <= today]
    if target:
        relevant = [r for r in relevant if r["roundNumber"] == target]

    all_obs = {}
    for r in relevant[-6:]:          # janela de reconciliação limitada, porém suficiente
        o, _ = observations_for(r)
        all_obs.update(o)

    out = R.reconcile({"rounds": relevant[-6:]}, all_obs, notification_states, now=today)

    print("=" * 70)
    print("RECONCILIAÇÃO — rodadas avaliadas")
    print("=" * 70)
    for e in out["evaluated"]:
        f = e["facts"]
        print(f"  R{e['roundNumber']:<3} {e['state']:<38} "
              f"final={f.get('finalCount','-')}/{f.get('expectedCount','-')} "
              f"adiados={f.get('postponedCount','-')} — {e['reason']}")
    print(f"\nCANDIDATOS A NOTIFICAÇÃO: {[c['roundNumber'] for c in out['candidates']] or 'nenhum'}")

    for cand in out["candidates"]:
        emit_preflight(cand, manifest, all_obs, state)

    print("\nREAL_EMAILS_SENT = 0")


def emit_preflight(cand, manifest, all_obs, state):
    n = cand["roundNumber"]
    round_def = next(r for r in manifest["rounds"] if r["roundNumber"] == n)
    games = []
    for fid in round_def["canonicalFixtureIds"]:
        eff = (round_def.get("replacements") or {}).get(fid, fid)
        g = (all_obs.get(eff) or all_obs.get(fid) or {}).get("_game")
        if g:
            games.append(g)

    standings = S.fetch_standings()
    g4 = [t["name"] for t in standings[0:4]]
    z4 = [t["name"] for t in standings[16:20]]
    sa6 = [t["name"] for t in standings[6:12]]

    deleted = set(state.get("deletedIds") or [])
    entries = [e for e in state.get("entries", []) if e.get("id") not in deleted]
    ranked = S.rank_entries(entries, g4, z4, sa6)
    rank_by_id = {r["entry"]["id"]: r for r in ranked}

    resolved = [e for e in entries
                if "@" in (e.get("participantEmail") or "").strip() and rank_by_id.get(e["id"])]
    recipient_set_complete = len(resolved) == len(entries)

    results_html = S.build_round_results_html(games)
    standings_html = S.build_standings_html(g4, z4, sa6)
    sample = resolved[0] if resolved else None
    html = ""
    if sample:
        r = rank_by_id[sample["id"]]
        html = S.build_participant_email_html(
            f"{n}", results_html, standings_html, sample,
            {"total": r["total"], "rank": r["rank"], "movement": None})

    import hashlib
    content_hash = hashlib.sha256((results_html + standings_html).encode()).hexdigest()
    recipient_hash = hashlib.sha256(
        "|".join(sorted(e["id"] for e in resolved)).encode()).hexdigest()

    print("\n" + "=" * 70)
    print(f"PREFLIGHT — RODADA {n}")
    print("=" * 70)
    print(f"ROUND_{n}_EXPECTED_MATCHES     = {cand['facts']['expectedCount']}")
    print(f"ROUND_{n}_FINAL_MATCHES        = {cand['facts']['finalCount']}")
    print(f"ROUND_{n}_NON_TERMINAL         = {cand['facts']['nonTerminalCount']}")
    print(f"ROUND_{n}_COMPLETE             = True")
    print(f"ROUND_{n}_NOTIFICATION_STATE   = {cand['state']}")
    print(f"ROUND_{n}_EMAIL_ALREADY_SENT   = False")
    print(f"ROUND_{n}_CATCHUP_REQUIRED     = True")
    print(f"ROUND_{n}_RECIPIENTS_EXPECTED  = {len(entries)}")
    print(f"ROUND_{n}_RECIPIENTS_RESOLVED  = {len(resolved)}")
    print(f"ROUND_{n}_RECIPIENT_SET_COMPLETE = {recipient_set_complete}")
    print(f"ROUND_{n}_STANDINGS_AVAILABLE  = {len(standings) == 20}")
    print(f"ROUND_{n}_CONTENT_COMPLETE     = {bool(html) and len(games) == cand['facts']['expectedCount']}")
    print(f"ROUND_{n}_CONTENT_HASH         = {content_hash[:16]}…")
    print(f"ROUND_{n}_RECIPIENT_SET_HASH   = {recipient_hash[:16]}…")
    print(f"ROUND_{n}_IDEMPOTENCY_KEY      = {cand['idempotencyKey']}")
    print(f"ROUND_{n}_WOULD_SEND           = {recipient_set_complete and bool(html)}")

    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    html_path = os.path.join(OUT_DIR, f"br2026-round{n}-preview-{stamp}.html")
    json_path = os.path.join(OUT_DIR, f"br2026-round{n}-preflight-{stamp}.json")
    with open(html_path, "w", encoding="utf-8") as fh:
        fh.write(html)
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump({
            "roundNumber": n, "state": cand["state"], "facts": cand["facts"],
            "idempotencyKey": cand["idempotencyKey"],
            "expectedRecipientCount": len(entries), "resolvedRecipientCount": len(resolved),
            "recipientSetComplete": recipient_set_complete,
            "contentHash": content_hash, "recipientSetHash": recipient_hash,
            "wouldSend": recipient_set_complete and bool(html),
            "realEmailsSent": 0,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }, fh, ensure_ascii=False, indent=2)
    print(f"\n  artefato privado: {html_path}")
    print(f"  preflight:        {json_path}")


if __name__ == "__main__":
    main()
