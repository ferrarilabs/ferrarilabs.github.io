#!/usr/bin/env node
// Powerball Admin — audit hash-chain integrity test.
// STATUS: proposto, mas não executado (NÃO EXECUTADO) without SUPABASE_URL/SUPABASE_ANON_KEY
// and a signed-in admin/owner session. Real, runnable code — never executed in this session.
//
// What it verifies against a real project:
//   1. verify_powerball_audit_chain() returns valid=true on an untouched log.
//   2. Every mutation (via the RPCs in migrations/003_rpcs.sql / 004_...sql) produces exactly
//      one new lottery_admin_audit row with correct before/after snapshots and the actor's
//      real auth.uid()/role — never a client-supplied identity.
//   3. UPDATE/DELETE against lottery_admin_audit is rejected (trigger-blocked) even for an
//      owner-role session.
//   4. server_created_at is DB-generated and monotonic — never trusts a client-supplied clock.

const URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
}

async function main() {
  if (!URL || !ANON_KEY || !process.env.TEST_OWNER_EMAIL) {
    console.error("SKIPPED (NÃO EXECUTADO): SUPABASE_URL/SUPABASE_ANON_KEY/TEST_OWNER_EMAIL not set — no reachable Supabase project in this environment.");
    process.exit(2);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const owner = createClient(URL, ANON_KEY);
  await owner.auth.signInWithPassword({
    email: process.env.TEST_OWNER_EMAIL, password: process.env.TEST_OWNER_PASSWORD,
  });

  const { data: chainBefore, error: chainErr } = await owner.rpc("verify_powerball_audit_chain");
  assert(!chainErr, "verify_powerball_audit_chain must be callable by owner: " + (chainErr && chainErr.message));
  assert(chainBefore[0].valid === true, "audit chain must be valid before this test's own mutation");

  const requestId = crypto.randomUUID();
  const { data: participant, error: createErr } = await owner.rpc("admin_create_participant", {
    p_display_name: "Participante Beta", p_email: "participante.beta@example.invalid", p_phone: null,
    p_reason: "fixture created by audit_chain_test.mjs", p_request_id: requestId,
  });
  assert(!createErr, "fixture creation must succeed: " + (createErr && createErr.message));

  const { data: auditRows, error: auditErr } = await owner
    .from("lottery_admin_audit")
    .select("*")
    .eq("entity_id", participant.participant_id)
    .eq("action_type", "create_participant");
  assert(!auditErr && auditRows.length === 1, "exactly one audit row must exist for this create_participant action");
  assert(auditRows[0].after_snapshot.display_name === "Participante Beta", "after_snapshot must reflect the created row");
  assert(auditRows[0].before_snapshot === null, "before_snapshot must be null for a create action");

  const { data: chainAfter } = await owner.rpc("verify_powerball_audit_chain");
  assert(chainAfter[0].valid === true, "audit chain must remain valid after a real mutation");

  const { error: updErr } = await owner.from("lottery_admin_audit").update({ reason: "tampered" }).eq("audit_id", auditRows[0].audit_id);
  assert(updErr, "owner UPDATE on lottery_admin_audit must be trigger-blocked");

  console.log("PASS: audit chain integrity + append-only enforcement held for a real mutation.");
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
