-- Reversao de 20261118140000_powerball_public_open_draws_rpc.sql.
-- O site volta a ler so o `data.js` (o fallback ja existente); nenhum dado e tocado.
begin;
drop function if exists public.lottery_public_open_draws();
commit;
