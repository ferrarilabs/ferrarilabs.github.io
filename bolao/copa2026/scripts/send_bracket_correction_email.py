"""
send_bracket_correction_email.py — Bolão Ferrari Copa 2026
Sends individual bilingual emails notifying participants of the Round of 16
bracket correction (M89/M90/M91/M95/M96 path fix, v4.16).

Usage:
  python3 send_bracket_correction_email.py           # sends to all 15 participants
  python3 send_bracket_correction_email.py --test    # sends only to admin (emferrari@gmail.com)
"""

import json, sys, time, urllib.request
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

# Manual email routing: payer → (to, cc)
# cc = "" means no CC
ROUTING = {
    "Eduardo Ferrari":     ("REDACTED_EMAIL", "emferrari@gmail.com"),
    "Mitch":               ("REDACTED_EMAIL",     ""),
    "Aline":               ("REDACTED_EMAIL",  ""),
    "Fabrizio Marodin":    ("REDACTED_EMAIL", ""),
    "Samuel":              ("REDACTED_EMAIL",     ""),
    "Kisie Krawczyk":      ("REDACTED_EMAIL",    ""),
    "Simone":              ("REDACTED_EMAIL",   ""),
    "Gustavo Bossle":      ("REDACTED_EMAIL", ""),
    "Alan":                ("REDACTED_EMAIL",   "REDACTED_EMAIL"),
    "Nathalia":            ("REDACTED_EMAIL", ""),
    "Gustavo Ribeiro":     ("REDACTED_EMAIL",  ""),
    "Camila":              ("REDACTED_EMAIL", ""),
    "Ewerton":             ("REDACTED_EMAIL", ""),
    "Roberta Falcao Rech": ("REDACTED_EMAIL",   ""),
    "Vinicius":            ("REDACTED_EMAIL", ""),
}

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
def send_email(addr, html):
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
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    test_mode = "--test" in sys.argv

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
        print(f"\n⚠️  TEST MODE — sending only to {ADMIN_EMAIL}\n")
        html = build_html("Eduardo Ferrari", payer_map.get("Eduardo Ferrari", [real[0]]), "pt")
        try:
            status = send_email(ADMIN_EMAIL, html)
            print(f"  OK {status} → {ADMIN_EMAIL}")
        except Exception as ex:
            print(f"  ERR → {ADMIN_EMAIL}: {ex}")
        return

    sent, errors = 0, []
    for payer, elist in payer_map.items():
        to, cc = ROUTING.get(payer, ("", ""))
        if not to:
            print(f"  SKIP {payer} — no routing configured")
            continue

        lang   = "en" if payer == "Mitch" else "pt"
        html   = build_html(payer, elist, lang, cc_label=cc if cc else "")

        # Primary send
        try:
            status = send_email(to, html)
            print(f"  OK {status} → {to}  [{payer}]")
            sent += 1
        except Exception as ex:
            errors.append(f"{to}: {ex}")
            print(f"  ERR → {to}: {ex}")

        time.sleep(4)

        # CC send (same HTML)
        if cc:
            try:
                status = send_email(cc, html)
                print(f"  OK {status} → {cc}  [CC: {payer}]")
                sent += 1
            except Exception as ex:
                errors.append(f"{cc}: {ex}")
                print(f"  ERR → {cc}: {ex}")
            time.sleep(4)

    print(f"\n{'✓' if not errors else '⚠'} {sent} sent, {len(errors)} errors")
    for err in errors:
        print(f"  ERROR: {err}")

if __name__ == "__main__":
    main()
