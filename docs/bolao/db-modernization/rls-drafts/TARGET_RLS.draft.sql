-- NOT FOR PRODUCTION APPLY
-- TARGET RLS REVIEW DRAFT
-- REQUIRES RESTORE REHEARSAL + EXPLICIT OPERATOR AUTHORIZATION
--
-- GENERATED FILE — do not edit by hand. Source: model/rls_model.json
-- Regenerate: node scripts/db/rls.mjs --write
--
-- This file is outside every active migration path and its name is not CLI-recognisable.

-- ============================================================
-- TARGET ROW LEVEL SECURITY — review draft
-- ============================================================
--
-- Default stance: DENY. RLS enabled with zero matching policies denies everything to everyone except the table owner and BYPASSRLS roles. A row appears below only where a named workload needs it.
--
-- operator_context has NO policies here. R-GAP-1: the database cannot authenticate an operator, so
-- operator actions arrive as service_role carrying an operator id and reason in the audit event.
-- Inventing an operator role would be faking authorization the database cannot perform.
--
-- migration_role likewise has no policies: it holds BYPASSRLS and must never be reachable from
-- application runtime.

-- Ownership is a LINK TABLE, bolao.participant_auth_links, and it is created by DDL-M2 like every
-- other table — with RLS enabled, FORCED, and PUBLIC revoked. KPLUS-F047: it used to appear here as a
-- commented-out prerequisite and existed in no model entry and no migration phase, so applying this
-- draft as generated would have left every ownership predicate below referencing a relation that does
-- not exist. Participant identity and auth identity are DIFFERENT: one user may own several
-- participants, and a historical participant may have no auth row at all.

-- ── audit_chain_head ──────────────────────────────────────────────────
ALTER TABLE audit.audit_chain_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_chain_head FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE audit.audit_chain_head FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- the chain trigger reads the tail on every audit append; FORCE RLS binds the owner, so without this the append fails for a non-superuser owner
-- ownership: NONE
CREATE POLICY audit_chain_head_trusted_runtime_select
  ON audit.audit_chain_head
  FOR SELECT
  TO service_role
  USING (true);

-- the same trigger advances the tail. No INSERT or DELETE policy exists for any principal: the single row is created by the migration and must never be added to or removed.
-- ownership: NONE
CREATE POLICY audit_chain_head_trusted_runtime_update
  ON audit.audit_chain_head
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── audit_event_details ───────────────────────────────────────────────
ALTER TABLE audit.audit_event_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_event_details FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE audit.audit_event_details FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- the redactable payload sidecar
-- ownership: NONE
CREATE POLICY audit_event_details_trusted_runtime_select
  ON audit.audit_event_details
  FOR SELECT
  TO service_role
  USING (true);

-- written with its parent event
-- ownership: NONE
CREATE POLICY audit_event_details_trusted_runtime_insert
  ON audit.audit_event_details
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- the ONE intentional UPDATE in the schema: erasure nulls the snapshots in place, which is why the sidecar exists at all — it lets erasure happen without breaking the chain.
-- ownership: NONE
CREATE POLICY audit_event_details_trusted_runtime_update
  ON audit.audit_event_details
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── audit_events ──────────────────────────────────────────────────────
ALTER TABLE audit.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE audit.audit_events FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.
-- APPEND ONLY: no UPDATE policy for any principal, including the runtime.

-- investigations read the audit log through the runtime
-- ownership: NONE
CREATE POLICY audit_events_trusted_runtime_select
  ON audit.audit_events
  FOR SELECT
  TO service_role
  USING (true);

-- APPEND ONLY. No UPDATE policy exists for ANY principal including the runtime: immutability is the property that makes the hash chain worth computing.
-- ownership: NONE
CREATE POLICY audit_events_trusted_runtime_insert
  ON audit.audit_events
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ── classification_predictions ────────────────────────────────────────
ALTER TABLE bolao.classification_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.classification_predictions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.classification_predictions FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- a user reads only their own zone picks. Reading another's before the cutoff would let them copy a better player's G4/Z4 — the same FAIRNESS requirement that governs predictions, not merely privacy.
-- ownership: VIA_ENTRY
CREATE POLICY classification_predictions_authenticated_select
  ON bolao.classification_predictions
  FOR SELECT
  TO authenticated
  USING (pool_entry_id IN (SELECT e.pool_entry_id FROM bolao.pool_entries e WHERE e.participant_id IN (SELECT participant_id FROM bolao.participant_auth_links WHERE auth_user_id = auth.uid())));

-- scoring reads every zone pick
-- ownership: NONE
CREATE POLICY classification_predictions_trusted_runtime_select
  ON bolao.classification_predictions
  FOR SELECT
  TO service_role
  USING (true);

-- submission through the server, with the cutoff enforced against the SERVER clock
-- ownership: NONE
CREATE POLICY classification_predictions_trusted_runtime_insert
  ON bolao.classification_predictions
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- an entrant may revise a zone pick until the cutoff
-- ownership: NONE
CREATE POLICY classification_predictions_trusted_runtime_update
  ON bolao.classification_predictions
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── classification_snapshots ──────────────────────────────────────────
ALTER TABLE bolao.classification_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.classification_snapshots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.classification_snapshots FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.
-- APPEND ONLY: no UPDATE policy for any principal, including the runtime.

-- a league table is information the provider already publishes, and the app renders its G4/Z4/SA6 zones to every visitor. A predicate here would break the page while protecting nothing.
-- ownership: NONE
CREATE POLICY classification_snapshots_anon_select
  ON bolao.classification_snapshots
  FOR SELECT
  TO anon
  USING (true);

-- identical to anon: a signed-in user must never see LESS than an anonymous one, and a league table holds nothing participant-specific to scope by.
-- ownership: NONE
CREATE POLICY classification_snapshots_authenticated_select
  ON bolao.classification_snapshots
  FOR SELECT
  TO authenticated
  USING (true);

-- the sync runtime and the scoring adapter read the authoritative snapshot.
-- ownership: NONE
CREATE POLICY classification_snapshots_trusted_runtime_select
  ON bolao.classification_snapshots
  FOR SELECT
  TO service_role
  USING (true);

-- the sync runtime is the ONLY writer. This is the control that stops a browser establishing official standings: anon and authenticated have no INSERT at all, and standings decide zone boundaries and therefore scores.
-- ownership: NONE
CREATE POLICY classification_snapshots_trusted_runtime_insert
  ON bolao.classification_snapshots
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ── competition_edition_phases ────────────────────────────────────────
ALTER TABLE bolao.competition_edition_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.competition_edition_phases FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.competition_edition_phases FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- cutoff times must be public — a hidden deadline is worse than a public one
-- ownership: NONE
CREATE POLICY competition_edition_phases_anon_select
  ON bolao.competition_edition_phases
  FOR SELECT
  TO anon
  USING (true);

-- a signed-in user must never see less than an anonymous one
-- ownership: NONE
CREATE POLICY competition_edition_phases_authenticated_select
  ON bolao.competition_edition_phases
  FOR SELECT
  TO authenticated
  USING (true);

-- the runtime reads reference data on every write path
-- ownership: NONE
CREATE POLICY competition_edition_phases_trusted_runtime_select
  ON bolao.competition_edition_phases
  FOR SELECT
  TO service_role
  USING (true);

-- reference and fixture data is written by the provider sync
-- ownership: NONE
CREATE POLICY competition_edition_phases_trusted_runtime_insert
  ON bolao.competition_edition_phases
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- fixtures are corrected by the sync, never by a client
-- ownership: NONE
CREATE POLICY competition_edition_phases_trusted_runtime_update
  ON bolao.competition_edition_phases
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── competition_edition_standings ─────────────────────────────────────
ALTER TABLE bolao.competition_edition_standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.competition_edition_standings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.competition_edition_standings FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.
-- APPEND ONLY: no UPDATE policy for any principal, including the runtime.

-- a league table is information the provider already publishes, and the app renders its G4/Z4/SA6 zones to every visitor. A predicate here would break the page while protecting nothing.
-- ownership: NONE
CREATE POLICY competition_edition_standings_anon_select
  ON bolao.competition_edition_standings
  FOR SELECT
  TO anon
  USING (true);

-- identical to anon: a signed-in user must never see LESS than an anonymous one, and a league table holds nothing participant-specific to scope by.
-- ownership: NONE
CREATE POLICY competition_edition_standings_authenticated_select
  ON bolao.competition_edition_standings
  FOR SELECT
  TO authenticated
  USING (true);

-- the sync runtime and the scoring adapter read the authoritative snapshot.
-- ownership: NONE
CREATE POLICY competition_edition_standings_trusted_runtime_select
  ON bolao.competition_edition_standings
  FOR SELECT
  TO service_role
  USING (true);

-- the sync runtime is the ONLY writer. This is the control that stops a browser establishing official standings: anon and authenticated have no INSERT at all, and standings decide zone boundaries and therefore scores.
-- ownership: NONE
CREATE POLICY competition_edition_standings_trusted_runtime_insert
  ON bolao.competition_edition_standings
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ── competition_editions ──────────────────────────────────────────────
ALTER TABLE bolao.competition_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.competition_editions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.competition_editions FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- edition labels are public
-- ownership: NONE
CREATE POLICY competition_editions_anon_select
  ON bolao.competition_editions
  FOR SELECT
  TO anon
  USING (true);

-- a signed-in user must never see less than an anonymous one
-- ownership: NONE
CREATE POLICY competition_editions_authenticated_select
  ON bolao.competition_editions
  FOR SELECT
  TO authenticated
  USING (true);

-- the runtime reads reference data on every write path
-- ownership: NONE
CREATE POLICY competition_editions_trusted_runtime_select
  ON bolao.competition_editions
  FOR SELECT
  TO service_role
  USING (true);

-- reference and fixture data is written by the provider sync
-- ownership: NONE
CREATE POLICY competition_editions_trusted_runtime_insert
  ON bolao.competition_editions
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- fixtures are corrected by the sync, never by a client
-- ownership: NONE
CREATE POLICY competition_editions_trusted_runtime_update
  ON bolao.competition_editions
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── competitions ──────────────────────────────────────────────────────
ALTER TABLE bolao.competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.competitions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.competitions FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- competition names are public facts the site renders before any sign-in
-- ownership: NONE
CREATE POLICY competitions_anon_select
  ON bolao.competitions
  FOR SELECT
  TO anon
  USING (true);

-- a signed-in user must never see less than an anonymous one
-- ownership: NONE
CREATE POLICY competitions_authenticated_select
  ON bolao.competitions
  FOR SELECT
  TO authenticated
  USING (true);

-- the runtime reads reference data on every write path
-- ownership: NONE
CREATE POLICY competitions_trusted_runtime_select
  ON bolao.competitions
  FOR SELECT
  TO service_role
  USING (true);

-- reference and fixture data is written by the provider sync
-- ownership: NONE
CREATE POLICY competitions_trusted_runtime_insert
  ON bolao.competitions
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- fixtures are corrected by the sync, never by a client
-- ownership: NONE
CREATE POLICY competitions_trusted_runtime_update
  ON bolao.competitions
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── match_results ─────────────────────────────────────────────────────
ALTER TABLE bolao.match_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.match_results FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.match_results FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- only the CURRENT official result is public; a superseded one would confuse a reader about which score counts
-- ownership: NONE
CREATE POLICY match_results_anon_select
  ON bolao.match_results
  FOR SELECT
  TO anon
  USING ((is_official = true AND superseded_by_id IS NULL));

-- a signed-in user sees the same current official result an anonymous visitor does, and no more
-- ownership: NONE
CREATE POLICY match_results_authenticated_select
  ON bolao.match_results
  FOR SELECT
  TO authenticated
  USING ((is_official = true AND superseded_by_id IS NULL));

-- scoring needs the correction history
-- ownership: NONE
CREATE POLICY match_results_trusted_runtime_select
  ON bolao.match_results
  FOR SELECT
  TO service_role
  USING (true);

-- record_result; a wrong result is superseded by a new row, never overwritten
-- ownership: NONE
CREATE POLICY match_results_trusted_runtime_insert
  ON bolao.match_results
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- superseding a result sets superseded_by_id on the OLD row. The old row's scores are never edited — that is what makes the correction history readable
-- ownership: NONE
CREATE POLICY match_results_trusted_runtime_update
  ON bolao.match_results
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── matches ───────────────────────────────────────────────────────────
ALTER TABLE bolao.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.matches FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.matches FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- fixtures are public: the site renders the schedule before anyone signs in, and a fixture reveals nothing about any participant
-- ownership: NONE
CREATE POLICY matches_anon_select
  ON bolao.matches
  FOR SELECT
  TO anon
  USING (true);

-- a signed-in user must never see less than an anonymous one
-- ownership: NONE
CREATE POLICY matches_authenticated_select
  ON bolao.matches
  FOR SELECT
  TO authenticated
  USING (true);

-- the runtime reads reference data on every write path
-- ownership: NONE
CREATE POLICY matches_trusted_runtime_select
  ON bolao.matches
  FOR SELECT
  TO service_role
  USING (true);

-- reference and fixture data is written by the provider sync
-- ownership: NONE
CREATE POLICY matches_trusted_runtime_insert
  ON bolao.matches
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- fixtures are corrected by the sync, never by a client
-- ownership: NONE
CREATE POLICY matches_trusted_runtime_update
  ON bolao.matches
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── migration_lineage ─────────────────────────────────────────────────
ALTER TABLE audit.migration_lineage ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.migration_lineage FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE audit.migration_lineage FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.
-- APPEND ONLY: no UPDATE policy for any principal, including the runtime.

-- reconciliation reads lineage to prove every target row has a source and every source element has a target; a check that cannot read what it checks is not a check
-- ownership: NONE
CREATE POLICY migration_lineage_trusted_runtime_select
  ON audit.migration_lineage
  FOR SELECT
  TO service_role
  USING (true);

-- the backfill writes lineage in the same transaction as the row it describes, so a row and its provenance cannot become separated
-- ownership: NONE
CREATE POLICY migration_lineage_trusted_runtime_insert
  ON audit.migration_lineage
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ── outbox_delivery_attempts ──────────────────────────────────────────
ALTER TABLE bolao.outbox_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.outbox_delivery_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.outbox_delivery_attempts FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.
-- APPEND ONLY: no UPDATE policy for any principal, including the runtime.

-- delivery forensics: the worker and the health report read attempt history to decide retry versus dead
-- ownership: NONE
CREATE POLICY outbox_delivery_attempts_trusted_runtime_select
  ON bolao.outbox_delivery_attempts
  FOR SELECT
  TO service_role
  USING (true);

-- APPEND ONLY: an attempt happened or it did not. No UPDATE policy exists for any principal.
-- ownership: NONE
CREATE POLICY outbox_delivery_attempts_trusted_runtime_insert
  ON bolao.outbox_delivery_attempts
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ── outbox_events ─────────────────────────────────────────────────────
ALTER TABLE bolao.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.outbox_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.outbox_events FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- the worker leases and completes events
-- ownership: NONE
CREATE POLICY outbox_events_trusted_runtime_select
  ON bolao.outbox_events
  FOR SELECT
  TO service_role
  USING (true);

-- intent to notify is written with the business change in one transaction
-- ownership: NONE
CREATE POLICY outbox_events_trusted_runtime_insert
  ON bolao.outbox_events
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- status, attempt_count, lease and dead_at all advance through the state machine
-- ownership: NONE
CREATE POLICY outbox_events_trusted_runtime_update
  ON bolao.outbox_events
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── participant_auth_links ────────────────────────────────────────────
ALTER TABLE bolao.participant_auth_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.participant_auth_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.participant_auth_links FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- KPLUS-F048. Every ownership predicate in this model is a subquery over this table, and PostgreSQL applies RLS to a table referenced inside another table's policy — measured, not assumed. Without this, that subquery returns nothing and every authenticated user loses access to their own participant, entries and predictions. Scoped to the caller's own links because a full read is an enumeration of the user base.
-- ownership: SELF
CREATE POLICY participant_auth_links_authenticated_select
  ON bolao.participant_auth_links
  FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

-- the runtime resolves ownership on every authenticated request and must see the whole link table to do it
-- ownership: NONE
CREATE POLICY participant_auth_links_trusted_runtime_select
  ON bolao.participant_auth_links
  FOR SELECT
  TO service_role
  USING (true);

-- the runtime establishes the link when an auth identity first claims a participant
-- ownership: NONE
CREATE POLICY participant_auth_links_trusted_runtime_insert
  ON bolao.participant_auth_links
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- revoking or repairing a link is an update; the row is never deleted, so provenance survives
-- ownership: NONE
CREATE POLICY participant_auth_links_trusted_runtime_update
  ON bolao.participant_auth_links
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── participant_identity_links ────────────────────────────────────────
ALTER TABLE bolao.participant_identity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.participant_identity_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.participant_identity_links FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- merge provenance is read by the operator queue through the runtime
-- ownership: NONE
CREATE POLICY participant_identity_links_trusted_runtime_select
  ON bolao.participant_identity_links
  FOR SELECT
  TO service_role
  USING (true);

-- merge_identity; the operator confirmation is enforced in the transaction, not in RLS
-- ownership: NONE
CREATE POLICY participant_identity_links_trusted_runtime_insert
  ON bolao.participant_identity_links
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- reverse_identity_merge marks a link reversed; the row is never deleted
-- ownership: NONE
CREATE POLICY participant_identity_links_trusted_runtime_update
  ON bolao.participant_identity_links
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── participants ──────────────────────────────────────────────────────
ALTER TABLE bolao.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.participants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.participants FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- a signed-in user may read only the participant rows linked to their auth identity. Without an ownership predicate this table is a full participant directory, which is enumeration.
-- ownership: SELF
CREATE POLICY participants_authenticated_select
  ON bolao.participants
  FOR SELECT
  TO authenticated
  USING (participant_id IN (SELECT participant_id FROM bolao.participant_auth_links WHERE auth_user_id = auth.uid()));

-- the runtime resolves identities for every write contract
-- ownership: NONE
CREATE POLICY participants_trusted_runtime_select
  ON bolao.participants
  FOR SELECT
  TO service_role
  USING (true);

-- create_entry creates a participant when an entry arrives for an unseen identity
-- ownership: NONE
CREATE POLICY participants_trusted_runtime_insert
  ON bolao.participants
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- merge_identity sets canonical_participant_id; redaction nulls contact fields in place
-- ownership: NONE
CREATE POLICY participants_trusted_runtime_update
  ON bolao.participants
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── payment_allocations ───────────────────────────────────────────────
ALTER TABLE bolao.payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.payment_allocations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.payment_allocations FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- reconciliation sums allocations per entry and per payment, so the runtime needs all of them
-- ownership: NONE
CREATE POLICY payment_allocations_trusted_runtime_select
  ON bolao.payment_allocations
  FOR SELECT
  TO service_role
  USING (true);

-- allocate_payment — the per-payment invariant is enforced in the transaction, which a CHECK cannot do across sibling rows
-- ownership: NONE
CREATE POLICY payment_allocations_trusted_runtime_insert
  ON bolao.payment_allocations
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- reserved for an operator correction path only. The normal way to change an allocation is a COMPENSATING allocation, because an allocation records a decision and overwriting it destroys why the first one was made
-- ownership: NONE
CREATE POLICY payment_allocations_trusted_runtime_update
  ON bolao.payment_allocations
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── payments ──────────────────────────────────────────────────────────
ALTER TABLE bolao.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.payments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.payments FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- reconciliation and allocation need every payment
-- ownership: NONE
CREATE POLICY payments_trusted_runtime_select
  ON bolao.payments
  FOR SELECT
  TO service_role
  USING (true);

-- record_payment — idempotent on external_reference
-- ownership: NONE
CREATE POLICY payments_trusted_runtime_insert
  ON bolao.payments
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- a payment is reversed by a compensating row; UPDATE exists only for proof paths
-- ownership: NONE
CREATE POLICY payments_trusted_runtime_update
  ON bolao.payments
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── pool_entries ──────────────────────────────────────────────────────
ALTER TABLE bolao.pool_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.pool_entries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.pool_entries FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- a user reads only their own entries. Reading another's entry before a cutoff would expose their picks.
-- ownership: SELF
CREATE POLICY pool_entries_authenticated_select
  ON bolao.pool_entries
  FOR SELECT
  TO authenticated
  USING (participant_id IN (SELECT participant_id FROM bolao.participant_auth_links WHERE auth_user_id = auth.uid()));

-- ranking, reconciliation and every write contract need all entries
-- ownership: NONE
CREATE POLICY pool_entries_trusted_runtime_select
  ON bolao.pool_entries
  FOR SELECT
  TO service_role
  USING (true);

-- create_entry — the only place the cutoff can be enforced with a trusted clock
-- ownership: NONE
CREATE POLICY pool_entries_trusted_runtime_insert
  ON bolao.pool_entries
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- withdrawal sets deleted_at; admin_correction may amend a label
-- ownership: NONE
CREATE POLICY pool_entries_trusted_runtime_update
  ON bolao.pool_entries
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── pool_fee_schedule ─────────────────────────────────────────────────
ALTER TABLE bolao.pool_fee_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.pool_fee_schedule FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.pool_fee_schedule FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- only the CURRENT price is public. It is a published price, not a person's money, and the app renders it before sign-in. Historical prices are not public.
-- ownership: NONE
CREATE POLICY pool_fee_schedule_anon_select
  ON bolao.pool_fee_schedule
  FOR SELECT
  TO anon
  USING (effective_to IS NULL);

-- same restriction as anon
-- ownership: NONE
CREATE POLICY pool_fee_schedule_authenticated_select
  ON bolao.pool_fee_schedule
  FOR SELECT
  TO authenticated
  USING (effective_to IS NULL);

-- the runtime snapshots the in-force fee onto an entry
-- ownership: NONE
CREATE POLICY pool_fee_schedule_trusted_runtime_select
  ON bolao.pool_fee_schedule
  FOR SELECT
  TO service_role
  USING (true);

-- a price change is a business decision made through a contract so it is audited
-- ownership: NONE
CREATE POLICY pool_fee_schedule_trusted_runtime_insert
  ON bolao.pool_fee_schedule
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- a superseded schedule row is CLOSED by setting effective_to, never deleted, so the entry that snapshotted it keeps its evidence
-- ownership: NONE
CREATE POLICY pool_fee_schedule_trusted_runtime_update
  ON bolao.pool_fee_schedule
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── pools ─────────────────────────────────────────────────────────────
ALTER TABLE bolao.pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.pools FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.pools FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- a pool's existence, name and status are public
-- ownership: NONE
CREATE POLICY pools_anon_select
  ON bolao.pools
  FOR SELECT
  TO anon
  USING (true);

-- a signed-in user must never see less than an anonymous one; pool name and status are public either way
-- ownership: NONE
CREATE POLICY pools_authenticated_select
  ON bolao.pools
  FOR SELECT
  TO authenticated
  USING (true);

-- needed by every write contract
-- ownership: NONE
CREATE POLICY pools_trusted_runtime_select
  ON bolao.pools
  FOR SELECT
  TO service_role
  USING (true);

-- pools are created by operator action through the runtime
-- ownership: NONE
CREATE POLICY pools_trusted_runtime_insert
  ON bolao.pools
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- freeze_toggled changes pool status
-- ownership: NONE
CREATE POLICY pools_trusted_runtime_update
  ON bolao.pools
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── predictions ───────────────────────────────────────────────────────
ALTER TABLE bolao.predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.predictions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.predictions FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- a user reads only their own predictions. Reading another's before the cutoff would let them copy a better player's picks — a FAIRNESS requirement, not only privacy.
-- ownership: VIA_ENTRY
CREATE POLICY predictions_authenticated_select
  ON bolao.predictions
  FOR SELECT
  TO authenticated
  USING (pool_entry_id IN (SELECT e.pool_entry_id FROM bolao.pool_entries e WHERE e.participant_id IN (SELECT participant_id FROM bolao.participant_auth_links WHERE auth_user_id = auth.uid())));

-- scoring reads all predictions
-- ownership: NONE
CREATE POLICY predictions_trusted_runtime_select
  ON bolao.predictions
  FOR SELECT
  TO service_role
  USING (true);

-- submit_prediction — the cutoff is enforced against the SERVER clock
-- ownership: NONE
CREATE POLICY predictions_trusted_runtime_insert
  ON bolao.predictions
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- a prediction may be overwritten while the phase is open
-- ownership: NONE
CREATE POLICY predictions_trusted_runtime_update
  ON bolao.predictions
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── prize_allocations ─────────────────────────────────────────────────
ALTER TABLE bolao.prize_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.prize_allocations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.prize_allocations FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- pool reconciliation compares prizes awarded against money collected
-- ownership: NONE
CREATE POLICY prize_allocations_trusted_runtime_select
  ON bolao.prize_allocations
  FOR SELECT
  TO service_role
  USING (true);

-- record_prize inserts all rows together so a partial declaration is impossible
-- ownership: NONE
CREATE POLICY prize_allocations_trusted_runtime_insert
  ON bolao.prize_allocations
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- paying a declared prize sets paid_amount; the declaration itself is superseded rather than edited
-- ownership: NONE
CREATE POLICY prize_allocations_trusted_runtime_update
  ON bolao.prize_allocations
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── ranking_snapshots ─────────────────────────────────────────────────
ALTER TABLE bolao.ranking_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.ranking_snapshots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.ranking_snapshots FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.
-- APPEND ONLY: no UPDATE policy for any principal, including the runtime.

-- a snapshot becomes public when published; an unpublished computation is a draft
-- ownership: NONE
CREATE POLICY ranking_snapshots_anon_select
  ON bolao.ranking_snapshots
  FOR SELECT
  TO anon
  USING (published_at IS NOT NULL);

-- a signed-in user sees the same published standings an anonymous visitor does
-- ownership: NONE
CREATE POLICY ranking_snapshots_authenticated_select
  ON bolao.ranking_snapshots
  FOR SELECT
  TO authenticated
  USING (published_at IS NOT NULL);

-- the ranking job reads its own history
-- ownership: NONE
CREATE POLICY ranking_snapshots_trusted_runtime_select
  ON bolao.ranking_snapshots
  FOR SELECT
  TO service_role
  USING (true);

-- APPEND ONLY: no UPDATE policy exists for any principal, because editing a published standing rewrites what participants already acted on
-- ownership: NONE
CREATE POLICY ranking_snapshots_trusted_runtime_insert
  ON bolao.ranking_snapshots
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ── request_idempotency ───────────────────────────────────────────────
ALTER TABLE bolao.request_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.request_idempotency FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.request_idempotency FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- the write boundary must read the record to decide replay versus conflict; no other principal may see it, because the stored response is a snapshot of a prior response and can carry whatever that response carried
-- ownership: NONE
CREATE POLICY request_idempotency_trusted_runtime_select
  ON bolao.request_idempotency
  FOR SELECT
  TO service_role
  USING (true);

-- INSERT ONLY: the record is written once, inside the business transaction. No UPDATE policy exists for any principal — a completed request record is a statement about something that already happened.
-- ownership: NONE
CREATE POLICY request_idempotency_trusted_runtime_insert
  ON bolao.request_idempotency
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ── sync_state ────────────────────────────────────────────────────────
ALTER TABLE bolao.sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.sync_state FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.sync_state FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- operational infrastructure. No anon or authenticated policy exists: a client has no use for a provider cursor, and its staleness is exposed through an operator health report instead.
-- ownership: NONE
CREATE POLICY sync_state_trusted_runtime_select
  ON bolao.sync_state
  FOR SELECT
  TO service_role
  USING (true);

-- the sync job creates its cursor
-- ownership: NONE
CREATE POLICY sync_state_trusted_runtime_insert
  ON bolao.sync_state
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- the cursor advances on every successful run
-- ownership: NONE
CREATE POLICY sync_state_trusted_runtime_update
  ON bolao.sync_state
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── ties ──────────────────────────────────────────────────────────────
ALTER TABLE bolao.ties ENABLE ROW LEVEL SECURITY;
ALTER TABLE bolao.ties FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bolao.ties FROM PUBLIC;
-- No DELETE policy for any principal: nothing in this schema is deleted.

-- the bracket is public
-- ownership: NONE
CREATE POLICY ties_anon_select
  ON bolao.ties
  FOR SELECT
  TO anon
  USING (true);

-- a signed-in user must never see less than an anonymous one
-- ownership: NONE
CREATE POLICY ties_authenticated_select
  ON bolao.ties
  FOR SELECT
  TO authenticated
  USING (true);

-- the runtime reads reference data on every write path
-- ownership: NONE
CREATE POLICY ties_trusted_runtime_select
  ON bolao.ties
  FOR SELECT
  TO service_role
  USING (true);

-- reference and fixture data is written by the provider sync
-- ownership: NONE
CREATE POLICY ties_trusted_runtime_insert
  ON bolao.ties
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- fixtures are corrected by the sync, never by a client
-- ownership: NONE
CREATE POLICY ties_trusted_runtime_update
  ON bolao.ties
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- TABLE PRIVILEGES — derived from model/access_model.json (KPLUS-F029)
-- ============================================================
--
-- A POLICY GRANTS NOTHING. Row-level security filters rows among the privileges a role already
-- holds; a table with a permissive policy and no GRANT denies everyone. The policies above are
-- therefore only half of the access model, and these statements are the other half.
--
-- Apply AFTER the policies. Order is not strictly required — a grant on a FORCE-RLS table with no
-- policy still yields nothing — but granting last means no window exists in which a privilege is
-- broader than the policy set that is meant to scope it.
--
-- SELECT_OWN in the access model becomes GRANT SELECT here. Row scoping is the ownership policy's
-- job and PostgreSQL has no row-scoped GRANT; the grant and the policy are one mechanism.
--
-- operator receives NO grant (R-GAP-1: not a database principal). Its permissions on 27
-- entities are exercised as service_role, and the generator FAILS if operator is ever declared a
-- permission service does not have.
--
-- No DELETE is granted anywhere: nothing in this schema is deleted.

-- Reaching a table also requires reaching its schema.
REVOKE ALL ON SCHEMA audit FROM PUBLIC;
GRANT USAGE ON SCHEMA audit TO service_role;
REVOKE ALL ON SCHEMA bolao FROM PUBLIC;
GRANT USAGE ON SCHEMA bolao TO anon, authenticated, service_role;


-- ── audit.audit_chain_head
REVOKE ALL ON TABLE audit.audit_chain_head FROM PUBLIC;
GRANT SELECT, UPDATE ON TABLE audit.audit_chain_head TO service_role;

-- ── audit.audit_event_details
REVOKE ALL ON TABLE audit.audit_event_details FROM PUBLIC;
GRANT INSERT, SELECT, UPDATE ON TABLE audit.audit_event_details TO service_role;

-- ── audit.audit_events
REVOKE ALL ON TABLE audit.audit_events FROM PUBLIC;
GRANT INSERT, SELECT ON TABLE audit.audit_events TO service_role;

-- ── audit.migration_lineage
REVOKE ALL ON TABLE audit.migration_lineage FROM PUBLIC;
GRANT INSERT, SELECT ON TABLE audit.migration_lineage TO service_role;

-- ── bolao.classification_predictions
REVOKE ALL ON TABLE bolao.classification_predictions FROM PUBLIC;
GRANT SELECT ON TABLE bolao.classification_predictions TO authenticated;   -- rows narrowed by the ownership policy above
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.classification_predictions TO service_role;

-- ── bolao.classification_snapshots
REVOKE ALL ON TABLE bolao.classification_snapshots FROM PUBLIC;
GRANT SELECT ON TABLE bolao.classification_snapshots TO anon;
GRANT SELECT ON TABLE bolao.classification_snapshots TO authenticated;
GRANT INSERT, SELECT ON TABLE bolao.classification_snapshots TO service_role;

-- ── bolao.competition_edition_phases
REVOKE ALL ON TABLE bolao.competition_edition_phases FROM PUBLIC;
GRANT SELECT ON TABLE bolao.competition_edition_phases TO anon;
GRANT SELECT ON TABLE bolao.competition_edition_phases TO authenticated;
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.competition_edition_phases TO service_role;

-- ── bolao.competition_edition_standings
REVOKE ALL ON TABLE bolao.competition_edition_standings FROM PUBLIC;
GRANT SELECT ON TABLE bolao.competition_edition_standings TO anon;
GRANT SELECT ON TABLE bolao.competition_edition_standings TO authenticated;
GRANT INSERT, SELECT ON TABLE bolao.competition_edition_standings TO service_role;

-- ── bolao.competition_editions
REVOKE ALL ON TABLE bolao.competition_editions FROM PUBLIC;
GRANT SELECT ON TABLE bolao.competition_editions TO anon;
GRANT SELECT ON TABLE bolao.competition_editions TO authenticated;
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.competition_editions TO service_role;

-- ── bolao.competitions
REVOKE ALL ON TABLE bolao.competitions FROM PUBLIC;
GRANT SELECT ON TABLE bolao.competitions TO anon;
GRANT SELECT ON TABLE bolao.competitions TO authenticated;
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.competitions TO service_role;

-- ── bolao.match_results
REVOKE ALL ON TABLE bolao.match_results FROM PUBLIC;
GRANT SELECT ON TABLE bolao.match_results TO anon;
GRANT SELECT ON TABLE bolao.match_results TO authenticated;
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.match_results TO service_role;

-- ── bolao.matches
REVOKE ALL ON TABLE bolao.matches FROM PUBLIC;
GRANT SELECT ON TABLE bolao.matches TO anon;
GRANT SELECT ON TABLE bolao.matches TO authenticated;
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.matches TO service_role;

-- ── bolao.outbox_delivery_attempts
REVOKE ALL ON TABLE bolao.outbox_delivery_attempts FROM PUBLIC;
GRANT INSERT, SELECT ON TABLE bolao.outbox_delivery_attempts TO service_role;

-- ── bolao.outbox_events
REVOKE ALL ON TABLE bolao.outbox_events FROM PUBLIC;
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.outbox_events TO service_role;

-- ── bolao.participant_auth_links
REVOKE ALL ON TABLE bolao.participant_auth_links FROM PUBLIC;
GRANT SELECT ON TABLE bolao.participant_auth_links TO authenticated;   -- rows narrowed by the ownership policy above
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.participant_auth_links TO service_role;

-- ── bolao.participant_identity_links
REVOKE ALL ON TABLE bolao.participant_identity_links FROM PUBLIC;
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.participant_identity_links TO service_role;

-- ── bolao.participants
REVOKE ALL ON TABLE bolao.participants FROM PUBLIC;
GRANT SELECT ON TABLE bolao.participants TO authenticated;   -- rows narrowed by the ownership policy above
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.participants TO service_role;

-- ── bolao.payment_allocations
REVOKE ALL ON TABLE bolao.payment_allocations FROM PUBLIC;
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.payment_allocations TO service_role;

-- ── bolao.payments
REVOKE ALL ON TABLE bolao.payments FROM PUBLIC;
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.payments TO service_role;

-- ── bolao.pool_entries
REVOKE ALL ON TABLE bolao.pool_entries FROM PUBLIC;
GRANT SELECT ON TABLE bolao.pool_entries TO authenticated;   -- rows narrowed by the ownership policy above
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.pool_entries TO service_role;

-- ── bolao.pool_fee_schedule
REVOKE ALL ON TABLE bolao.pool_fee_schedule FROM PUBLIC;
GRANT SELECT ON TABLE bolao.pool_fee_schedule TO anon;
GRANT SELECT ON TABLE bolao.pool_fee_schedule TO authenticated;
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.pool_fee_schedule TO service_role;

-- ── bolao.pools
REVOKE ALL ON TABLE bolao.pools FROM PUBLIC;
GRANT SELECT ON TABLE bolao.pools TO anon;
GRANT SELECT ON TABLE bolao.pools TO authenticated;
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.pools TO service_role;

-- ── bolao.predictions
REVOKE ALL ON TABLE bolao.predictions FROM PUBLIC;
GRANT SELECT ON TABLE bolao.predictions TO authenticated;   -- rows narrowed by the ownership policy above
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.predictions TO service_role;

-- ── bolao.prize_allocations
REVOKE ALL ON TABLE bolao.prize_allocations FROM PUBLIC;
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.prize_allocations TO service_role;

-- ── bolao.ranking_snapshots
REVOKE ALL ON TABLE bolao.ranking_snapshots FROM PUBLIC;
GRANT SELECT ON TABLE bolao.ranking_snapshots TO anon;
GRANT SELECT ON TABLE bolao.ranking_snapshots TO authenticated;
GRANT INSERT, SELECT ON TABLE bolao.ranking_snapshots TO service_role;

-- ── bolao.request_idempotency
REVOKE ALL ON TABLE bolao.request_idempotency FROM PUBLIC;
GRANT INSERT, SELECT ON TABLE bolao.request_idempotency TO service_role;

-- ── bolao.sync_state
REVOKE ALL ON TABLE bolao.sync_state FROM PUBLIC;
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.sync_state TO service_role;

-- ── bolao.ties
REVOKE ALL ON TABLE bolao.ties FROM PUBLIC;
GRANT SELECT ON TABLE bolao.ties TO anon;
GRANT SELECT ON TABLE bolao.ties TO authenticated;
GRANT INSERT, SELECT, UPDATE ON TABLE bolao.ties TO service_role;
