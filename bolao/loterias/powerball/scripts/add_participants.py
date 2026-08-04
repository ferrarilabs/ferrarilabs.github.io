#!/usr/bin/env python3
"""
Injetar novos participantes na próxima rodada do Powerball pool

Uso:
  python3 add_participants.py --draw-id 2026-08-05 --csv new_participants.csv
  python3 add_participants.py --draw-id 2026-08-05 --name "John Doe" --email "john@example.com"

CSV Format:
  name,email
  John Doe,john@example.com
  Jane Smith,jane@example.com
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

    # Build participant entries
    today = datetime.now().strftime("%d/%m/%Y")
    entries = []

    for p in participants:
        entry = f'''      {{ name: "{p['name']}", email: "{p['email']}", cotas: null, valor: null, metodo: "Saldo anterior", data: "{today}", hora: "—", txId: "—", status: "recorrente" }}'''
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
                        'email': row['email'].strip()
                    })

    # Load from command line
    elif args.name and args.email:
        participants.append({
            'name': args.name,
            'email': args.email
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

    # Write back
    data_path = Path(__file__).parent.parent / "js" / "data.js"
    with open(data_path, 'w', encoding='utf-8') as f:
        f.write(updated_content)

    # Report
    print(f"✅ Added {len(participants)} participant(s) to draw {args.draw_id}:")
    for p in participants:
        print(f"   ✓ {p['name']} ({p['email']})")

    print(f"\n📝 Next steps:")
    print(f"   1. Verify: grep -A 20 'id: \"{args.draw_id}\"' js/data.js | grep name:")
    print(f"   2. Audit: python3 ../scripts/audit_scoring.py")
    print(f"   3. Commit: git add js/data.js && git commit -m \"Add {len(participants)} participant(s)\"")

if __name__ == '__main__':
    main()
