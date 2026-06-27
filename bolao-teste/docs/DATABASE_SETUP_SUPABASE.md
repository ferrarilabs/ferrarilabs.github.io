# Supabase Database Setup — v3.3-db-ready

This version is **local-first with remote mirror**.

That means:
- the site still works if Supabase is not configured;
- once Supabase is configured, the full state is loaded from Supabase on page load;
- every save/delete/payment/result update is mirrored to Supabase;
- if Supabase fails, the browser keeps local data and logs the error.

## 1. Create Supabase project

Create a free Supabase project.

## 2. Create table

Run this SQL in Supabase SQL Editor:

```sql
create table if not exists public.bolao_state (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
```

## 3. Enable RLS

For a private family/friends site, the simplest testing policy is below.

```sql
alter table public.bolao_state enable row level security;

create policy "allow anon read bolao state"
on public.bolao_state
for select
to anon
using (id = 'main');

create policy "allow anon upsert bolao state"
on public.bolao_state
for insert
to anon
with check (id = 'main');

create policy "allow anon update bolao state"
on public.bolao_state
for update
to anon
using (id = 'main')
with check (id = 'main');
```

Important: this is not bank-grade security. Anyone with the site code can see the anon key. This is acceptable for a small informal bolão test, but a production-grade system should use real auth or a serverless API.

## 4. Copy keys

In Supabase:
Project Settings → API

Copy:
- Project URL
- anon public key

## 5. Edit `js/config.js`

Change:

```js
database: {
  enabled: false,
  provider: "supabase",
  url: "",
  anonKey: "",
  table: "bolao_state",
  stateId: "main",
  localFallback: true
}
```

to:

```js
database: {
  enabled: true,
  provider: "supabase",
  url: "YOUR_SUPABASE_PROJECT_URL",
  anonKey: "YOUR_SUPABASE_ANON_KEY",
  table: "bolao_state",
  stateId: "main",
  localFallback: true
}
```

## 6. Deploy and test

Open the site in:
- your phone
- another browser
- another computer

Create one test entry. It should appear across devices after refresh.

## Rollback

Set:

```js
enabled: false
```

and redeploy. The app will go back to localStorage-only behavior.
