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

import json, sys, time, urllib.request, re, logging
from datetime import datetime
from pathlib import Path

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

# ── Logging Setup ────────────────────────────────────────────────────────────
LOG_DIR = Path(__file__).parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / f"send_result_email_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)-8s | %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

logger.info("="*80)
logger.info("POWERBALL EMAIL SCRIPT STARTED")
logger.info("="*80)

# ── Supabase Config ──────────────────────────────────────────────────────────
SUPABASE_URL = "https://cmhqkkfczotdnssupkni.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtaHFra2ZjemF0ZG5zc3Vwa25pIiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODQyNjI0MzcsImV4cCI6MTk5OTgzODQzN30.sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5"

# ── Email routing overrides (for family/household groups) ──────────────────────
# When a user should receive email at a different address (e.g., Tatiana via Gustavo)
PARTICIPANT_EMAIL_OVERRIDES = {
    "Tatiana Bossle": "REDACTED_EMAIL",  # Sent via Gustavo per data.js
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

def load_participants_from_supabase(draw_id):
    """
    Load participant list from Supabase for the given draw.
    Centralizes user management — single source of truth for emails.
    Falls back to data.js if Supabase is unavailable.
    """
    logger.info(f"Loading participants from Supabase for draw {draw_id}")
    try:
        # Query: get all users participating in this powerball draw
        url = (
            f"{SUPABASE_URL}/rest/v1/user_bolao_participation?"
            f"select=users(id,name,email)&"
            f"bolao_type_id=in.(SELECT id FROM bolao_types WHERE code='powerball')&"
            f"bolao_draw_id=eq.{draw_id}&"
            f"status=eq.active"
        )
        req = urllib.request.Request(
            url,
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                "Content-Type": "application/json"
            }
        )

        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())

        participants = []
        seen_emails = set()

        for record in data:
            if not record.get("users"):
                continue

            user = record["users"]
            name = user.get("name", "")
            email = user.get("email", "")

            if not name or not email:
                continue

            # Apply email overrides (e.g., Tatiana via Gustavo)
            if name in PARTICIPANT_EMAIL_OVERRIDES:
                email = PARTICIPANT_EMAIL_OVERRIDES[name]

            # Skip if email already added (avoid duplicates from household groups)
            if email in seen_emails:
                continue

            seen_emails.add(email)
            participants.append({"name": name, "email": email})

        logger.info(f"✓ Loaded {len(participants)} participants from Supabase for draw {draw_id}")
        audit_log("participants_loaded", "draw", draw_id, "success", {"source": "supabase", "count": len(participants)})
        return participants

    except Exception as e:
        logger.warning(f"⚠ Supabase unavailable: {e}")
        logger.info(f"  Falling back to data.js...")
        return load_participants_from_data_js(draw_id)


def load_participants_from_data_js(draw_id):
    """
    Fallback: Load participant list from data.js if Supabase is unavailable.
    """
    logger.info(f"Loading participants from data.js fallback for draw {draw_id}")
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

        participants = []
        seen_emails = set()

        for name in names:
            # Try Supabase email first, fallback to hardcoded if needed
            email = None

            # Quick lookup from Supabase users table
            try:
                url = f"{SUPABASE_URL}/rest/v1/users?name=eq.{name}&select=email"
                req = urllib.request.Request(
                    url,
                    headers={
                        "apikey": SUPABASE_ANON_KEY,
                        "Authorization": f"Bearer {SUPABASE_ANON_KEY}"
                    }
                )
                with urllib.request.urlopen(req, timeout=5) as r:
                    data = json.loads(r.read())
                    if data and len(data) > 0:
                        email = data[0].get("email")
            except:
                pass  # Fall through to override

            # Apply email overrides if no Supabase match
            if not email and name in PARTICIPANT_EMAIL_OVERRIDES:
                email = PARTICIPANT_EMAIL_OVERRIDES[name]

            if not email:
                print(f"⚠ WARNING: {name} email not found")
                continue

            # Skip if email already in list
            if email in seen_emails:
                continue

            seen_emails.add(email)
            participants.append({"name": name, "email": email})

        logger.info(f"✓ Loaded {len(participants)} participants from data.js for draw {draw_id}")
        audit_log("participants_loaded", "draw", draw_id, "success", {"source": "data.js", "count": len(participants)})
        return participants

    except Exception as e:
        logger.error(f"❌ Error loading participants from data.js: {e}")
        audit_log("participants_load_failed", "draw", draw_id, "failed", {"source": "data.js"}, error_msg=str(e))
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


def audit_log(action, entity_type, entity_id, status, details=None, error_msg=None):
    """Log action to Supabase audit_log table."""
    try:
        payload = json.dumps({
            "action": action,
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "performed_by": "send_result_email.py",
            "status": status,
            "details": details or {},
            "error_message": error_msg
        }).encode()

        url = f"{SUPABASE_URL}/rest/v1/audit_log"
        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            },
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=5) as r:
            logger.debug(f"✓ Audited: {action} → {entity_type} {entity_id}")
    except Exception as e:
        logger.warning(f"⚠ Audit log failed (continuing): {e}")


def log_email_sent(recipient_email, recipient_name, subject, draw_id, status, details=None, error_msg=None):
    """Log email send to Supabase email_log table."""
    try:
        payload = json.dumps({
            "recipient_email": recipient_email,
            "recipient_name": recipient_name,
            "subject": subject,
            "bolao_type": "powerball",
            "draw_id": draw_id,
            "status": status,
            "error_reason": error_msg,
            "metadata": details or {}
        }).encode()

        url = f"{SUPABASE_URL}/rest/v1/email_log"
        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            },
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=5) as r:
            logger.info(f"📧 Logged email to {recipient_email}: {status}")
    except Exception as e:
        logger.warning(f"⚠ Email log failed (continuing): {e}")


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


def send_email(addr, subject, html, recipient_name="", draw_id=""):
    """Send via EmailJS. Subject uses "." instead of "/" to avoid HTML escaping in EmailJS template."""
    addr = addr.strip()

    logger.info(f"📤 Sending email to {addr} [{recipient_name}]")

    if not addr or "@" not in addr:
        error = f"Invalid email: {addr}"
        logger.error(f"❌ {error}")
        log_email_sent(addr, recipient_name, subject, draw_id, "failed", error_msg=error)
        return False, error

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
            status_code = r.status
            if status_code == 200:
                logger.info(f"✅ Email sent successfully to {addr}")
                log_email_sent(addr, recipient_name, subject, draw_id, "sent", details={"http_status": status_code})
                audit_log("email_sent", "email", addr, "success", {"recipient": recipient_name, "draw_id": draw_id})
                return True, f"HTTP {status_code}"
            else:
                error = f"HTTP {status_code}"
                logger.warning(f"⚠ Email failed with {error}")
                log_email_sent(addr, recipient_name, subject, draw_id, "failed", details={"http_status": status_code}, error_msg=error)
                return False, error
    except Exception as e:
        error = str(e)
        logger.error(f"❌ Exception sending to {addr}: {error}")
        log_email_sent(addr, recipient_name, subject, draw_id, "failed", error_msg=error)
        audit_log("email_failed", "email", addr, "failed", {"recipient": recipient_name, "error": error}, error_msg=error)
        return False, error


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

    # Load ACTUAL participants from Supabase (with data.js fallback)
    participants = load_participants_from_supabase(draw["id"])

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

    ok, msg = send_email(ADMIN_EMAIL, subject, preview, recipient_name="Admin (Preview)", draw_id=draw["id"])

    if ok:
        logger.info(f"✓ Preview enviado com sucesso para {ADMIN_EMAIL}")
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

    # Load ACTUAL participants from Supabase (with data.js fallback)
    recipients = load_participants_from_supabase(draw["id"])
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

    logger.info(f"Starting broadcast to {len(recipients)} participants for draw {draw['id']}")
    audit_log("broadcast_started", "draw", draw['id'], "success", {"total_recipients": len(recipients)})

    sent, failed = 0, []
    for p in recipients:
        name, email = p["name"], p["email"]
        ok, msg = send_email(email, subject, html, recipient_name=name, draw_id=draw['id'])
        status = "✓" if ok else "✗"
        print(f"  {status} {name:<30} {email}")

        if ok:
            sent += 1
            time.sleep(2)  # EmailJS rate limit
        else:
            failed.append((name, email, msg))
            logger.warning(f"Email failed for {name} ({email}): {msg}")

    print(f"\n{'='*60}")
    logger.info(f"Broadcast completed: {sent} sent, {len(failed)} failed")
    audit_log("broadcast_completed", "draw", draw['id'], "success" if len(failed) == 0 else "partial", {
        "sent": sent,
        "failed": len(failed),
        "total": len(recipients)
    })
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

    try:
        if "--test-send" in args:
            run_test_send(gameType)
        elif "--send-all" in args:
            run_send_all(gameType)
        elif "--check-data" in args:
            run_check_data(gameType)
        else:
            print(__doc__)
            sys.exit(1)
    finally:
        logger.info("="*80)
        logger.info(f"SCRIPT COMPLETED | Logs saved to: {LOG_FILE}")
        logger.info("="*80)
        print(f"\n📋 Logs: {LOG_FILE}")


if __name__ == "__main__":
    main()
