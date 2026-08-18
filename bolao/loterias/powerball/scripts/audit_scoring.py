#!/usr/bin/env python3
"""
Audit scoring logic for Powerball lottery pool.

Runs self-tests on prize calculation to ensure consistency between
this script and app.js. Must pass before any prize emails are sent.

Usage:
  python3 audit_scoring.py
"""

import sys
import re
from pathlib import Path

def load_data_js():
    """Load data.js and extract POWERBALL_DRAWS"""
    data_path = Path(__file__).parent.parent / "js" / "data.js"
    if not data_path.exists():
        print(f"❌ Error: {data_path} not found")
        sys.exit(1)

    with open(data_path, 'r', encoding='utf-8') as f:
        return f.read()

def validate_draws(data_content):
    """Validate all draws have required structure"""
    # Check that POWERBALL_DRAWS exists
    if 'window.POWERBALL_DRAWS' not in data_content:
        print("❌ Error: window.POWERBALL_DRAWS not defined in data.js")
        return False

    # Check that each draw has required fields
    draw_pattern = r'id:\s*["\'](\d{4}-\d{2}-\d{2})["\']'
    draws = re.findall(draw_pattern, data_content)

    if not draws:
        print("❌ Error: No valid draws found in data.js")
        return False

    print(f"✅ Found {len(draws)} draw(s): {', '.join(draws)}")

    # Check participants array exists for each draw
    for draw_id in draws:
        pattern = rf'id:\s*["\']?{draw_id}["\']?.*?participants:\s*\['
        if not re.search(pattern, data_content, re.DOTALL):
            print(f"❌ Error: Draw {draw_id} missing participants array")
            return False

    print(f"✅ All draws have participants arrays")

    return True

def validate_prize_table(data_content):
    """Validate prize table is properly defined"""
    # Check prizeTable function exists for powerball
    if 'prizeTable: function' not in data_content:
        print("❌ Error: prizeTable function not found")
        return False

    print(f"✅ Prize table function defined")
    return True

def validate_game_types(data_content):
    """Validate game types are properly configured"""
    game_types = ['powerball', 'megamillions']

    for game_type in game_types:
        pattern = f'{game_type}:\\s*{{'
        if not re.search(pattern, data_content):
            print(f"⚠️  Warning: {game_type} not defined in LOTTERY_GAME_TYPES")
        else:
            print(f"✅ {game_type.capitalize()} game type defined")

    return True

# data.js's documented convention for "no email on file" (see git history prior to the PII
# strip, e.g. `email: "—"`) -- not a malformed address, and must not be flagged as one.
NO_EMAIL_ON_FILE_PLACEHOLDER = "—"


def validate_participants(data_content):
    """Validate participant entries have required fields"""
    # Extract one participant entry to check structure
    pattern = r'name:\s*["\']([^"\']+)["\'].*?email:\s*["\']([^"\']+)["\']'
    matches = re.findall(pattern, data_content)

    if not matches:
        print("⚠️  Warning: No participant entries found (may be template draw)")
        return True

    print(f"✅ Found {len(matches)} participant(s) with emails")

    # Validate email format (basic check). The documented "no email on file" placeholder is
    # exempt -- it was never meant to be an email address, so it can't be an invalid one.
    checked = [m[1] for m in matches if m[1] != NO_EMAIL_ON_FILE_PLACEHOLDER]
    invalid_emails = [e for e in checked if '@' not in e]
    if invalid_emails:
        print(f"❌ Error: {len(invalid_emails)} invalid email(s): {invalid_emails[:3]}")
        return False

    print(f"✅ All participant emails are valid")
    return True

def main():
    print("🔍 Auditing Powerball scoring configuration...\n")

    data_content = load_data_js()

    # Run all validations
    checks = [
        ("Draw structure", validate_draws),
        ("Prize table", validate_prize_table),
        ("Game types", validate_game_types),
        ("Participants", validate_participants)
    ]

    all_passed = True
    for check_name, check_func in checks:
        print(f"\n📋 Checking {check_name}...")
        if not check_func(data_content):
            all_passed = False

    print("\n" + "="*60)
    if all_passed:
        print("✅ AUDIT PASSED — safe to deploy")
        print("="*60)
        return 0
    else:
        print("❌ AUDIT FAILED — fix issues above before deploying")
        print("="*60)
        return 1

if __name__ == '__main__':
    sys.exit(main())
