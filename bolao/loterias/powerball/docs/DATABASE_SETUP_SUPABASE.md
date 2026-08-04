# Supabase Setup — Powerball Lottery Pool

Complete SQL schema and RLS policies for secure storage of sensitive data (participants, payments, audit logs).

**Golden rule:** No sensitive data in localStorage or public data.js. Only in Supabase with RLS protection.

## Quick Start

1. Create Supabase project at https://supabase.com
2. Run SQL setup (see Tables section below)
3. Enable RLS on all tables
4. Add anon key to `config.js`
5. Set up RLS policies (see Policy section)

## Tables

### `public.powerball_draws` — Draw metadata (public, immutable)

```sql
CREATE TABLE public.powerball_draws (
  id TEXT PRIMARY KEY,
  game_type TEXT NOT NULL,
  drawing_name TEXT NOT NULL,
  jackpot BIGINT,
  draw_date_iso TIMESTAMP WITH TIME ZONE,
  draw_date_label TEXT,
  ticket_serial_count INT,
  total_tickets INT,
  total_cost BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.powerball_draws DISABLE ROW LEVEL SECURITY;
```

### `public.powerball_participants` — Sensitive participant data

```sql
CREATE TABLE public.powerball_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  draw_id TEXT NOT NULL REFERENCES public.powerball_draws(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  cotas INT,
  valor BIGINT,
  metodo TEXT,
  data TEXT,
  hora TEXT,
  tx_id TEXT,
  status TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_powerball_participants_draw_id ON public.powerball_participants(draw_id);
CREATE INDEX idx_powerball_participants_email ON public.powerball_participants(email);

ALTER TABLE public.powerball_participants ENABLE ROW LEVEL SECURITY;

-- Admin can see all; participant sees only themselves (by email)
CREATE POLICY "admin_select" ON public.powerball_participants
  FOR SELECT USING (auth.jwt() ->> 'is_admin' = 'true');

CREATE POLICY "self_select" ON public.powerball_participants
  FOR SELECT USING (email = auth.jwt() ->> 'email');
```

### `public.powerball_audit_log` — Complete audit trail (immutable)

```sql
CREATE TABLE public.powerball_audit_log (
  id BIGSERIAL PRIMARY KEY,
  draw_id TEXT REFERENCES public.powerball_draws(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor TEXT,
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_powerball_audit_draw ON public.powerball_audit_log(draw_id);
CREATE INDEX idx_powerball_audit_action ON public.powerball_audit_log(action);
CREATE INDEX idx_powerball_audit_created ON public.powerball_audit_log(created_at DESC);

ALTER TABLE public.powerball_audit_log ENABLE ROW LEVEL SECURITY;

-- Admin reads all; everyone can insert (system logs)
CREATE POLICY "admin_select" ON public.powerball_audit_log
  FOR SELECT USING (auth.jwt() ->> 'is_admin' = 'true');

CREATE POLICY "system_insert" ON public.powerball_audit_log
  FOR INSERT WITH CHECK (true);
```

## Security Notes

- **Admin password:** Never stored in Supabase. SHA-256 hash in `config.js`, client-side verification only.
- **RLS enforcement:** Server-side, cannot be bypassed from client
- **Audit log:** Immutable (INSERT only, no UPDATE/DELETE)
- **Anon key only:** Service role key never in client code
- **Session security:** 30-minute timeout, cleared on tab close

## Next Steps

1. Implement admin functions in app.js
2. Populate tables from current data.js
3. Test RLS policies
4. Enable audit logging on all actions
