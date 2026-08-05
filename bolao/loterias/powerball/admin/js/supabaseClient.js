// Powerball Admin — Supabase client bootstrap.
// STATUS: validado estaticamente (reviewed/written), NÃO EXECUTADO — no reachable Supabase
// project/credentials in this environment. See docs/bolao/loterias/POWERBALL_ADMIN_TEST_PLAN.md.
//
// Hard rule enforced here: auth session storage is sessionStorage ONLY, never localStorage,
// and no operational data (participants/payments/tickets/etc.) is ever cached here — every
// admin screen re-reads from Supabase on load per the "no client cache beyond render" rule.

// TODO(operator): fill in the Powerball admin project's URL + anon key before use. This must
// remain the anon key only — never the service_role key — per the platform's hard rule.
const POWERBALL_SUPABASE_URL = window.POWERBALL_SUPABASE_URL || "";
const POWERBALL_SUPABASE_ANON_KEY = window.POWERBALL_SUPABASE_ANON_KEY || "";

let _client = null;

function getSupabaseClient() {
  if (_client) return _client;
  if (!window.supabase || !window.supabase.createClient) {
    throw new Error("Supabase JS SDK not loaded — check script tag in admin/index.html");
  }
  if (!POWERBALL_SUPABASE_URL || !POWERBALL_SUPABASE_ANON_KEY) {
    throw new Error("Powerball Supabase URL/anon key not configured — see supabaseClient.js TODO");
  }
  _client = window.supabase.createClient(POWERBALL_SUPABASE_URL, POWERBALL_SUPABASE_ANON_KEY, {
    auth: {
      // Hard rule: auth session lives in sessionStorage only, never localStorage, never
      // persisted across browser restarts. This is the ONLY permitted use of sessionStorage
      // in this admin app.
      storage: window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return _client;
}

window.PowerballAdmin = window.PowerballAdmin || {};
window.PowerballAdmin.getSupabaseClient = getSupabaseClient;
