#!/usr/bin/env node
// Powerball Admin — RLS/RPC negative test suite.
//
// STATUS: proposto, mas não executado (NÃO EXECUTADO). This file is real, runnable test code
// against a real Supabase project — it is NOT a placeholder or pseudocode. It has never been
// run in this session because there is no reachable Supabase project (local or remote test)
// in this sandbox: `docker` is not installed here, so `npx supabase start` cannot bring up a
// local Postgres/GoTrue/PostgREST stack, and no remote test-project credentials were provided.
// See docs/bolao/loterias/POWERBALL_ADMIN_TEST_PLAN.md and
// docs/bolao/loterias/POWERBALL_ADMIN_OPERATIONS.md ("Runbook — validating this branch against
// a real Supabase project") for exact steps to run this for real.
//
// Run with: SUPABASE_URL=... SUPABASE_ANON_KEY=... TEST_AUDITOR_EMAIL=... TEST_AUDITOR_PASSWORD=...
//           node tests/rls_negative_test.mjs

const URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
}

async function main() {
  if (!URL || !ANON_KEY) {
    console.error("SKIPPED (NÃO EXECUTADO): SUPABASE_URL/SUPABASE_ANON_KEY not set — no reachable Supabase project in this environment (this sandbox also has no Docker, so `npx supabase start` for a local instance is not possible either). This is real, runnable test code; it has genuinely never been executed. See POWERBALL_ADMIN_OPERATIONS.md for the runbook to execute it for real.");
    process.exit(2); // distinct exit code: skipped, not passed, not failed
  }

  // Deferred import: only pull in @supabase/supabase-js once we know we have credentials to
  // actually use it, so the honest SKIPPED path above works even in environments (like this
  // sandbox) where the package isn't installed at all.
  const { createClient } = await import("@supabase/supabase-js");
  const anon = createClient(URL, ANON_KEY);

  // 1. Anonymous cannot write to any operational table.
  {
    const { error } = await anon.from("lottery_participants").insert({ display_name: "Should Fail" });
    assert(error, "anon insert into lottery_participants must be rejected by RLS");
  }

  // 2. Anonymous cannot read participant PII (email/phone) via direct select.
  {
    const { data, error } = await anon.from("lottery_participants").select("*");
    assert(error || (data && data.length === 0), "anon select on lottery_participants must return no rows / an error");
  }

  // 3. Anonymous cannot call an admin RPC.
  {
    const { error } = await anon.rpc("admin_create_participant", {
      p_display_name: "Should Fail", p_email: null, p_phone: null,
      p_reason: "attempted anon RPC call", p_request_id: crypto.randomUUID(),
    });
    assert(error, "anon RPC call to admin_create_participant must be rejected");
  }

  // 4. Authenticated user with no lottery_admin_roles row is blocked from admin data.
  //    (Requires TEST_ROLELESS_EMAIL/PASSWORD for a real signed-up user with zero roles.)
  if (process.env.TEST_ROLELESS_EMAIL) {
    const rolelessClient = createClient(URL, ANON_KEY);
    const { error: signInError } = await rolelessClient.auth.signInWithPassword({
      email: process.env.TEST_ROLELESS_EMAIL, password: process.env.TEST_ROLELESS_PASSWORD,
    });
    assert(!signInError, "roleless test user must be able to sign in: " + (signInError && signInError.message));
    const { data, error } = await rolelessClient.from("lottery_participants").select("*");
    assert(error || (data && data.length === 0), "roleless authenticated user must not read admin data");
  } else {
    console.error("SKIPPED sub-test 4 (NÃO EXECUTADO): TEST_ROLELESS_EMAIL not set.");
  }

  // 5. Auditor role can read but cannot write, and cannot call any admin_* RPC.
  if (process.env.TEST_AUDITOR_EMAIL) {
    const auditorClient = createClient(URL, ANON_KEY);
    const { error: signInError } = await auditorClient.auth.signInWithPassword({
      email: process.env.TEST_AUDITOR_EMAIL, password: process.env.TEST_AUDITOR_PASSWORD,
    });
    assert(!signInError, "auditor test user must be able to sign in");
    const { error: readErr } = await auditorClient.from("lottery_participants").select("*");
    assert(!readErr, "auditor must be able to read lottery_participants");
    const { error: rpcErr } = await auditorClient.rpc("admin_create_participant", {
      p_display_name: "Should Fail", p_email: null, p_phone: null,
      p_reason: "auditor attempted write", p_request_id: crypto.randomUUID(),
    });
    assert(rpcErr, "auditor must not be able to call admin_create_participant");
  } else {
    console.error("SKIPPED sub-test 5 (NÃO EXECUTADO): TEST_AUDITOR_EMAIL not set.");
  }

  // 6. Admin IS authorized, but only through the RPC — never via a raw table write, even
  //    though they pass the role check (proves the RPC boundary, not just the role check).
  if (process.env.TEST_ADMIN_EMAIL) {
    const adminClient = createClient(URL, ANON_KEY);
    await adminClient.auth.signInWithPassword({
      email: process.env.TEST_ADMIN_EMAIL, password: process.env.TEST_ADMIN_PASSWORD,
    });
    const { error: rawWriteErr } = await adminClient.from("lottery_participants").insert({ display_name: "Direct Write Attempt" });
    assert(rawWriteErr, "even an authorized admin must not be able to write via a raw table INSERT — RLS has no write policy for any role, RPC is the only path");
    const { error: rpcErr } = await adminClient.rpc("admin_create_participant", {
      p_display_name: "Participante Alfa", p_email: "participante.alfa@example.invalid", p_phone: null,
      p_reason: "fixture created by rls_negative_test.mjs", p_request_id: crypto.randomUUID(),
    });
    assert(!rpcErr, "admin RPC call should succeed: " + (rpcErr && rpcErr.message));
  } else {
    console.error("SKIPPED sub-test 6 (NÃO EXECUTADO): TEST_ADMIN_EMAIL not set.");
  }

  // 7. Audit log is append-only: even an owner cannot UPDATE or DELETE a row directly.
  if (process.env.TEST_OWNER_EMAIL) {
    const ownerClient = createClient(URL, ANON_KEY);
    await ownerClient.auth.signInWithPassword({
      email: process.env.TEST_OWNER_EMAIL, password: process.env.TEST_OWNER_PASSWORD,
    });
    const { data: rows } = await ownerClient.from("lottery_admin_audit").select("audit_id").limit(1);
    if (rows && rows[0]) {
      const { error: updErr } = await ownerClient.from("lottery_admin_audit").update({ reason: "tampered" }).eq("audit_id", rows[0].audit_id);
      assert(updErr, "UPDATE on lottery_admin_audit must be blocked by the trigger, even for owner");
      const { error: delErr } = await ownerClient.from("lottery_admin_audit").delete().eq("audit_id", rows[0].audit_id);
      assert(delErr, "DELETE on lottery_admin_audit must be blocked by the trigger, even for owner");
    }
  } else {
    console.error("SKIPPED sub-test 7 (NÃO EXECUTADO): TEST_OWNER_EMAIL not set.");
  }

  // 8. Anonymous cannot call any of the newer RPCs (payments/draws/tickets/results/
  //    publications/emails) either — covers the RPCs added after the original participant/
  //    payment pass, so the negative-test surface tracks the full RPC set in
  //    migrations/003_rpcs.sql + 004_rpcs_draws_tickets_publications_results_emails.sql.
  {
    const anonRpcCalls = [
      ["admin_record_payment", { p_participation_id: crypto.randomUUID(), p_type: "contribution", p_amount: 10, p_external_reference: null, p_proof_object_path: null, p_reason: "attempted anon RPC call", p_request_id: crypto.randomUUID() }],
      ["admin_create_draw", { p_pool_id: crypto.randomUUID(), p_draw_date: "2026-12-25", p_jackpot_estimate: null, p_cash_value_estimate: null, p_reason: "attempted anon RPC call", p_request_id: crypto.randomUUID() }],
      ["admin_create_ticket", { p_draw_id: crypto.randomUUID(), p_numbers: [1, 2, 3, 4, 5], p_powerball: 1, p_power_play: false, p_reason: "attempted anon RPC call", p_request_id: crypto.randomUUID() }],
      ["admin_record_result", { p_draw_id: crypto.randomUUID(), p_numbers: [1, 2, 3, 4, 5], p_powerball: 1, p_jackpot_amount: null, p_reason: "attempted anon RPC call", p_request_id: crypto.randomUUID() }],
      ["admin_publish_tickets", { p_draw_id: crypto.randomUUID(), p_ticket_ids: [], p_manifest: {}, p_financial_snapshot: {}, p_participant_snapshot: {}, p_reason: "attempted anon RPC call", p_confirmation_text: "CONFIRMAR", p_request_id: crypto.randomUUID() }],
      ["admin_enqueue_email", { p_job_type: "admin_test", p_entity_type: null, p_entity_id: null, p_recipient_email: "attempted-anon@example.invalid", p_reason: "attempted anon RPC call", p_request_id: crypto.randomUUID() }],
    ];
    for (const [fnName, args] of anonRpcCalls) {
      const { error } = await anon.rpc(fnName, args);
      assert(error, `anon RPC call to ${fnName} must be rejected`);
    }
  }

  // 9. Auditor cannot call any write RPC either — re-check with a representative sample from
  //    the newer RPC set, not just admin_create_participant as in sub-test 5.
  if (process.env.TEST_AUDITOR_EMAIL) {
    const auditorClient = createClient(URL, ANON_KEY);
    await auditorClient.auth.signInWithPassword({
      email: process.env.TEST_AUDITOR_EMAIL, password: process.env.TEST_AUDITOR_PASSWORD,
    });
    const { error: paymentErr } = await auditorClient.rpc("admin_record_payment", {
      p_participation_id: crypto.randomUUID(), p_type: "contribution", p_amount: 10,
      p_external_reference: null, p_proof_object_path: null,
      p_reason: "auditor attempted write", p_request_id: crypto.randomUUID(),
    });
    assert(paymentErr, "auditor must not be able to call admin_record_payment");
    const { error: publishErr } = await auditorClient.rpc("admin_publish_tickets", {
      p_draw_id: crypto.randomUUID(), p_ticket_ids: [], p_manifest: {}, p_financial_snapshot: {},
      p_participant_snapshot: {}, p_reason: "auditor attempted write",
      p_confirmation_text: "CONFIRMAR", p_request_id: crypto.randomUUID(),
    });
    assert(publishErr, "auditor must not be able to call admin_publish_tickets (a critical action) either");
  } else {
    console.error("SKIPPED sub-test 9 (NÃO EXECUTADO): TEST_AUDITOR_EMAIL not set.");
  }

  console.log("PASS: all executable RLS/RPC negative-test assertions held.");
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
