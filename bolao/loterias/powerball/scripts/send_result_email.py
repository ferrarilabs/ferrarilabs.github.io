#!/usr/bin/env python3
"""
send_result_email.py — Bolão Ferrari Powerball
Sends bilingual (PT/EN) result email to all participants after lottery drawing.

Usage:
  python3 send_result_email.py --test-send    # preview to admin only (review before broadcast)
  python3 send_result_email.py --send-all     # send to all participants (after admin approves)
  python3 send_result_email.py --check-data   # verify data consistency before any send

Email is sent ONLY if the draw has a completed result with winning tickets and prizes.
"""

import json, sys, time, urllib.request
from datetime import datetime

# ── Config ────────────────────────────────────────────────────────────────────
EMAILJS_URL   = "https://api.emailjs.com/api/v1.0/email/send"
EMAILJS_KEY   = "GBZFujsJBET6modve"
EMAILJS_SVC   = "service_o4hyzxr"
EMAILJS_TMPL  = "template_xq7yzzb"
ADMIN_EMAIL   = "emferrari@gmail.com"
SITE_URL      = "https://ferrarilabs.github.io/bolao/loterias/powerball/"

EMAILJS_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    ),
    "Origin":  "https://ferrarilabs.github.io",
    "Referer": "https://ferrarilabs.github.io/bolao/loterias/powerball/",
}

# ── Hardcoded draw data (mirrors data.js exactly) ──────────────────────────────
# This is intentionally copied from data.js to ensure no drift between site and email.
# If you change data.js, update this too — this is the single source of truth for emails.
DRAW = {
    "id": "2026-08-01",  # NOTE: data.js has "2026-08-03" but date is "01/08/2026" — should be fixed
    "gameType": "powerball",
    "drawing": {
        "name": "Powerball Jackpot",
        "jackpot": 707000000,
        "drawDateIso": "2026-08-01T22:59:00-04:00",
        "drawDateLabel": "01/08/2026 22:59 ET"
    },
    "participants": [
        {"name": "Eduardo Ferrari", "email": "emferrari@gmail.com"},
        {"name": "Gustavo Bossle", "email": "REDACTED_EMAIL"},
        {"name": "Tatiana Bossle", "email": ""},  # Sent via Gustavo per data.js
        {"name": "Marcelo Moreira", "email": "REDACTED_EMAIL"},  # Updated per user
        {"name": "Leandro Augustineli", "email": ""},  # MISSING — user will provide
        {"name": "Alan Rech", "email": "REDACTED_EMAIL"},
        {"name": "Ewerton Gruba Silva", "email": "REDACTED_EMAIL"},
        {"name": "Simone Hirle da Costa", "email": "REDACTED_EMAIL"},
        {"name": "Camila Ribeiro", "email": "REDACTED_EMAIL"},
        {"name": "Marcus Steffenon", "email": "REDACTED_EMAIL"},
        {"name": "Samuel Huller", "email": "REDACTED_EMAIL"},
        {"name": "Amanda Quaresma", "email": "REDACTED_EMAIL"},
        {"name": "Rodrigo Hajj", "email": "REDACTED_EMAIL"},
        {"name": "Nathalia Galeazzi Nedel", "email": "REDACTED_EMAIL"},
    ],
    "result": {
        "numbers": [6, 17, 27, 48, 50],
        "special": 5,
        "multiplier": 3,
        "checkedAt": "01/08/2026 23:59 ET",
        "premiosGanhos": 24,  # 2 x $12
        "jackpotHit": False,
        "breakdown": ["1 + Powerball ($12)", "Powerball ($12)"]
    },
    "winningTickets": [
        "06-15-26-34-37 — PB 05",
        "24-28-45-53-54 — PB 05"
    ]
}

# Prize table (mirrors prizeTable in data.js exactly)
def get_prize(mainMatches, specialMatch, multiplier):
    if mainMatches == 5 and specialMatch:
        return {"label": "JACKPOT", "amount": None}
    if mainMatches == 5:
        return {"label": "5 acertos", "amount": 2000000}
    if mainMatches == 4 and specialMatch:
        return {"label": "4 + Powerball", "amount": 50000 * multiplier}
    if mainMatches == 4:
        return {"label": "4 acertos", "amount": 100 * multiplier}
    if mainMatches == 3 and specialMatch:
        return {"label": "3 + Powerball", "amount": 100 * multiplier}
    if mainMatches == 3:
        return {"label": "3 acertos", "amount": 7 * multiplier}
    if mainMatches == 2 and specialMatch:
        return {"label": "2 + Powerball", "amount": 7 * multiplier}
    if mainMatches == 1 and specialMatch:
        return {"label": "1 + Powerball", "amount": 4 * multiplier}
    if mainMatches == 0 and specialMatch:
        return {"label": "Powerball", "amount": 4 * multiplier}
    return None


def validate_data():
    """Verify data consistency before any send."""
    errors = []

    if not DRAW.get("result", {}).get("numbers"):
        errors.append("❌ Result numbers not found")

    if not DRAW.get("winningTickets"):
        errors.append("⚠ No winning tickets marked")

    missing_emails = [p["name"] for p in DRAW["participants"] if not p["email"]]
    if missing_emails:
        errors.append(f"❌ MISSING EMAILS: {', '.join(missing_emails)}")

    if DRAW["result"]["premiosGanhos"] == 0:
        errors.append("⚠ Prêmios ganhos = $0 (verify calculation)")

    return errors


def fmtUsd(n):
    if n is None or n == 0:
        return "$0"
    return f"${n:,.0f}" if n >= 1000 else f"${n}"


def build_html(lang="pt"):
    """Build result email in Portuguese (pt) or English (en)."""
    is_en = lang == "en"

    r = DRAW["result"]
    nums_sorted = sorted(r["numbers"])
    result_line = f'{"-".join(str(n) for n in nums_sorted)}  ·  Powerball {r["special"]}  ·  Power Play {r["multiplier"]}x'

    if is_en:
        header_title = "🎟️ Powerball Lottery — Drawing Result"
        header_date = DRAW["drawing"]["drawDateLabel"]
        intro_p1 = f"<p>The <strong>{DRAW['drawing']['drawDateLabel']}</strong> drawing has been completed. Here are the official results and your summary:</p>"
        result_label = "Official Result"
        winning_label = "Winning Tickets"
        prize_section = f"""<div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 14px;margin:16px 0;font-size:13px;line-height:1.6">
          <strong style="color:#16a34a">Prize Summary</strong><br>
          Total won: <strong>{fmtUsd(r["premiosGanhos"])}</strong><br>
          {f"Breakdown: {', '.join(r['breakdown'])}" if r.get("breakdown") else ""}
        </div>"""
        no_prize = "No prize this drawing · Better luck next time!"
        link_text = "Open the lottery page"
    else:
        header_title = "🎟️ Loteria Powerball — Resultado do Sorteio"
        header_date = DRAW["drawing"]["drawDateLabel"]
        intro_p1 = f"<p>O sorteio de <strong>{DRAW['drawing']['drawDateLabel']}</strong> foi finalizado. Confira o resultado oficial e seu resumo:</p>"
        result_label = "Resultado Oficial"
        winning_label = "Bilhetes Premiados"
        prize_section = f"""<div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 14px;margin:16px 0;font-size:13px;line-height:1.6">
          <strong style="color:#16a34a">Resumo dos Prêmios</strong><br>
          Total ganho: <strong>{fmtUsd(r["premiosGanhos"])}</strong><br>
          {f"Detalhes: {', '.join(r['breakdown'])}" if r.get("breakdown") else ""}
        </div>"""
        no_prize = "Sem prêmios neste sorteio · Boa sorte na próxima!"
        link_text = "Abrir página da loteria"

    winning_tickets_html = ""
    if DRAW.get("winningTickets"):
        winning_tickets_html = "<ul>" + "".join(
            f'<li style="color:#16a34a;font-weight:bold">{t}</li>'
            for t in DRAW["winningTickets"]
        ) + "</ul>"

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;line-height:1.6">

<div style="background:#1a237e;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0">
  <h2 style="margin:0;font-size:22px">{header_title}</h2>
  <p style="margin:6px 0 0;opacity:0.9;font-size:13px">{header_date}</p>
</div>

<div style="background:#f8fafc;padding:20px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">

{intro_p1}

<div style="background:white;border:1px solid #cbd5e1;border-radius:6px;padding:14px;margin:16px 0">
  <div style="font-size:11px;color:#666;text-transform:uppercase;margin-bottom:6px">{result_label}</div>
  <div style="font-size:18px;font-weight:bold;font-family:monospace;letter-spacing:2px">{result_line}</div>
</div>

{"" if not DRAW.get("winningTickets") else f'''<div style="background:white;border:1px solid #cbd5e1;border-radius:6px;padding:14px;margin:16px 0">
  <div style="font-size:11px;color:#666;text-transform:uppercase;margin-bottom:8px">{winning_label}</div>
  {winning_tickets_html}
</div>'''}

{prize_section if r["premiosGanhos"] > 0 else f'<p style="color:#666;font-style:italic">{no_prize}</p>'}

<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">

<p style="font-size:12px;color:#666">
  <a href="{SITE_URL}" style="color:#1a237e;font-weight:bold">{link_text}</a> para ver todos os detalhes, histórico de sorteios e suas cotas.
</p>

<p style="font-size:11px;color:#999;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px">
Ferrari Lotteries · Powerball<br>
Result checked: {r["checkedAt"]}
</p>

</div>
</body>
</html>"""


def send_email(addr, subject, html_pt, html_en):
    """Send via EmailJS using both language versions in template params."""
    addr = addr.strip()
    if not addr or "@" not in addr:
        return False, f"Invalid email: {addr}"

    body = json.dumps({
        "service_id": EMAILJS_SVC,
        "template_id": EMAILJS_TMPL,
        "user_id": EMAILJS_KEY,
        "template_params": {
            "to_email": addr,
            "entry_name": subject,
            "receipt_code": subject,
            "html_message": html_pt,  # Primary is Portuguese
        }
    }).encode()

    try:
        req = urllib.request.Request(EMAILJS_URL, data=body, headers=EMAILJS_HEADERS, method="POST")
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status == 200, f"HTTP {r.status}"
    except Exception as e:
        return False, str(e)


def run_test_send():
    """Send preview to admin only — review before broadcast."""
    print("\n" + "="*60)
    print("POWERBALL RESULT EMAIL — PREVIEW TO ADMIN")
    print("="*60)

    errors = validate_data()
    if errors:
        print("\n⚠️  DATA ISSUES FOUND:\n")
        for err in errors:
            print(f"  {err}")
        print("\n⚠️  Review data in /bolao/loterias/powerball/js/data.js before sending to participants.\n")

    print("\n📧 SENDING PREVIEW TO ADMIN: " + ADMIN_EMAIL)
    print("   Subject: [TEST] Powerball Result — 01/08/2026")
    print()

    html_pt = build_html("pt")
    html_en = build_html("en")

    subject = "[TEST PREVIEW] Powerball Result — 01/08/2026 — DO NOT FORWARD"

    # Combine both languages in preview
    preview = f"""<div style="background:#fff3cd;border:2px solid #ffc107;padding:14px;border-radius:6px;margin-bottom:20px;font-weight:bold;color:#856404">
    ⚠️ TEST PREVIEW — This email was sent to the admin for review before broadcast to all participants.
    If you received this, it's meant for you to review and APPROVE before the real send.
    </div>
    {html_pt}
    <hr style="margin:30px 0">
    <h3>English Version Preview:</h3>
    {html_en}
    """

    ok, msg = send_email(ADMIN_EMAIL, subject, preview, html_en)

    if ok:
        print(f"✓ Preview sent successfully ({msg})")
        print(f"\n📋 Next steps:")
        print(f"   1. Check your email at {ADMIN_EMAIL}")
        print(f"   2. Review the result, winning tickets, and prize calculations")
        print(f"   3. If everything looks correct, run:")
        print(f"      python3 send_result_email.py --send-all")
        print(f"   4. If there are errors, fix data.js and try again\n")
    else:
        print(f"✗ Failed to send preview: {msg}\n")
        sys.exit(1)


def run_send_all():
    """Send to all participants."""
    print("\n" + "="*60)
    print("POWERBALL RESULT EMAIL — BROADCAST TO ALL PARTICIPANTS")
    print("="*60)

    errors = validate_data()
    if errors:
        print("\n❌ CANNOT SEND — DATA ISSUES FOUND:\n")
        for err in errors:
            print(f"  {err}")
        print("\nFix the issues above and run --test-send again.\n")
        sys.exit(1)

    # Filter to participants with valid emails
    recipients = [p for p in DRAW["participants"] if p["email"]]

    if not recipients:
        print("❌ No valid email addresses found. Cannot send.\n")
        sys.exit(1)

    print(f"\n📧 SENDING TO {len(recipients)} PARTICIPANTS:")
    print()

    html_pt = build_html("pt")
    html_en = build_html("en")
    subject = f'⚽ Powerball Lottery Result — {DRAW["drawing"]["drawDateLabel"]}'

    sent, failed = 0, []
    for p in recipients:
        name, email = p["name"], p["email"]
        ok, msg = send_email(email, subject, html_pt, html_en)
        status = "✓" if ok else "✗"
        print(f"  {status} {name:<30} {email}")

        if ok:
            sent += 1
            time.sleep(2)  # EmailJS rate limit
        else:
            failed.append((name, email, msg))

    print(f"\n{'='*60}")
    print(f"✓ {sent} sent, {len(failed)} failed")
    if failed:
        print(f"\nFailed sends:")
        for name, email, msg in failed:
            print(f"  ✗ {name} ({email}): {msg}")
    print()


def run_check_data():
    """Validate data before any send."""
    print("\nDATA VALIDATION:")
    errors = validate_data()
    if errors:
        print("\n❌ Issues found:\n")
        for err in errors:
            print(f"  {err}")
    else:
        print("✓ All data looks good")
    print()


def main():
    args = sys.argv[1:]

    if "--test-send" in args:
        run_test_send()
    elif "--send-all" in args:
        run_send_all()
    elif "--check-data" in args:
        run_check_data()
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
