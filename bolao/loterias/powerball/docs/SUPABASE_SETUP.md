# Supabase Setup — Powerball User Management

## Overview

This document explains how to set up Supabase for centralized user and participation management across all bolão platforms (Copa 2026, Brasileirão 2026, Copa do Brasil 2026, Powerball, Mega Millions).

**Key Benefits:**
- Centralized user directory (single source of truth for emails)
- No hardcoded participant lists in scripts
- Easy to update emails without touching code
- Shared user database across all bolões
- Eliminates cross-bolão email contamination

## Current Setup

- **Supabase Project:** `cmhqkkfczotdnssupkni`
- **URL:** `https://cmhqkkfczotdnssupkni.supabase.co`
- **Anon Key:** Already configured in scripts

## Tables

### 1. `users`
Central user directory for all participants across all bolões.

```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(20),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**When to use:** Any time you need to get a participant's email by name.

### 2. `bolao_types`
List of all bolão games across the platform.

```sql
CREATE TABLE bolao_types (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,  -- 'powerball', 'copa2026', etc.
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Current types:**
- `powerball` → Powerball
- `megamillions` → Mega Millions
- `copa2026` → Copa do Mundo 2026 (archived)
- `br2026` → Brasileirão 2026
- `cdb2026` → Copa do Brasil 2026

### 3. `user_bolao_participation`
Tracks who participates in which bolão draws.

```sql
CREATE TABLE user_bolao_participation (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  bolao_type_id BIGINT NOT NULL,
  bolao_draw_id VARCHAR(50),  -- draw identifier (e.g., "2026-08-01")
  shares SMALLINT DEFAULT 1,
  status VARCHAR(50) DEFAULT 'active',
  joined_at TIMESTAMP DEFAULT NOW()
);
```

## Setup Instructions

### Step 1: Run SQL Setup

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Log in and select project `cmhqkkfczotdnssupkni`
3. Navigate to **SQL Editor**
4. Copy and run the entire script from:
   ```
   bolao/loterias/powerball/scripts/supabase_setup.sql
   ```

This will create all three tables, indexes, RLS policies, and insert sample data.

### Step 2: Verify Tables

In Supabase SQL Editor, run:

```sql
-- Check users table
SELECT COUNT(*) as user_count FROM public.users;

-- Check participation records
SELECT COUNT(*) as participation_count FROM public.user_bolao_participation;

-- List all Powerball participants
SELECT u.name, u.email
FROM public.users u
JOIN public.user_bolao_participation p ON u.id = p.user_id
JOIN public.bolao_types b ON p.bolao_type_id = b.id
WHERE b.code = 'powerball' AND p.bolao_draw_id = '2026-08-01'
ORDER BY u.name;
```

### Step 3: Update User Emails (if needed)

If a user's email changes, update it directly in Supabase (no code changes needed):

```sql
UPDATE public.users 
SET email = 'newemail@example.com'
WHERE name = 'Alan Rech';
```

### Step 4: Add New Draws

When a new draw is created, add participation records:

```sql
WITH powerball_type AS (
  SELECT id FROM public.bolao_types WHERE code = 'powerball'
),
users_list AS (
  SELECT id FROM public.users 
  WHERE name IN ('Eduardo Ferrari', 'Alan Rech', ...)
)
INSERT INTO public.user_bolao_participation (user_id, bolao_type_id, bolao_draw_id, shares)
SELECT ul.id, pt.id, '2026-08-10', 1
FROM users_list ul, powerball_type pt;
```

## Python Integration

The email sending scripts automatically:

1. **Try Supabase first** — queries `user_bolao_participation` for the specific draw
2. **Fall back to data.js** if Supabase is unavailable
3. **Apply email overrides** for household groups (e.g., Tatiana via Gustavo)

### Example: Send Email to All Participants

```bash
python3 bolao/loterias/powerball/scripts/send_result_email.py --send-all powerball
```

This automatically:
- Loads participants from Supabase for that draw
- Falls back to data.js if offline
- Sends to the correct email addresses
- Skips duplicates from household groups

## Troubleshooting

### Error: "Supabase unavailable"
- Check internet connection
- Verify Supabase project is running
- Check `SUPABASE_URL` and `SUPABASE_ANON_KEY` in script
- Script will fall back to data.js automatically

### Email not found
If a user's email isn't in Supabase:
1. Add to `users` table: `INSERT INTO public.users (name, email) VALUES (...)`
2. Add participation record: `INSERT INTO public.user_bolao_participation (...)`

### Same user appears twice
- This shouldn't happen with Supabase (enforced UNIQUE constraints)
- If it does, check for duplicate entries: `SELECT name, COUNT(*) FROM users GROUP BY name HAVING COUNT(*) > 1;`

## Future Enhancements

- [ ] Admin panel to manage users/emails without SQL
- [ ] Auto-sync user changes from all three bolão apps
- [ ] Audit log for email/participation changes
- [ ] Bulk import/export for new seasons
- [ ] Integration with payment processing (Zelle, Venmo, Cash App)

## References

- Supabase Docs: https://supabase.com/docs
- RLS (Row Level Security): https://supabase.com/docs/learn/auth-deep-dive/auth-policies
- API Reference: https://supabase.com/docs/guides/api
