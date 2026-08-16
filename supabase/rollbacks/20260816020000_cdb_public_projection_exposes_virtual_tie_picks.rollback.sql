--
-- 20260816020000_..._exposes_virtual_tie_picks.rollback.sql
--
-- Devolve a view a `bolao.read_document(d.slug)` para as tres linhas, como em
-- `20260813130000_normalized_read_surface_completion.sql`, e derruba
-- `bolao.cdb_public_document()`.
--
-- ⚠ EFEITO DE REVERTER: campeao e vice somem de novo da projecao publica para toda entrada com
-- palpite gravado contra `sf-1`/`sf-2`/`final-1` (eram 5 das 12 em 2026-08-16). O ranking, o card
-- de podio, o "Ver palpites" e o CSV voltam a mostrar "—", e o bonus de 30 + 20 volta a nao ser
-- somado quando a final for jogada.
--
-- Nenhum palpite e alterado por reverter: o defeito sempre foi de LEITURA, e o documento
-- autoritativo nunca dependeu desta view.

begin;

create or replace view public.bolao_state_normalized_public
with (security_invoker = true) as
select
  d.doc_id                    as id,
  bolao.read_document(d.slug) as state,
  null::timestamptz           as updated_at
from (values
  ('cdb2026', 'cdb2026'),
  ('br2026', 'br2026'),
  ('copa2026', 'main')
) as d(slug, doc_id);

comment on view public.bolao_state_normalized_public is
  'Sanitized public read surface in the legacy (id, state, updated_at) contract, so a client '
  'readTable can be re-pointed here with no application code change. Emits only whitelisted '
  'fields: no email, payer, payment method, payment reference, auth user id, ip, user agent, '
  'device metadata, lineage or provenance. updated_at is deliberately NULL.';

revoke all on table public.bolao_state_normalized_public from public;
grant select on table public.bolao_state_normalized_public to anon, authenticated;

drop function if exists bolao.cdb_public_document();

commit;

select 'projecao publica do cdb2026 revertida a read_document (perde palpite virtual)' as resultado;
