# Powerball Admin — Storage (Comprovantes) Design

Status legend: **testado e executado** / **validado estaticamente** / **proposto, mas não
executado** (NÃO EXECUTADO).

## Status of this document

Everything below is **proposto, mas não executado**: the `powerball-private` bucket does not
exist in any real Supabase project (local or production) — it has never been created. The admin
UI screen (`admin/js/app.js`'s `renderReceipts()`) calls the real `@supabase/supabase-js`
Storage API (`.storage.from("powerball-private").list()/.upload()/.createSignedUrl()`), not a
mock — so once a bucket with this name and these policies exists, the screen should work without
further UI changes. Until then, every action on the screen fails with a real Supabase error
("Bucket not found"), surfaced honestly to the admin rather than hidden behind a fake success
state.

## Bucket

- Name: `powerball-private`.
- **Public: false.** Never made public — comprovantes contain transaction IDs, participant
  names, and payment amounts.
- Created via Supabase Dashboard → Storage → New bucket, or `supabase storage create` via the
  CLI once a real/local project exists (see POWERBALL_ADMIN_OPERATIONS.md runbook — this step
  should be added there when the bucket is actually created).

## Folder structure (proposed)

```
powerball-private/
  participants/<participant_id>/<filename>       — proof-of-payment uploads for a participant
  draws/<draw_id>/publications/<publication_id>/  — publication-related PDFs/manifests, if any
  admin-attachments/<audit_id or free-form>/      — ad-hoc admin attachments not tied to a
                                                     specific participant/draw
```

Rationale: prefixing by entity type + id lets a Storage RLS policy check the path itself (via
`storage.foldername(name)`) against the caller's role, without needing a separate lookup table
mapping files to owners — the path *is* the ownership declaration.

## Storage RLS policies (proposed SQL, NÃO EXECUTADO — to add as a 005 migration when a bucket exists)

```sql
-- Enable RLS on storage.objects is already on by default in Supabase; policies are added per
-- bucket via the bucket_id filter.

create policy "powerball_private_admin_read" on storage.objects
  for select using (
    bucket_id = 'powerball-private'
    and lottery_current_role() in ('owner','admin','auditor')
  );

create policy "powerball_private_admin_write" on storage.objects
  for insert with check (
    bucket_id = 'powerball-private'
    and lottery_current_role() in ('owner','admin')
  );

-- No update/delete policy is proposed initially -- comprovantes should be treated as
-- append-only/immutable once uploaded, matching the no-hard-delete rule for every other
-- operational entity in this system. A correction would mean uploading a new file with a
-- version suffix and marking the old one superseded via metadata, not overwriting it in place
-- -- exact mechanism to be designed when this is actually built against a real bucket.
```

`auditor` gets read but not write, matching the role's read-only guarantee everywhere else in
this system. `anon` has no policy at all (deny-by-default, same pattern as every table).

## Participant-facing access

Never a bare public URL. Two options, to be decided when this is actually implemented:
1. Attach the file directly to the confirmation/receipt email (reusing the outbox from
   `powerball-email-professionalization`).
2. A signed URL with a short expiration (the admin UI's "Gerar link temporário" button already
   demonstrates this pattern with `createSignedUrl(path, 300)` — 5 minutes — for admin use; a
   participant-facing equivalent would need its own signed-URL-generation RPC or Edge Function
   so a participant's session, not an admin session, is what's checked before issuing the URL).

## Known gap: audit trail for uploads

Every other write in this system goes through a SECURITY DEFINER RPC that writes to
`lottery_admin_audit` as part of the same atomic operation (see POWERBALL_ADMIN_AUDIT.md).
Supabase Storage uploads do **not** go through our RPC layer — they're a direct
`storage.objects` write via the Storage API, gated only by the Storage RLS policies above. This
means an upload today would **not** automatically produce an audit log entry, breaking the "every
mutation creates an audit entry" guarantee for this one area.

This is a real, unresolved gap, not glossed over. Two ways to close it, to be decided/built when
a real bucket exists:
- **Storage webhook / Database Function trigger**: Supabase can trigger a Postgres function on
  `storage.objects` insert (via a trigger on that table, since it's a real Postgres table
  under the hood) that calls `lottery_write_audit(...)` — this would make it automatic and not
  reliant on the client behaving correctly.
- **RPC-mediated upload**: have the admin UI call an `admin_record_receipt_upload` RPC *after* a
  successful direct Storage upload, passing the resulting path, which writes the audit entry.
  Weaker than the trigger approach since a client could upload without ever calling the RPC, but
  requires no Storage-level trigger engineering.

The current UI (`renderReceipts()`) prompts for a mandatory reason before upload but only shows
it back to the admin in an alert — it does **not** yet write it anywhere durable, because neither
of the two mechanisms above has been built. This is called out explicitly in the UI's on-screen
copy and here, not silently accepted as "good enough."
