/**
 * notification_fixtures.mjs — shared synthetic fixtures for NotificationRepository tests and
 * the Supabase test-execution runbook (docs/bolao/FOOTBALL_HARDENING_SUPABASE_TEST_COMMANDS.md).
 * Fictional pool/team/participant names only — never real data, safe to reference from a real
 * (test-only) Supabase project without any privacy concern.
 */
export const FIXTURE_POOL_ID = "test-pool";

export const FIXTURE_EVENT = Object.freeze({
  poolId: FIXTURE_POOL_ID,
  entityType: "match",
  entityId: "time-alfa-vs-time-beta",
  eventType: "final_confirmed",
  eventVersion: 1,
  payloadSnapshot: { homeTeam: "Time Alfa", awayTeam: "Time Beta", homeScore: 2, awayScore: 1 },
});

export const FIXTURE_RECIPIENTS = Object.freeze([
  "participante-alfa@example.test",
  "participante-beta@example.test",
  "participante-nome-muito-longo-da-silva-oliveira@example.test",
]);

export function fixtureJobDrafts(poolId = FIXTURE_POOL_ID, entityId = FIXTURE_EVENT.entityId, eventVersion = 1) {
  return FIXTURE_RECIPIENTS.map((recipient) => ({
    poolId, recipient, payloadSnapshot: FIXTURE_EVENT.payloadSnapshot,
    idempotencyKey: `${poolId}:${entityId}:${recipient}:v${eventVersion}`,
  }));
}

// The mandatory CDB2026 aggregate/penalty scenario, reusable as a notification-payload fixture
// too (same Time Alfa/Time Beta convention as bolao/cdb2026/scripts/test_penalty_fields.mjs).
export const FIXTURE_PENALTY_SCENARIO_PAYLOAD = Object.freeze({
  homeTeam: "Time Alfa", awayTeam: "Time Beta",
  aggregate: { teamA: 1, teamB: 1 },
  penalties: { teamA: 5, teamB: 4 },
  advancingTeamId: "A",
});
