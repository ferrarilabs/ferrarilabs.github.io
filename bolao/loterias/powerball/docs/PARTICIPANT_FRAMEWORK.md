# Participant Framework — State Tracking & Prize Calculations

## Overview

This document establishes the permanent framework for managing participants in the Powerball bolão, including state tracking for tax calculations and prize estimation.

## Participant Record Structure

Each participant must have the following fields:

```javascript
// js/data.js — PUBLIC (served directly to browsers). Since the P0.1 PII
// hotfix (2026-08), this file must NEVER contain email or txId.
{
  name: "Full Name",
  cotas: 1,                    // Number of shares (typically 1)
  valor: 10,                   // Amount contributed (US$)
  metodo: "Zelle",             // Payment method
  data: "04/08/2026",          // Payment date
  hora: "8:40 AM",             // Payment time
  status: "verificado",        // "organizador" or "verificado"
  state: "NC",                 // US STATE ABBREVIATION (REQUIRED)
}
```

Email and txId are PRIVATE and are never written to `js/data.js`. They live only
in the `POWERBALL_PRIVATE_PARTICIPANT_DATA` GitHub secret (consumed as an env var
by CI) and, for local/manual runs, in a gitignored sidecar file
(`scripts/private-participant-data.local.json`), keyed by draw id → participant
name → `{ email, txId }`. See `scripts/add-participant.js` / `scripts/add_participants.py`,
which write both files automatically when adding a participant.

## Adding New Participants

**IMPORTANT:** When adding a new participant to any draw, you MUST collect:

1. **Full Name** — exact spelling
2. **Email Address** — required for communication
3. **US State** — 2-letter abbreviation (NC, FL, CA, etc.)
4. **Payment Amount** — in US$
5. **Payment Method** — Zelle, Cash App, Venmo, etc.
6. **Transaction ID** — confirmation ID from payment provider
7. **Date & Time** — payment timestamp

### Checklist for New Participants

```
☐ Verify email address (contact them if needed)
☐ Confirm US state (no Brazil; all USA-based)
☐ Record payment method
☐ Record transaction ID
☐ Record date/time of payment
☐ Add to data.js with all fields
☐ Add to Supabase (SQL INSERT or via script)
```

## Prize Calculation Framework

### Tax Rates by State

Tax calculations use federal + state rates:

- **Federal Tax (Large Prizes)**: 37%
- **State Taxes**:
  - **NC (North Carolina)**: 3.99%
  - **FL (Florida)**: 0% (no state income tax)
  - **TX (Texas)**: 0% (no state income tax)
  - **Other States**: Look up current rate; update this doc

**Total Effective Tax Rates:**
- NC residents: 37% + 3.99% = **40.99%**
- FL residents: 37% + 0% = **37%**
- TX residents: 37% + 0% = **37%**

### Prize Display Formula

For any Powerball jackpot:

```
1. Lump Sum Available = Jackpot × 0.505 (approximately 50.5%)
2. Share Per Participant = Lump Sum ÷ Total Cotas
3. Federal Tax = Share × 0.37
4. State Tax = Share × (state_rate)
5. Total Tax = Federal Tax + State Tax
6. Net Amount = Share - Total Tax
```

### Example Calculation (05/08/2026 Draw)

- Jackpot: $800,000,000
- Lump Sum: $800M × 0.505 = $404,000,000
- Cotas: 14 participants × 1 cota = 14 total
- Per Participant (Gross): $404M ÷ 14 = $28,857,142.86

**For NC Resident:**
- Federal Tax: $28,857,142.86 × 0.37 = $10,677,142.86
- NC State Tax: $28,857,142.86 × 0.0399 = $1,151,570.00
- Total Tax: $11,828,712.86
- **Net: $17,028,430.00**

**For FL Resident:**
- Federal Tax: $28,857,142.86 × 0.37 = $10,677,142.86
- FL State Tax: $28,857,142.86 × 0.00 = $0
- Total Tax: $10,677,142.86
- **Net: $18,180,000.00**

## Disclaimer Display

Every participants table MUST include this disclaimer:

> ⚠️ **Aviso:** Os valores de prêmio abaixo são meramente ilustrativos baseados no jackpot atual. Impostos federais e estaduais variam conforme a situação fiscal individual de cada participante. Este site não se responsabiliza por informações incorretas ou omissões. Consulte um consultor fiscal para cálculos precisos.

## Supabase Integration

### Users Table Schema

```sql
CREATE TABLE public.users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(20),
  state VARCHAR(2),  -- US state abbreviation
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Adding Participant to Supabase

1. **Via SQL (Direct):**
   ```sql
   INSERT INTO public.users (name, email, state)
   VALUES ('New Person', 'email@example.com', 'NC');
   ```

2. **Via Python Script:**
   ```bash
   python3 bolao/loterias/powerball/scripts/add_participant_to_supabase.py \
     --name "New Person" \
     --email "email@example.com" \
     --state "NC" \
     --draw "2026-08-05"
   ```

## Implementation Checklist

When adding a new participant:

- [ ] Collect all required fields (name, email, state, payment info)
- [ ] Add to `data.js` with `state` and `email` fields
- [ ] Update financial totals (`totalArrecadado`, `valorGuardadoProximoSorteio`)
- [ ] Run syntax check: `node --check bolao/loterias/powerball/js/app.js`
- [ ] Add to Supabase via SQL or script
- [ ] Verify table displays correctly with prize columns
- [ ] Test responsive layout on mobile
- [ ] Commit with clear message including participant name and state

## State-Specific Handling

### North Carolina (NC)
- Tax Rate: 40.99%
- Default for most participants unless otherwise specified

### Florida (FL)
- Tax Rate: 37% (no state income tax)
- Used for Florida residents (e.g., Jorge Augusto Junqueira Ferreira, Alan Rech)

### Texas (TX)
- Tax Rate: 37% (no state income tax)
- Used for Texas residents (e.g., Thiago Locatelli)

### Other States
- Research current income tax rate
- Add to this table
- Update Supabase schema if different calculation needed

## FAQ

**Q: Why do we need state information?**
A: State income tax varies; some states have no tax, others have high rates. This affects final winnings significantly. For full transparency, participants need accurate estimates.

**Q: Can I add someone without a state?**
A: No. All participants must be US-based (non-Brazilian). You MUST have a state for tax calculations.

**Q: What if someone is in a state not listed?**
A: Look up the current state income tax rate, add it to this framework document, update the calculation code, and mention it in your commit message.

**Q: What if someone doesn't have an email?**
A: Contact them and get one. Email is required for prize notifications and future draw communications.

**Q: What's the difference between Supabase state and data.js state?**
A: They should be identical. `data.js` is the frontend display (frontend-only, cacheable). `Supabase` is the backend source of truth (persistent, used by scripts). Always update both.

## Related Documents

- `SUPABASE_FINAL_SETUP.md` — Supabase schema and setup instructions
- `AUDIT_LOGGING.md` — How to audit participant data changes
- `../js/app.js` → `calculatePrizePerParticipant()` function

## Version

- **v1.0** — 2026-08-05
- Initial framework with NC/FL tax rates and participant data structure
