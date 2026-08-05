// Powerball Admin — auth gate and logout.
// STATUS: validado estaticamente, NÃO EXECUTADO (no reachable Supabase project here).
//
// No frontend-typed email/role, no hardcoded password/hash. Authorization is entirely
// server-side: auth.uid() + lottery_admin_roles + RLS + the SECURITY DEFINER RPCs re-check
// role internally. This file only decides what to *render* based on session presence — it
// never grants access on its own.

(function () {
  "use strict";

  async function getSession() {
    const supabase = window.PowerballAdmin.getSupabaseClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function signIn(email, password) {
    const supabase = window.PowerballAdmin.getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session;
  }

  async function signOut() {
    const supabase = window.PowerballAdmin.getSupabaseClient();
    await supabase.auth.signOut();
    // Hard rule: logout must end the session, clear auth sessionStorage, clear in-memory
    // state, and redirect to login. No operational data should exist in the browser at this
    // point since screens never cache beyond render — but sessionStorage is cleared
    // explicitly anyway as defense in depth against any stray key.
    try {
      window.sessionStorage.clear();
    } catch (_e) {
      // sessionStorage unavailable (e.g. private mode edge case) — nothing to clear, safe to
      // continue since there is no operational data cached client-side regardless.
    }
    window.PowerballAdmin.state = null;
    window.location.href = "./index.html";
  }

  window.PowerballAdmin = window.PowerballAdmin || {};
  window.PowerballAdmin.auth = { getSession, signIn, signOut };
})();
