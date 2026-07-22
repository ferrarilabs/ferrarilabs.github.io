# Supabase Database Setup — v4.0-clean

Local-first with optional remote mirror. The site works without Supabase configured.

## 1. Create Supabase project

Create a free Supabase project at supabase.com.

## 2. Create table

Run in the Supabase SQL Editor:

```sql
create table if not exists public.bolao_state (
  id text primary key check (char_length(id) <= 50),
  state jsonb not null default '{}'::jsonb check (pg_column_size(state) < 1048576),
  updated_at timestamptz not null default now()
);
```

The `check` constraints limit the state to 1 MB and the id to 50 chars.

## 3. Enable RLS

```sql
alter table public.bolao_state enable row level security;

create policy "allow anon read"
  on public.bolao_state for select to anon
  using (id = 'main');

create policy "allow anon insert"
  on public.bolao_state for insert to anon
  with check (id = 'main');

create policy "allow anon update"
  on public.bolao_state for update to anon
  using (id = 'main')
  with check (id = 'main');
```

Note: anyone with the site's anon key can read/write the bolão state. This is acceptable for an informal friends/family app. Never use the service role key in the frontend.

## 4. Copy keys

In Supabase → Project Settings → API:

- Project URL → `database.url`
- anon public key → `database.anonKey`

Never use the service_role key. It bypasses RLS and should never be in browser code.

## 5. Edit `js/config.js`

```js
database: {
  enabled: true,
  provider: "supabase",
  url: "https://YOUR-PROJECT.supabase.co",
  anonKey: "YOUR_ANON_PUBLIC_KEY",
  table: "bolao_state",
  stateId: "main",
  localFallback: true
}
```

## 6. Test

Open the site in two different browsers simultaneously. Create an entry in one — refresh the other. Both should show the same data within a few seconds.

## Rollback to localStorage-only

Set `enabled: false` in `config.js` and redeploy. Local data is unaffected.

## Múltiplos apps na mesma tabela (2026-07-13)

Os três apps (Copa, BR2026, CDB2026) compartilham o **mesmo projeto e a mesma tabela**
`bolao_state` do Supabase — a URL e a `anonKey` em `js/config.js` são idênticas nos três,
diferenciados só pelo `stateId` (`main` / `br2026` / `cdb2026`, uma linha por app). Isso já
estava assim desde que BR2026/CDB2026 foram criados (`database.enabled: false`, aguardando este
passo), não é uma tabela nova.

As policies de RLS documentadas na seção 3 acima só liberavam `id = 'main'` (só a Copa). Com
`database.enabled: true` agora também em BR2026 e CDB2026 (2026-07-13), rode isto uma vez no SQL
Editor do Supabase para estender as três policies aos três ids:

```sql
drop policy if exists "allow anon read"   on public.bolao_state;
drop policy if exists "allow anon insert" on public.bolao_state;
drop policy if exists "allow anon update" on public.bolao_state;

create policy "allow anon read"
  on public.bolao_state for select to anon
  using (id in ('main', 'br2026', 'cdb2026'));

create policy "allow anon insert"
  on public.bolao_state for insert to anon
  with check (id in ('main', 'br2026', 'cdb2026'));

create policy "allow anon update"
  on public.bolao_state for update to anon
  using (id in ('main', 'br2026', 'cdb2026'))
  with check (id in ('main', 'br2026', 'cdb2026'));
```

Não é preciso inserir as linhas `br2026`/`cdb2026` manualmente — o primeiro `saveState()` de cada
app faz um upsert (`Prefer: resolution=merge-duplicates`) que cria a linha sozinho, assim que a
policy acima permitir.

**Antes de rodar este SQL**, `database.enabled: true` em BR2026/CDB2026 não quebra nada — a RLS
rejeita a operação (403), e o fallback local-first absorve o erro silenciosamente (sem crash, sem
perda de dado local, mas também sem sincronizar de fato). Testado via Playwright com a resposta
da Supabase mockada como 403. Depois de rodar o SQL, teste como na seção 6 acima (duas abas, uma
entrada em cada app).

## Merge behavior

`app.js` uses merge-before-save:
- Entries: union by `id`, newest `createdAt` wins on conflict.
- `paid` and `results`: `Object.assign({}, remote, local)` — local always wins per key.
- Before every remote save: fetch current remote `updated_at`; if remote is newer, merge first.
