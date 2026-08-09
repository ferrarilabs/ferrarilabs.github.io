"""
send_bracket_correction_email.py — Bolão Ferrari Copa 2026
Sends individual bilingual emails notifying participants of the Round of 16
bracket correction (M89/M90/M91/M95/M96 path fix, v4.16).

Usage:
  python3 send_bracket_correction_email.py             # sends to all real participants
  python3 send_bracket_correction_email.py --test      # sends only to admin (emferrari@gmail.com)
  python3 send_bracket_correction_email.py --dry-run   # validates + builds emails, sends nothing

Fail-closed contract (P0.2 hotfix, 2026-08): if a real send is requested and
any real participant is missing routing (COPA_BRACKET_CORRECTION_ROUTING env
var unset/incomplete), this script refuses to send ANYTHING and exits
non-zero — it never silently skips participants and reports "0 sent" as
success, and it never logs a raw email address (only masked).
"""

import json
import os, os, sys, time, urllib.request
from collections import defaultdict

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL  = "https://cmhqkkfczotdnssupkni.supabase.co"
ANON_KEY      = "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"
EMAILJS_URL   = "https://api.emailjs.com/api/v1.0/email/send"
EMAILJS_KEY   = "GBZFujsJBET6modve"
EMAILJS_SVC   = "service_o4hyzxr"
EMAILJS_TMPL  = "template_xq7yzzb"
ADMIN_EMAIL   = "emferrari@gmail.com"
SITE_URL      = "https://ferrarilabs.github.io/bolao/copa2026/"

SUBJECT = "⚽ Bolão do Ferrari — Correção de bracket (oitavas / Round of 16)"

EMAILJS_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Origin":  "https://ferrarilabs.github.io",
    "Referer": "https://ferrarilabs.github.io/bolao/copa2026/",
}

# ── Bracket correction data ───────────────────────────────────────────────────
# Team name lookup by R32 match slot (data.js internal numbering)
TEAMS_PT = {
    "73": "Canada", "74": "Brasil", "75": "Alemanha/Paraguai",
    "76": "Holanda/Marrocos", "77": "C.Marfim/Noruega", "78": "França/Suécia",
    "85": "Suíça/Argélia", "86": "Austrália/Egito",
    "87": "Argentina/Cabo Verde", "88": "Colômbia/Gana",
}
TEAMS_EN = {
    "73": "Canada", "74": "Brazil", "75": "Germany/Paraguay",
    "76": "Netherlands/Morocco", "77": "Ivory Coast/Norway", "78": "France/Sweden",
    "85": "Switzerland/Algeria", "86": "Australia/Egypt",
    "87": "Argentina/Cape Verde", "88": "Colombia/Ghana",
}

# Old (wrong) bracket paths: match → (slot_A, slot_B)
WRONG = {
    "89": ("73", "75"), "90": ("74", "77"), "91": ("76", "78"),
    "95": ("86", "88"), "96": ("85", "87"),
}
# Correct bracket paths
RIGHT = {
    "89": ("73", "76"), "90": ("75", "78"), "91": ("74", "77"),
    "95": ("87", "86"), "96": ("85", "88"),
}

# Manual email routing: payer → (to, cc). This was a one-time historical send
# (Round of 16 bracket correction, v4.16, already sent) — kept as a script for
# audit/reference, not scheduled or re-run automatically.
#
# PII P0 hotfix (2026-08): this file is committed to a PUBLIC repo and must
# never hardcode real participant emails. Routing now loads from the
# COPA_BRACKET_CORRECTION_ROUTING env var (JSON: {"Payer Name": ["to", "cc-or-empty"]}),
# never from a committed literal. If unset, ROUTING is empty and every payer is
# skipped (fails safe — see the "no routing configured" guard below), not
# silently mis-sent.
def _load_routing():
    raw = os.environ.get("COPA_BRACKET_CORRECTION_ROUTING", "")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return {k: (v[0], v[1] if len(v) > 1 else "") for k, v in data.items()}
    except Exception as e:
        print(f"⚠️  COPA_BRACKET_CORRECTION_ROUTING is set but invalid JSON: {e}")
        return {}

ROUTING = _load_routing()

def _mask(value):
    """Never log a raw email/name — first char + last char + length only."""
    if not value:
        return "(empty)"
    if len(value) <= 2:
        return "*" * len(value)
    return f"{value[0]}{'*' * (len(value) - 2)}{value[-1]} (len {len(value)})"

# ── Supabase ──────────────────────────────────────────────────────────────────
def sb_fetch():
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/bolao_state?id=eq.main&select=state",
        headers={"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}"}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())[0]["state"]

# ── HTML builder ──────────────────────────────────────────────────────────────
def build_html(payer, entries, lang, cc_label=""):
    is_en  = (lang == "en")
    NAMES  = TEAMS_EN if is_en else TEAMS_PT
    first  = payer.split()[0]

    # Collect changed lines and build reply block
    changed_items = []
    reply_lines   = []

    for e in entries:
        ename = e.get("entryName", payer)
        picks = e.get("picks", {})
        reply_lines.append(f"ENTRADA / ENTRY: {ename}")

        for mid in ["89", "90", "91", "95", "96"]:
            p   = picks.get(mid, {})
            ga  = p.get("goalsA", "?")
            gb  = p.get("goalsB", "?")
            adv = p.get("advanceSide", "")
            idx = 0 if adv == "A" else 1

            if adv:
                old_team = NAMES[WRONG[mid][idx]]
                new_team = NAMES[RIGHT[mid][idx]]
                changed  = (old_team != new_team)
            else:
                old_team = new_team = ""
                changed  = False

            if changed:
                prefix = f"[{ename}] " if len(entries) > 1 else ""
                if is_en:
                    changed_items.append(
                        f"• {prefix}M{mid}: you picked <em>{old_team}</em> to advance "
                        f"→ now it means <strong>{new_team}</strong>"
                    )
                else:
                    changed_items.append(
                        f"• {prefix}M{mid}: você queria avançar <em>{old_team}</em> "
                        f"→ agora significa <strong>{new_team}</strong>"
                    )
                adv_note = f"{ga}x{gb}, {new_team}"
            elif adv:
                adv_note = f"{ga}x{gb}, {new_team}"
            else:
                adv_note = f"{ga}x{gb}"

            reply_lines.append(f"M{mid}: MANTER / KEEP  ← {adv_note}")

        reply_lines.append("")

    changed_html = "<br>".join(changed_items)
    reply_block  = "\n".join(reply_lines).strip()

    cc_note = ""
    if cc_label:
        cc_note = (
            f'<p style="font-size:11px;color:#888;margin:0 0 12px;">'
            f'(Cópia / Copy: {cc_label})</p>'
        )

    if is_en:
        body = f"""
        <p>Hey <strong>{first}</strong>,</p>
        <p>I found and fixed a bracket error in the Round of 16 — 5 matchups had wrong opponents.
        The site is already updated with the correct bracket.</p>
        <p>👉 <strong>Open the site and check your picks for M89–M96 (Round of 16):</strong><br>
        <a href="{SITE_URL}" style="color:#1a237e;font-size:15px;font-weight:bold;">{SITE_URL}</a></p>
        <p>Here's what changed for you specifically:</p>
        <p style="background:#fff9c4;border-left:4px solid #f9a825;padding:10px 14px;
                  font-size:13px;line-height:1.8;">{changed_html}</p>
        <p>If you want to update any pick, reply with the block below by
        <strong>Saturday July 4 at noon ET</strong>.
        Just change the lines you want — replace what's after ← with your new score and who advances.
        <strong>No reply = current picks stand.</strong></p>
        <pre style="background:#f5f5f5;border:1px solid #ddd;border-radius:4px;
                    padding:12px;font-size:12px;line-height:1.8;">{reply_block}</pre>
        {cc_note}
        <p style="font-size:11px;color:#aaa;margin-top:4px;">
        Eduardo Ferrari · emferrari@gmail.com</p>"""
    else:
        body = f"""
        <p>Oi <strong>{first}</strong>!</p>
        <p>Corrigi um erro no bracket das oitavas — 5 jogos estavam com adversários errados.
        O site já está atualizado com o bracket correto.</p>
        <p>👉 <strong>Acesse o site e confira seus palpites de M89 a M96 (Oitavas):</strong><br>
        <a href="{SITE_URL}" style="color:#1a237e;font-size:15px;font-weight:bold;">{SITE_URL}</a></p>
        <p>O que mudou especificamente para você:</p>
        <p style="background:#fff9c4;border-left:4px solid #f9a825;padding:10px 14px;
                  font-size:13px;line-height:1.8;">{changed_html}</p>
        <p>Se quiser ajustar algum palpite, responde esse email com o bloco abaixo até
        <strong>sábado 4/jul ao meio-dia ET</strong>.
        Muda só o que quiser — substitua o que está depois de ← pelo novo placar e time.
        <strong>Sem resposta = palpites atuais valem.</strong></p>
        <pre style="background:#f5f5f5;border:1px solid #ddd;border-radius:4px;
                    padding:12px;font-size:12px;line-height:1.8;">{reply_block}</pre>
        <p style="font-size:11px;color:#bbb;margin-top:8px;border-top:1px solid #eee;padding-top:8px;">
        <em>EN: bracket error corrected — 5 Round of 16 matchups had wrong opponents.
        Site is updated. Reply by July 4 noon ET to adjust picks. No reply = picks stand.</em></p>
        {cc_note}
        <p style="font-size:11px;color:#aaa;margin-top:4px;">
        Eduardo Ferrari · emferrari@gmail.com</p>"""

    return f"""<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:540px;
    margin:0 auto;padding:16px;color:#222;">
  <div style="background:#1a237e;padding:10px 18px;border-radius:6px 6px 0 0;">
    <span style="color:white;font-weight:bold;font-size:15px;">
      ⚽ Bolão do Ferrari — Correção de bracket
    </span>
  </div>
  <div style="border:1px solid #ddd;border-top:none;padding:18px;border-radius:0 0 6px 6px;">
    {body}
  </div>
</body></html>"""

# ── EmailJS sender ────────────────────────────────────────────────────────────
# ─── AUD-02: TRANSPORTE REAL FALHA FECHADO ──────────────────────────────────────────────────
#
# Descoberto pelo gate repo-wide (audit_email_send_safety.mjs), não pela auditoria original: este
# sender ficou de fora da lista inicial e estava tão desprotegido quanto os outros três. É o motivo
# de o gate enumerar TODOS os arquivos que falam com o provedor em vez de confiar numa lista feita
# à mão — a lista à mão já tinha esquecido este.
#
# Autorização POSITIVA: envio real só com declaração explícita no ambiente. Qualquer execução não
# declarada (teste, CI, local, interativa) não alcança o provedor.
_TRANSPORT = None
_ALLOW_ENV = "BOLAO_ALLOW_REAL_SEND"
_ALLOW_TOKEN = "I UNDERSTAND"


def real_send_allowed():
    """(permitido, motivo). Fail-closed: só True com autorização explícita e fora de teste."""
    if os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("BOLAO_TEST_RUN"):
        return False, "processo de teste"
    if os.environ.get(_ALLOW_ENV) == _ALLOW_TOKEN:
        return True, None
    return False, f"sem autorizacao explicita ({_ALLOW_ENV})"


def send_email(addr, html):
    # AUD-02: portão ANTES de qualquer chamada ao provedor.
    if _TRANSPORT is None:
        allowed, why = real_send_allowed()
        if not allowed:
            msg = f"EMAIL_SEND_BLOCKED: {why}. Nenhuma mensagem enviada."
            print(f"BLOQUEADO {msg}")
            return False, msg
    payload = json.dumps({
        "service_id":      EMAILJS_SVC,
        "template_id":     EMAILJS_TMPL,
        "user_id":         EMAILJS_KEY,
        "template_params": {
            "to_email":     addr,
            "entry_name":   SUBJECT,
            "receipt_code": SUBJECT,
            "html_message": html,
        }
    }).encode()
    req = urllib.request.Request(
        EMAILJS_URL, data=payload, headers=EMAILJS_HEADERS, method="POST"
    )
    if _TRANSPORT is not None:
        return _TRANSPORT(EMAILJS_URL, payload, EMAILJS_HEADERS)
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status

def resolve_routing(payers, routing):
    """Pure function: resolve each payer's (to, cc) from `routing`, fail-closed.

    Returns (resolved: dict, missing: list[payer], ambiguous: list[(payer, payer)]).
    No I/O, no printing, no sending — testable without Supabase/EmailJS access.
    """
    resolved, missing, ambiguous = {}, [], []
    seen_targets = {}  # to-address -> payer, to detect two different payers
                        # accidentally routed to the same address (collision)
    for payer in payers:
        to, cc = routing.get(payer, ("", ""))
        if not to or "@" not in to:
            missing.append(payer)
            continue
        if to in seen_targets and seen_targets[to] != payer:
            ambiguous.append((payer, seen_targets[to]))
        seen_targets[to] = payer
        resolved[payer] = (to, cc)
    return resolved, missing, ambiguous

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    test_mode = "--test" in sys.argv
    dry_run   = "--dry-run" in sys.argv

    print("Fetching state from Supabase...")
    state   = sb_fetch()
    entries = state.get("entries", [])
    deleted = set(state.get("deletedIds", []))

    real = [
        e for e in entries
        if e.get("id") not in deleted
        and not (e.get("diagnostics") or {}).get("demo")
    ]

    payer_map = defaultdict(list)
    for e in real:
        p = e.get("payerName") or e.get("entryName", "?")
        payer_map[p].append(e)

    if test_mode:
        print(f"\n⚠️  TEST MODE — sending only to admin ({_mask(ADMIN_EMAIL)})\n")
        if dry_run:
            print("DRY_RUN=true — validated only, nothing sent.")
            return
        html = build_html("Eduardo Ferrari", payer_map.get("Eduardo Ferrari", [real[0]]), "pt")
        try:
            status = send_email(ADMIN_EMAIL, html)
            print(f"  OK {status} → {_mask(ADMIN_EMAIL)}")
        except Exception as ex:
            print(f"  ERR → {_mask(ADMIN_EMAIL)}: {ex}")
        return

    # ── Fail-closed pre-validation: resolve every payer's routing BEFORE any
    # send happens. A real send request with any unresolved participant is a
    # hard failure, not a partial/silent skip (P0.2 gate).
    payers = sorted(payer_map.keys())
    resolved, missing, ambiguous = resolve_routing(payers, ROUTING)

    print(f"\nRouting resolution: {len(resolved)}/{len(payers)} payer(s) resolved, "
          f"{len(missing)} missing, {len(ambiguous)} ambiguous (masked identifiers only).")

    if missing:
        print("❌ FAILED — missing routing for required recipient(s):")
        for p in missing:
            print(f"   - {_mask(p)}")
        print("\nSet COPA_BRACKET_CORRECTION_ROUTING before sending. No email was sent.")
        sys.exit(1)

    if ambiguous:
        print("❌ FAILED — routing collision (two payers resolved to the same address):")
        for p1, p2 in ambiguous:
            print(f"   - {_mask(p1)} / {_mask(p2)}")
        print("\nFix COPA_BRACKET_CORRECTION_ROUTING before sending. No email was sent.")
        sys.exit(1)

    if dry_run:
        print(f"\nDRY_RUN=true — {len(resolved)} payer(s) fully resolved, 0 sent (dry run).")
        return

    sent, errors = 0, []
    for payer, (to, cc) in resolved.items():
        elist  = payer_map[payer]
        lang   = "en" if payer == "Mitch" else "pt"
        html   = build_html(payer, elist, lang, cc_label=cc if cc else "")

        # Primary send
        try:
            status = send_email(to, html)
            print(f"  OK {status} → {_mask(to)}  [{_mask(payer)}]")
            sent += 1
        except Exception as ex:
            errors.append((payer, "to"))
            print(f"  ERR → {_mask(to)}: {ex}")

        time.sleep(4)

        # CC send (same HTML)
        if cc:
            try:
                status = send_email(cc, html)
                print(f"  OK {status} → {_mask(cc)}  [CC: {_mask(payer)}]")
                sent += 1
            except Exception as ex:
                errors.append((payer, "cc"))
                print(f"  ERR → {_mask(cc)}: {ex}")
            time.sleep(4)

    print(f"\n{'✓' if not errors else '⚠'} {sent} sent, {len(errors)} errors")
    if errors:
        for payer, which in errors:
            print(f"  ERROR: {_mask(payer)} ({which})")
        sys.exit(1)

if __name__ == "__main__":
    main()
