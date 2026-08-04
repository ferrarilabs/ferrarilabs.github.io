# Powerball Pool Scripts

## Add Participants (Python)

### Quick Start

```bash
# Add single participant
python3 add_participants.py --draw-id 2026-08-05 --name "John Doe" --email "john@example.com"

# Add multiple from CSV
python3 add_participants.py --draw-id 2026-08-05 --csv new_participants.csv
```

### CSV Format

Copy `new_participants_template.csv` and fill with new participants:

```csv
name,email
John Doe,john@example.com
Jane Smith,jane@example.com
```

### What It Does

✅ Validates emails (must contain @)
✅ Checks for duplicates (won't add existing names)
✅ Sets status to "recorrente" (recurring)
✅ Uses current date for data field
✅ Automatically sets: cotas=null, valor=null, metodo="Saldo anterior"

### Next Steps After Adding

```bash
# 1. Verify the changes
head -50 js/data.js | tail -20

# 2. Run audit (MUST PASS before commit)
python3 ../scripts/audit_scoring.py

# 3. Commit
git add js/data.js
git commit -m "Add [N] new participant(s) to draw 2026-08-05"
```

## Monitor Results

After `add_participants.py` runs, look for:

```
✅ Added 2 participant(s) to draw 2026-08-05:
   ✓ John Doe (john@example.com)
   ✓ Jane Smith (jane@example.com)
```

## Troubleshooting

### "Draw 2026-08-05 not found"
- Check draw ID matches exactly
- Ensure the draw is already defined in `js/data.js`

### "already exist"
- Participant name matches an existing entry
- Check `js/data.js` for existing participants

### "invalid emails"
- Email missing @ symbol
- Check CSV for typos

## Future Enhancement

Can be extended to:
- Fetch Gmail automatically (Gmail API integration)
- Parse Venmo/Chase emails for amounts
- Auto-generate CSV from email data
- Update financial summary when amounts received

For now: export from Gmail → paste into CSV → run script.

## Command Reference

```bash
# See help
python3 add_participants.py --help

# Single participant (no CSV needed)
python3 add_participants.py --draw-id 2026-08-05 --name "Alice" --email "alice@example.com"

# Batch from CSV (recommended for multiple)
python3 add_participants.py --draw-id 2026-08-05 --csv participants.csv

# Check current participants in a draw
grep -A 50 "id: \"2026-08-05\"" ../js/data.js | grep "name:"
```
