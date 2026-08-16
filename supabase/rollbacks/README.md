# `supabase/rollbacks/` — scripts de reversão

**Estabelecido:** 2026-08-16, na auditoria de persistência do CDB2026.

Cada arquivo aqui é o inverso de uma migração de `supabase/migrations/`, com o mesmo prefixo de
versão e o mesmo nome, mais `.rollback.sql`.

## Por que não moram junto das migrações

O Supabase CLI trata **todo** `*.sql` de `supabase/migrations/` como migração de avanço. Com os
rollbacks lá dentro:

- `db push --include-all --dry-run` oferecia empurrar os próprios arquivos de rollback;
- rollback e avanço compartilham o prefixo de versão, e o rollback ordena **antes** — então o
  ledger passava a reportar aquelas versões como parcialmente aplicadas (as linhas `remote: ""`
  em `supabase migration list`);
- a saída do `migration list` ficava ilegível, e a sugestão do CLI para "consertar" era
  `migration repair`, que reescreve histórico remoto por causa de um problema de layout de
  arquivo.

Medido em 2026-08-16: mover os 14 arquivos levou o `dry-run` de **17** para **5** entradas, sem
tocar em uma linha de SQL.

## Regras

1. **Nada aqui é executado automaticamente.** Rollback é operação deliberada de operador.
2. **Um rollback por migração**, mesmo prefixo de versão, mesmo nome-base.
3. O cabeçalho de cada arquivo declara **o efeito de reverter** — não só o que ele desfaz. Vários
   têm efeito colateral intencional (por exemplo, o de
   `20260816000000_cdb_receipt_identity_is_cross_path` **desarma** o catch-up automático, porque a
   ferramenta falha fechado sem a RPC; o de `20260816020000` faz campeão e vice sumirem de novo da
   projeção pública).
4. Reverter uma migração **não** desfaz o registro dela em `supabase_migrations.schema_migrations`.
   Remover a linha do ledger é passo separado e explícito.

## Conteúdo

Os 14 arquivos foram movidos byte a byte (`git mv`, 0 linhas alteradas). Nenhum foi executado
durante a movimentação.
