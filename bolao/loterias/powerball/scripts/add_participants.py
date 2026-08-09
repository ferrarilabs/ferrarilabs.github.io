#!/usr/bin/env python3
"""
Injetar novos participantes na próxima rodada do Powerball pool

Uso:
  python3 add_participants.py --draw-id 2026-08-05 --csv new_participants.csv
  python3 add_participants.py --draw-id 2026-08-05 --name "John Doe" --email "john@example.com" --tx-id "EXAMPLE-TXID-0001"

CSV Format (txId column optional, but see warning below if omitted):
  name,email,txId
  John Doe,john@example.com,EXAMPLE-TXID-0001
  Jane Smith,jane@example.com,

txId (Zelle/Venmo/Cash App transaction number, or equivalent) is part of the
full audit trail for real money — every real payment must carry one. It's
not required by this script because some participants genuinely have none
(self-funded/carried balance, "Saldo anterior" — the default `metodo`
below), but omitting it for anyone who actually paid is a bug, not a
shortcut; the script warns loudly when it's missing.
"""

import json
import sys
import re
import csv
from datetime import datetime
from pathlib import Path
import argparse

def load_data():
    """Load data.js content"""
    data_path = Path(__file__).parent.parent / "js" / "data.js"
    if not data_path.exists():
        print(f"❌ Error: {data_path} not found")
        sys.exit(1)

    with open(data_path, 'r', encoding='utf-8') as f:
        return f.read()

def extract_draw(data_content, draw_id):
    """Extract draw object from data.js"""
    # Find the draw with matching ID
    pattern = rf'id:\s*["\']?{re.escape(draw_id)}["\']?'
    if not re.search(pattern, data_content):
        print(f"❌ Error: Draw {draw_id} not found in data.js")
        sys.exit(1)

    return draw_id

def add_participants_to_file(data_content, draw_id, participants):
    """Add participants to the draw in data.js"""

    # Check for duplicates
    existing_names = re.findall(r'name:\s*["\']([^"\']+)["\']', data_content)
    duplicates = [p['name'] for p in participants if p['name'] in existing_names]

    if duplicates:
        print(f"❌ Error: {len(duplicates)} participant(s) already exist:")
        for name in duplicates:
            print(f"   - {name}")
        sys.exit(1)

    # Validate emails
    invalid = [p for p in participants if '@' not in p['email']]
    if invalid:
        print(f"⚠️  Warning: {len(invalid)} participant(s) have invalid emails:")
        for p in invalid:
            print(f"   - {p['name']}: {p['email']}")
        sys.exit(1)

    # Build participant entries. data.js is PUBLIC (served directly to browsers on
    # GitHub Pages) — it must never carry email or txId (P0.1 PII hotfix, 2026-08).
    today = datetime.now().strftime("%d/%m/%Y")
    entries = []

    for p in participants:
        entry = f'''      {{ name: "{p['name']}", cotas: null, valor: null, metodo: "Saldo anterior", data: "{today}", hora: "—", status: "recorrente" }}'''
        entries.append(entry)

    # Find the participants array for this draw and insert before closing bracket
    # Pattern: id: "2026-08-05", ... participants: [ ... ],
    pattern = rf'(id:\s*["\']?{re.escape(draw_id)}["\']?.*?participants:\s*\[(.*?)\])'

    def replace_func(match):
        before = match.group(1)
        participants_content = match.group(2)
        # Check if array is empty or has entries
        if participants_content.strip().endswith(']'):
            # Array is closing immediately, insert content
            new_content = before + ',\n' + ',\n'.join(entries) + '\n    ]'
        else:
            # Array has content, append to it
            new_content = before + ',\n' + ',\n'.join(entries) + match.group(1)[len(before)-1:]
        return new_content

    updated = re.sub(pattern, replace_func, data_content, flags=re.DOTALL)

    if updated == data_content:
        # Fallback: simpler pattern matching
        pattern = rf'(id:\s*["\']?{re.escape(draw_id)}["\']?.*?participants:\s*\[(.*?)\s*\](?=\s*,\s*sharedTickets))'

        def replace_func2(match):
            before_part = match.group(1)
            participants_part = match.group(2)
            # Add new participants
            if participants_part.strip():
                new_content = before_part + ',\n' + ',\n'.join(entries) + '\n    ]'
            else:
                new_content = before_part + '\n' + ',\n'.join(entries) + '\n    ]'
            return new_content

        updated = re.sub(pattern, replace_func2, data_content, flags=re.DOTALL)

    if updated == data_content:
        print("❌ Error: Could not locate participants array in draw")
        sys.exit(1)

    return updated

def main():
    parser = argparse.ArgumentParser(description='Add participants to Powerball pool draw')
    parser.add_argument('--draw-id', required=True, help='Draw ID (e.g., 2026-08-05)')
    parser.add_argument('--csv', help='CSV file with participant data (name,email)')
    parser.add_argument('--name', help='Participant name')
    parser.add_argument('--email', help='Participant email')
    parser.add_argument('--tx-id', dest='tx_id', help='Transaction number (Zelle/Venmo/Cash App) — part of the audit trail')

    args = parser.parse_args()

    participants = []

    # Load from CSV
    if args.csv:
        csv_path = Path(args.csv)
        if not csv_path.exists():
            print(f"❌ Error: CSV file not found: {args.csv}")
            sys.exit(1)

        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get('name') and row.get('email'):
                    participants.append({
                        'name': row['name'].strip(),
                        'email': row['email'].strip(),
                        'txId': row['txId'].strip() if row.get('txId') else None
                    })

    # Load from command line
    elif args.name and args.email:
        participants.append({
            'name': args.name,
            'email': args.email,
            'txId': args.tx_id or None
        })

    else:
        print("❌ Error: Either --csv or (--name AND --email) required")
        parser.print_help()
        sys.exit(1)

    if not participants:
        print("❌ Error: No participants found to add")
        sys.exit(1)

    # Load and update data
    data_content = load_data()
    extract_draw(data_content, args.draw_id)
    updated_content = add_participants_to_file(data_content, args.draw_id, participants)

    # Write back (public file — no email/txId)
    data_path = Path(__file__).parent.parent / "js" / "data.js"
    with open(data_path, 'w', encoding='utf-8') as f:
        f.write(updated_content)

    # Write private sidecar (local only — .gitignore'd, never committed)
    sidecar_path = Path(__file__).parent / "private-participant-data.local.json"
    sidecar = {}
    if sidecar_path.exists():
        try:
            with open(sidecar_path, 'r', encoding='utf-8') as f:
                sidecar = json.load(f)
        except Exception:
            sidecar = {}
    sidecar.setdefault(args.draw_id, {})
    for p in participants:
        sidecar[args.draw_id][p['name']] = {"email": p['email'], "txId": p.get('txId') or "—"}
    with open(sidecar_path, 'w', encoding='utf-8') as f:
        json.dump(sidecar, f, ensure_ascii=False, indent=2)

    # Report
    print(f"✅ Added {len(participants)} participant(s) to draw {args.draw_id} (public data.js — no email/txId):")
    for p in participants:
        print(f"   ✓ {p['name']}")

    missing_tx_id = [p for p in participants if not p.get('txId')]
    if missing_tx_id:
        print(f"\n⚠️  {len(missing_tx_id)} participant(s) saved with NO transaction ID — this breaks the audit trail for real money:")
        for p in missing_tx_id:
            print(f"   - {p['name']}")
        print(f"   If they actually paid (Zelle/Venmo/Cash App), re-run with --tx-id (or a txId CSV column) and fix the sidecar entry.")
        print(f"   Only skip this for participants with no real payment yet (e.g. \"Saldo anterior\"/self-funded).")

    print(f"\n⚠️  Emails were written ONLY to {sidecar_path} (local, gitignored, NOT committed).")
    print(f"   Merge this file's contents into the GitHub secret manually:")
    print(f"   gh secret set POWERBALL_PRIVATE_PARTICIPANT_DATA --repo ferrarilabs/ferrarilabs.github.io < <(merge this file with the current secret)")

    print(f"\n📝 Next steps:")
    print(f"   1. Verify: head -50 js/data.js | tail -20")
    print(f"   2. Audit: python3 ../scripts/audit_scoring.py")
    print(f"   3. Update the GitHub secret with the new email(s) — see above.")
    print(f"   4. Delete or keep-local {sidecar_path.name} — never git add it.")
    print(f"   5. Commit: git add js/data.js && git commit -m \"Add {len(participants)} participant(s)\"")

if __name__ == '__main__':
    main()
