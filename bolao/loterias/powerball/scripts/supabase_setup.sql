-- ═══════════════════════════════════════════════════════════════════════════════
-- Supabase Tables Setup for Bolão Platform
-- Run these queries in Supabase SQL Editor to set up the user management system
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. USERS table — centralized user directory
CREATE TABLE IF NOT EXISTS public.users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(20),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_name ON public.users(name);

-- 2. BOLAO_TYPES table — list of all bolão games
CREATE TABLE IF NOT EXISTS public.bolao_types (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert standard bolão types
INSERT INTO public.bolao_types (code, name, description) VALUES
  ('copa2026', 'Copa do Mundo 2026', 'Bracket pool - 2026 World Cup (archived)'),
  ('br2026', 'Brasileirão 2026', 'G4/Z4 classification picks'),
  ('cdb2026', 'Copa do Brasil 2026', 'Knockout round picks'),
  ('powerball', 'Powerball', 'US Powerball lottery'),
  ('megamillions', 'Mega Millions', 'US Mega Millions lottery')
ON CONFLICT (code) DO NOTHING;

-- 3. USER_BOLAO_PARTICIPATION table — tracks who plays in each bolão
CREATE TABLE IF NOT EXISTS public.user_bolao_participation (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  bolao_type_id BIGINT NOT NULL REFERENCES public.bolao_types(id) ON DELETE CASCADE,
  bolao_draw_id VARCHAR(50),  -- e.g., "2026-08-01" for Powerball, "main" for Copa
  shares SMALLINT DEFAULT 1,
  status VARCHAR(50) DEFAULT 'active',  -- active, inactive, refunded
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, bolao_type_id, bolao_draw_id)
);

CREATE INDEX IF NOT EXISTS idx_participation_user ON public.user_bolao_participation(user_id);
CREATE INDEX IF NOT EXISTS idx_participation_bolao ON public.user_bolao_participation(bolao_type_id);
CREATE INDEX IF NOT EXISTS idx_participation_draw ON public.user_bolao_participation(bolao_draw_id);

-- 4. Enable RLS (Row Level Security)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bolao_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_bolao_participation ENABLE ROW LEVEL SECURITY;

-- 5. Create RLS policies (allow anon to read, no writes from frontend)
CREATE POLICY "Allow read users" ON public.users
  FOR SELECT USING (true);

CREATE POLICY "Allow read bolao_types" ON public.bolao_types
  FOR SELECT USING (true);

CREATE POLICY "Allow read participation" ON public.user_bolao_participation
  FOR SELECT USING (true);

-- 6. AUDIT_LOG table — complete audit trail of all operations
CREATE TABLE IF NOT EXISTS public.audit_log (
  id BIGSERIAL PRIMARY KEY,
  action VARCHAR(50) NOT NULL,  -- 'email_sent', 'data_updated', 'draw_created', etc.
  entity_type VARCHAR(50),      -- 'user', 'draw', 'participation', 'email', etc.
  entity_id VARCHAR(255),       -- user id, draw id, email address, etc.
  performed_by VARCHAR(255),    -- script name, admin name, user name
  details JSONB,                -- structured data about what changed
  status VARCHAR(20),           -- 'success', 'failed', 'pending'
  error_message TEXT,           -- if status = 'failed'
  ip_address INET,              -- source IP (if applicable)
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_action ON public.audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON public.audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_status ON public.audit_log(status);

-- 7. EMAIL_LOG table — detailed email sending log
CREATE TABLE IF NOT EXISTS public.email_log (
  id BIGSERIAL PRIMARY KEY,
  recipient_email VARCHAR(255) NOT NULL,
  recipient_name VARCHAR(255),
  subject VARCHAR(500),
  bolao_type VARCHAR(50),
  draw_id VARCHAR(50),
  template_used VARCHAR(100),
  status VARCHAR(20),           -- 'sent', 'failed', 'bounced', 'opened', etc.
  emailjs_status_code INT,      -- HTTP status from EmailJS
  emailjs_message_id VARCHAR(255),
  error_reason TEXT,
  sent_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB                -- additional tracking data
);

CREATE INDEX IF NOT EXISTS idx_email_recipient ON public.email_log(recipient_email);
CREATE INDEX IF NOT EXISTS idx_email_draw ON public.email_log(draw_id);
CREATE INDEX IF NOT EXISTS idx_email_status ON public.email_log(status);
CREATE INDEX IF NOT EXISTS idx_email_sent_at ON public.email_log(sent_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Enable RLS on audit tables
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

-- Read-only policies for audit tables (anon can read, no writes from frontend)
CREATE POLICY "Allow read audit_log" ON public.audit_log
  FOR SELECT USING (true);

CREATE POLICY "Allow read email_log" ON public.email_log
  FOR SELECT USING (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Sample Data for Powerball 2026-08-01 Draw
-- ═══════════════════════════════════════════════════════════════════════════════

-- Insert users (only if they don't exist)
INSERT INTO public.users (name, email) VALUES
  ('Eduardo Ferrari', 'emferrari@gmail.com'),
  ('Gustavo Bossle', 'REDACTED_EMAIL'),
  ('Tatiana Bossle', 'tatiana.bossle@example.com'),  -- separate email if exists
  ('Marcelo Moreira', 'REDACTED_EMAIL'),
  ('Leandro Augustineli', 'REDACTED_EMAIL'),
  ('Alan Rech', 'REDACTED_EMAIL'),
  ('Ewerton Gruba Silva', 'REDACTED_EMAIL'),
  ('Simone Hirle da Costa', 'REDACTED_EMAIL'),
  ('Camila Ribeiro', 'REDACTED_EMAIL'),
  ('Marcus Steffenon', 'REDACTED_EMAIL'),
  ('Samuel Huller', 'REDACTED_EMAIL'),
  ('Amanda Quaresma', 'REDACTED_EMAIL'),
  ('Rodrigo Hajj', 'REDACTED_EMAIL'),
  ('Nathalia Galeazzi Nedel', 'REDACTED_EMAIL')
ON CONFLICT (email) DO NOTHING;

-- Add participation records for Powerball draw 2026-08-01
WITH powerball_type AS (
  SELECT id FROM public.bolao_types WHERE code = 'powerball'
),
users_list AS (
  SELECT id, name FROM public.users
  WHERE name IN (
    'Eduardo Ferrari', 'Gustavo Bossle', 'Tatiana Bossle', 'Marcelo Moreira',
    'Leandro Augustineli', 'Alan Rech', 'Ewerton Gruba Silva', 'Simone Hirle da Costa',
    'Camila Ribeiro', 'Marcus Steffenon', 'Samuel Huller', 'Amanda Quaresma',
    'Rodrigo Hajj', 'Nathalia Galeazzi Nedel'
  )
)
INSERT INTO public.user_bolao_participation (user_id, bolao_type_id, bolao_draw_id, shares)
SELECT ul.id, pt.id, '2026-08-01', 1
FROM users_list ul, powerball_type pt
ON CONFLICT (user_id, bolao_type_id, bolao_draw_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Useful Queries for Python Scripts
-- ═══════════════════════════════════════════════════════════════════════════════

-- Get all users participating in a specific draw:
-- SELECT u.id, u.name, u.email
-- FROM public.users u
-- JOIN public.user_bolao_participation p ON u.id = p.user_id
-- JOIN public.bolao_types b ON p.bolao_type_id = b.id
-- WHERE b.code = 'powerball' AND p.bolao_draw_id = '2026-08-01';

-- Get a user's email by name:
-- SELECT email FROM public.users WHERE name = 'Alan Rech';

-- Get all active bolão types:
-- SELECT * FROM public.bolao_types WHERE code IN ('powerball', 'megamillions');
