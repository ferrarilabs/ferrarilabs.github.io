#!/usr/bin/env python3
"""
fetch_and_send_results.py — Powerball automatic result fetcher and email sender
Fetches official results from NY Open Data API, updates data.js, and sends emails.

Usage:
  python3 fetch_and_send_results.py                    # check all draws, send if new result
  python3 fetch_and_send_results.py --dry-run          # preview without sending email
  python3 fetch_and_send_results.py --force-resend     # resend last email even if already sent
"""

import json, sys, time, urllib.request, re
from datetime import datetime, timedelta
import subprocess

POWERBALL_API = "https://data.ny.gov/resource/d6yy-54nr.json"
MEGAMILLIONS_API = "https://data.ny.gov/resource/5xaw-6ayf.json"

# Maps gameType to its API URL and parsing function
GAME_TYPES = {
    "powerball": {
        "api": POWERBALL_API,
        "parse": lambda row: {
            "numbers": sorted(list(map(int, row["winning_numbers"].strip().split()[:5]))),
            "special": int(row["winning_numbers"].strip().split()[5]),
            "multiplier": int(row.get("multiplier", 1))
        }
    },
    "megamillions": {
        "api": MEGAMILLIONS_API,
        "parse": lambda row: {
            "numbers": sorted(list(map(int, row["winning_numbers"].strip().split()[:5]))),
            "special": int(row.get("mega_ball", 1)),
            "multiplier": int(row.get("multiplier", 1))
        }
    }
}

def fetch_official_result(game_type):
    """Fetch latest result from official API."""
    if game_type not in GAME_TYPES:
        print(f"❌ Unknown game type: {game_type}")
        return None

    config = GAME_TYPES[game_type]
    try:
        url = f"{config['api']}?$order=draw_date DESC&$limit=1"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
            if not data:
                return None
            return config["parse"](data[0])
    except Exception as e:
        print(f"❌ API error: {e}")
        return None

def load_data_js():
    """Load data.js content."""
    with open("bolao/loterias/powerball/js/data.js", "r", encoding="utf-8") as f:
        return f.read()

def parse_draws(content):
    """Extract POWERBALL_DRAWS from data.js."""
    match = re.search(r'window\.POWERBALL_DRAWS\s*=\s*(\[[\s\S]*?\]\s*);', content)
    if not match:
        return None

    draws_str = match.group(1)
    # Convert JS to valid JSON
    draws_str = draws_str.replace("True", "true").replace("False", "false")

    try:
        return json.loads(draws_str)
    except json.JSONDecodeError:
        return None

def get_last_incomplete_draw(draws):
    """Get the last draw that doesn't have a completed result yet."""
    for draw in reversed(draws):
        if draw.get("result") is None or draw["result"].get("numbers") is None:
            return draw
    return None

def check_and_update_results(game_type, dry_run=False, force_resend=False):
    """Check API for new results and update data.js if found."""
    print(f"\n🔍 Checking {game_type.upper()} for new results...\n")

    # Fetch official result
    official = fetch_official_result(game_type)
    if not official:
        print(f"ℹ️  No result available from API yet")
        return False

    print(f"✓ Official result: {official['numbers']} | Special {official['special']} (Multiplier {official['multiplier']}x)")

    # Load and parse data.js
    content = load_data_js()
    draws = parse_draws(content)
    if not draws:
        print("❌ Could not parse POWERBALL_DRAWS from data.js")
        return False

    # Find the draw that needs a result
    target_draw = get_last_incomplete_draw(draws)
    if not target_draw:
        print("ℹ️  All draws already have results")
        return False

    print(f"📋 Found incomplete draw: {target_draw['id']}")

    # Check if official result matches the target draw's date
    # For now, assume the latest API result is for the incomplete draw

    if target_draw.get("result") and target_draw["result"].get("numbers"):
        print(f"ℹ️  Draw {target_draw['id']} already has a result")
        if not force_resend:
            return False

    print(f"\n✏️  Updating draw {target_draw['id']} with official result...")

    # Update the draw with official result
    # Note: profit and premiosGanhos will be calculated by send_result_email.py
    target_draw["result"] = {
        "numbers": official["numbers"],
        "special": official["special"],
        "multiplier": official["multiplier"],
        "checkedAt": datetime.now().strftime("%d/%m/%Y %H:%M ET"),
        "premiosGanhos": 0,  # Will be calculated by email script
        "jackpotHit": False,
        "breakdown": []
    }

    if dry_run:
        print("🏜️  DRY RUN — Not saving changes")
        return True

    # Update data.js
    updated_content = re.sub(
        r'window\.POWERBALL_DRAWS\s*=\s*\[[\s\S]*?\];',
        f'window.POWERBALL_DRAWS = {json.dumps(draws, indent=2)};',
        content
    )

    with open("bolao/loterias/powerball/js/data.js", "w", encoding="utf-8") as f:
        f.write(updated_content)

    print(f"✓ Updated data.js with new result")

    # Commit the change
    try:
        subprocess.run(["git", "add", "bolao/loterias/powerball/js/data.js"], check=True)
        subprocess.run([
            "git", "commit", "-m",
            f"Auto: Add Powerball result {target_draw['id']} ({official['numbers']} | PB{official['special']})"
        ], check=True)
        subprocess.run(["git", "push"], check=True)
        print(f"✓ Committed and pushed data.js")
    except subprocess.CalledProcessError as e:
        print(f"⚠️  Git operation failed: {e}")
        # Continue anyway — send email even if commit failed

    return True

def main():
    dry_run = "--dry-run" in sys.argv
    force_resend = "--force-resend" in sys.argv
    game_type = "powerball"  # Default to powerball for now

    # Check for new results and update if needed
    if check_and_update_results(game_type, dry_run=dry_run, force_resend=force_resend):
        # If result was updated, send email
        if not dry_run:
            print(f"\n📧 Sending result emails...\n")
            subprocess.run([
                "python3",
                "bolao/loterias/powerball/scripts/send_result_email.py",
                "--send-all",
                game_type
            ])
    else:
        if not dry_run:
            print(f"✓ No new results to process")

if __name__ == "__main__":
    main()
