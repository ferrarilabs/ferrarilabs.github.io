#!/usr/bin/env python3
"""
send_result_email.py — Bolão Ferrari Lotteries (Powerball / Mega Millions)
Sends result email (PT only) to all participants after lottery drawing.

Supports multiple game types via gameType parameter in draw data:
  - "powerball": Powerball (red ball 1-35)
  - "megamillions": Mega Millions (gold ball 1-25)

Usage:
  python3 send_result_email.py --test-send [gameType]    # preview to admin (default: powerball)
  python3 send_result_email.py --send-all [gameType]     # broadcast to all participants
  python3 send_result_email.py --check-data [gameType]   # validate data before send

Email is sent ONLY if the draw has a completed result with winning tickets and prizes.
Business rule: only play next drawing if jackpot accumulates (configured per draw).
"""

import json, sys, time, urllib.request, re
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

# ── Email routing per participant (read from data.js, not hardcoded) ────────────
# Maps participant name to (email, cc_email) — cc for family/household groups
PARTICIPANT_EMAILS = {
    "Eduardo Ferrari": ("emferrari@gmail.com", ""),
    "Gustavo Bossle": ("REDACTED_EMAIL", ""),
    "Tatiana Bossle": ("REDACTED_EMAIL", ""),  # Sent via Gustavo per data.js
    "Marcelo Moreira": ("REDACTED_EMAIL", ""),
    "Leandro Augustineli": ("REDACTED_EMAIL", ""),
    "Alan Rech": ("REDACTED_EMAIL", "REDACTED_EMAIL"),
    "Ewerton Gruba Silva": ("REDACTED_EMAIL", ""),
    "Simone Hirle da Costa": ("REDACTED_EMAIL", ""),
    "Camila Ribeiro": ("REDACTED_EMAIL", ""),
    "Marcus Steffenon": ("REDACTED_EMAIL", ""),
    "Samuel Huller": ("REDACTED_EMAIL", ""),
    "Amanda Quaresma": ("REDACTED_EMAIL", ""),
    "Rodrigo Hajj": ("REDACTED_EMAIL", ""),
    "Nathalia Galeazzi Nedel": ("REDACTED_EMAIL", ""),
}

DRAWS = {
    "powerball": [
        # Completed draw — 01/08/2026
        {
            "id": "2026-08-01",
            "gameType": "powerball",
            "drawing": {
                "name": "Powerball Jackpot",
                "jackpot": 707000000,
                "drawDateIso": "2026-08-01T22:59:00-04:00",
                "drawDateLabel": "01/08/2026 22:59 ET"
            },
            "result": {
                "numbers": [8, 30, 41, 48, 54],
                "special": 4,
                "multiplier": 2,
                "checkedAt": "04/08/2026 07:25 ET",
                "premiosGanhos": 16,
                "jackpotHit": False,
                "breakdown": ["Powerball ($8)", "Powerball ($8)"]
            },
            "winningTickets": [
                "03-24-29-57-66 — PB 04",
                "23-32-33-63-69 — PB 04"
            ]
        },
        # Next draw — 03/08/2026 (conditional: only play if 01/08 jackpot doesn't hit)
        {
            "id": "2026-08-03",
            "gameType": "powerball",
            "drawing": {
                "name": "Powerball Jackpot",
                "jackpot": 748000000,
                "drawDateIso": "2026-08-03T22:59:00-04:00",
                "drawDateLabel": "03/08/2026 22:59 ET"
            },
            "playNextIfAccumulates": True,  # Business rule: only play if 01/08 has no jackpot
            "result": None,  # Not yet drawn
            "winningTickets": []
        }
    ],
    "megamillions": [
        # Placeholder for future Mega Millions draws
    ]
}

def get_active_draw(gameType="powerball"):
    """Get the latest completed draw for the given game type."""
    draws = DRAWS.get(gameType, [])
    for draw in reversed(draws):
        if draw.get("result") and draw["result"].get("numbers"):
            return draw
    return None

def load_participants_from_data_js(draw_id):
    """
    Load participant list DIRECTLY from data.js for the given draw.
    This ensures only actual participants receive emails — no duplicates, no extras.
    """
    try:
        with open("bolao/loterias/powerball/js/data.js", "r", encoding="utf-8") as f:
            content = f.read()

        # Find the draw block that matches this ID
        draw_pattern = r'id:\s*["\']' + re.escape(draw_id) + r'["\'][^}]*?participants:\s*\[(.*?)\]'
        match = re.search(draw_pattern, content, re.DOTALL)

        if not match:
            return []

        participants_str = match.group(1)

        # Extract name from each participant entry
        name_pattern = r'{\s*name:\s*["\']([^"\']+)["\']'
        names = re.findall(name_pattern, participants_str)

        # Map names to emails, handling groups (like Tatiana via Gustavo)
        participants = []
        seen_emails = set()

        for name in names:
            if name not in PARTICIPANT_EMAILS:
                print(f"⚠ WARNING: {name} not in PARTICIPANT_EMAILS mapping")
                continue

            email, cc = PARTICIPANT_EMAILS[name]

            # Skip if email already in list (e.g., Tatiana via Gustavo)
            if email in seen_emails:
                continue

            seen_emails.add(email)
            participants.append({"name": name, "email": email, "cc": cc})

        return participants

    except Exception as e:
        print(f"❌ Error loading participants from data.js: {e}")
        return []

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


def validate_data(draw, participants=None):
    """Verify data consistency before any send."""
    if not draw:
        return ["❌ No completed draw found"]

    if not participants:
        participants = []

    errors = []

    if not draw.get("result", {}).get("numbers"):
        errors.append("❌ Result numbers not found")

    if not draw.get("winningTickets"):
        errors.append("⚠ No winning tickets marked")

    missing_emails = [p["name"] for p in participants if not p["email"]]
    if missing_emails:
        errors.append(f"❌ MISSING EMAILS: {', '.join(missing_emails)}")

    if draw.get("result", {}).get("premiosGanhos") == 0:
        errors.append("⚠ Prêmios ganhos = $0 (verify calculation)")

    return errors


def fmtUsd(n):
    if n is None or n == 0:
        return "$0"
    return f"${n:,.0f}" if n >= 1000 else f"${n}"


def build_html(draw):
    """Build result email in Portuguese (PT only)."""
    r = draw["result"]
    game_icon = "🔴" if draw["gameType"] == "powerball" else "🟡"
    game_label = "Powerball" if draw["gameType"] == "powerball" else "Mega Millions"

    nums_sorted = sorted(r["numbers"])
    special_label = "Powerball" if draw["gameType"] == "powerball" else "Mega Ball"
    result_line = f'{"-".join(str(n) for n in nums_sorted)}  ·  {special_label} {r["special"]}  ·  Power Play {r["multiplier"]}x'

    header_title = f"{game_icon} Loteria {game_label} — Resultado do Sorteio"
    header_date = draw["drawing"]["drawDateLabel"]
    intro_p1 = f"<p>O sorteio de <strong>{draw['drawing']['drawDateLabel']}</strong> foi finalizado. Confira o resultado oficial e seu resumo:</p>"
    result_label = "Resultado Oficial"
    winning_label = "Bilhetes Premiados"

    prize_section = f"""<div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 14px;margin:16px 0;font-size:13px;line-height:1.6">
      <strong style="color:#16a34a">Resumo dos Prêmios</strong><br>
      Total ganho: <strong>{fmtUsd(r["premiosGanhos"])}</strong><br>
      {f"Detalhes: {', '.join(r['breakdown'])}" if r.get("breakdown") else ""}
    </div>"""
    no_prize = "Sem prêmios neste sorteio · Boa sorte na próxima!"

    winning_tickets_html = ""
    if draw.get("winningTickets"):
        winning_tickets_html = "<ul>" + "".join(
            f'<li style="color:#16a34a;font-weight:bold">{t}</li>'
            for t in draw["winningTickets"]
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

{"" if not draw.get("winningTickets") else f'''<div style="background:white;border:1px solid #cbd5e1;border-radius:6px;padding:14px;margin:16px 0">
  <div style="font-size:11px;color:#666;text-transform:uppercase;margin-bottom:8px">{winning_label}</div>
  {winning_tickets_html}
</div>'''}

{prize_section if r["premiosGanhos"] > 0 else f'<p style="color:#666;font-style:italic">{no_prize}</p>'}

<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">

<p style="font-size:12px;color:#666">
  <a href="{SITE_URL}" style="color:#1a237e;font-weight:bold">Abrir página da loteria</a> para ver todos os detalhes, histórico de sorteios e suas cotas.
</p>

<p style="font-size:11px;color:#999;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px">
Ferrari Lotteries · {game_label}<br>
Resultado conferido: {r["checkedAt"]}
</p>

</div>
</body>
</html>"""


def send_email(addr, subject, html):
    """Send via EmailJS. Subject uses "." instead of "/" to avoid HTML escaping in EmailJS template."""
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
            "html_message": html,
        }
    }).encode()

    try:
        req = urllib.request.Request(EMAILJS_URL, data=body, headers=EMAILJS_HEADERS, method="POST")
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status == 200, f"HTTP {r.status}"
    except Exception as e:
        return False, str(e)


def run_test_send(gameType="powerball"):
    """Send preview to admin only — review before broadcast."""
    draw = get_active_draw(gameType)
    game_label = "Powerball" if gameType == "powerball" else "Mega Millions"

    print("\n" + "="*60)
    print(f"{game_label.upper()} RESULT EMAIL — PREVIEW TO ADMIN")
    print("="*60)

    if not draw:
        print("❌ No completed draw found for " + gameType)
        sys.exit(1)

    # Load ACTUAL participants from data.js
    participants = load_participants_from_data_js(draw["id"])

    errors = validate_data(draw, participants)
    if errors:
        print("\n⚠️  DATA ISSUES FOUND:\n")
        for err in errors:
            print(f"  {err}")
        print("\n⚠️  Review data in /bolao/loterias/powerball/js/data.js\n")

    print(f"\n📧 SENDING PREVIEW TO ADMIN: {ADMIN_EMAIL}")
    print(f"   Draw: {draw['drawing']['drawDateLabel']}")
    print(f"   Jackpot: ${draw['drawing']['jackpot']:,}")
    print()

    html = build_html(draw)
    subject = f"[TESTE] {game_label} — {draw['drawing']['drawDateLabel'].replace('/', '.')} — NÃO ENCAMINHAR"

    preview = f"""<div style="background:#fff3cd;border:2px solid #ffc107;padding:14px;border-radius:6px;margin-bottom:20px;font-weight:bold;color:#856404">
    ⚠️ TESTE — Este email foi enviado ao administrador para revisão antes de enviar para todos.
    Se você recebeu, é para REVISAR E APROVAR antes do envio real.
    </div>
    {html}
    """

    ok, msg = send_email(ADMIN_EMAIL, subject, preview)

    if ok:
        print(f"✓ Preview enviado com sucesso ({msg})")
        print(f"\n📋 Próximos passos:")
        print(f"   1. Confira seu email em {ADMIN_EMAIL}")
        print(f"   2. Revise o resultado, bilhetes premiados e cálculo de prêmios")
        print(f"   3. Se estiver correto, execute:")
        print(f"      python3 send_result_email.py --send-all {gameType}")
        print(f"   4. Se houver erros, corrija os dados e tente novamente\n")
    else:
        print(f"✗ Falha ao enviar preview: {msg}\n")
        sys.exit(1)


def run_send_all(gameType="powerball"):
    """Send to all participants."""
    draw = get_active_draw(gameType)
    game_label = "Powerball" if gameType == "powerball" else "Mega Millions"

    print("\n" + "="*60)
    print(f"{game_label.upper()} RESULT EMAIL — BROADCAST TO ALL PARTICIPANTS")
    print("="*60)

    if not draw:
        print("❌ No completed draw found for " + gameType)
        sys.exit(1)

    # Load ACTUAL participants from data.js — not hardcoded list
    recipients = load_participants_from_data_js(draw["id"])
    if not recipients:
        print(f"❌ No participants found in data.js for draw {draw['id']}\n")
        sys.exit(1)

    errors = validate_data(draw, recipients)
    if errors:
        print("\n❌ CANNOT SEND — DATA ISSUES FOUND:\n")
        for err in errors:
            print(f"  {err}")
        print("\nFix the issues above and run --test-send again.\n")
        sys.exit(1)

    print(f"\n📧 ENVIANDO PARA {len(recipients)} PARTICIPANTES:")
    print()

    html = build_html(draw)
    subject = f"⚽ Resultado {game_label} — {draw['drawing']['drawDateLabel'].replace('/', '.')}"

    sent, failed = 0, []
    for p in recipients:
        name, email = p["name"], p["email"]
        ok, msg = send_email(email, subject, html)
        status = "✓" if ok else "✗"
        print(f"  {status} {name:<30} {email}")

        if ok:
            sent += 1
            time.sleep(2)  # EmailJS rate limit
        else:
            failed.append((name, email, msg))

    print(f"\n{'='*60}")
    print(f"✓ {sent} enviados, {len(failed)} falharam")
    if failed:
        print(f"\nFalhas:")
        for name, email, msg in failed:
            print(f"  ✗ {name} ({email}): {msg}")
    print()


def run_check_data(gameType="powerball"):
    """Validate data before any send."""
    draw = get_active_draw(gameType)
    print(f"\nDATA VALIDATION ({gameType}):")
    errors = validate_data(draw)
    if errors:
        print("\n❌ Problemas encontrados:\n")
        for err in errors:
            print(f"  {err}")
    else:
        print("✓ Todos os dados estão OK")
    print()


def main():
    args = sys.argv[1:]

    # Extract gameType from args (default: powerball)
    gameType = "powerball"
    if len(args) > 1:
        gameType = args[1]
    if gameType not in DRAWS:
        print(f"❌ Unknown game type: {gameType}")
        print(f"Available: {', '.join(DRAWS.keys())}\n")
        sys.exit(1)

    if "--test-send" in args:
        run_test_send(gameType)
    elif "--send-all" in args:
        run_send_all(gameType)
    elif "--check-data" in args:
        run_check_data(gameType)
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
