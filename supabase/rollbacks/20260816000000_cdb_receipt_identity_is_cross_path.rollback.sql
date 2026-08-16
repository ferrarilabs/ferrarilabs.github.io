-- 20260816000000_cdb_receipt_identity_is_cross_path.rollback.sql
--
-- Desfaz a migracao de identidade cross-path do comprovante do CDB2026.
--
-- ⚠ CONSEQUENCIA DELIBERADA DESTE ROLLBACK
--
-- `cdb_has_accepted_receipt` some. `receipt_catchup_tool.py` FALHA FECHADO quando a RPC nao
-- existe -- ele recusa a rodar em vez de cair para o criterio antigo (data + lastClientRef), que
-- foi exatamente o que mandou comprovante duplicado para duas pessoas em 2026-08-16.
--
-- Ou seja: rodar este rollback DESLIGA o catch-up automatico. Isso e o comportamento correto,
-- nao um efeito colateral -- e a alternativa seria reabrir o incidente.
--
-- As atestacoes de entrega legada sao EVIDENCIA e nao voltam sozinhas. Copiar antes de derrubar:
--
--   create table bolao.cdb_legacy_receipt_attestation_bkp as
--     select * from bolao.cdb_legacy_receipt_attestation;

drop function if exists public.cdb_receipt_families();
drop function if exists public.cdb_attest_legacy_receipt(text, text, text, text);
drop function if exists public.cdb_has_accepted_receipt(text, text);

drop table if exists bolao.cdb_legacy_receipt_attestation;
drop table if exists bolao.cdb_receipt_family_registry;

select 'identidade cross-path do comprovante removida; catch-up automatico fica desarmado'
       as resultado;
