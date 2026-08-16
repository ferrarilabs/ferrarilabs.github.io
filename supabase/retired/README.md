# `supabase/retired/` — migrações aposentadas, nunca aplicadas

**Estabelecido:** 2026-08-16, na reconciliação de histórico da auditoria de persistência do
CDB2026.

Uma migração entra aqui quando **todas** estas condições valem, cada uma provada por medição:

1. **nunca foi aplicada em produção** — não existe linha dela em
   `supabase_migrations.schema_migrations`, então aposentá-la não reescreve histórico remoto;
2. **todo efeito que ainda é desejado já está coberto** por uma migração posterior, ou por uma
   solução equivalente fora do banco;
3. **os efeitos não cobertos são indesejados**, com o motivo registrado.

Aposentar **não** é reverter: nada é executado, nada é desfeito, o arquivo é preservado byte a
byte como evidência. É só tirá-lo do diretório que o Supabase CLI varre, para que ele pare de
aparecer como migração pendente e de bloquear o deploy de outras.

Uma migração que ainda tenha qualquer efeito desejado e ausente **não** vem para cá: ela é
aplicada.

---

## `20260813050000_confirmation_payload_carries_snapshot.sql`

**Aposentada em:** 2026-08-16 · **Executada alguma vez:** NÃO, em lugar nenhum.

Toca exatamente dois objetos, e nada além (sem tabela, sem policy, sem dado):

### 1. `public.cdb_save_my_picks(text,text,jsonb)` — **superado**

Este é o arquivo que introduziu o `snapshot` no payload de
`cdb2026.entry_saved_confirmation`, e a razão dele continua válida: o consumidor exige o
snapshot, e reconstruir o recibo lendo a entrada no momento do consumo produziria um documento
com a identidade da versão A e o conteúdo da versão B.

O arquivo foi rebaseado depois do write cutover — sua definição **já lê**
`bolao.cdb_authoritative_document()` (linha 91), não o documento legado. A afirmação de que ele
conteria um `cdb_save_my_picks` pré-cutover era verdadeira para a versão original e **deixou de
ser** depois do rebase; medido em 2026-08-16 comparando o código dos dois arquivos.

`20260816010000_cdb_confirmation_payload_carries_snapshot_again.sql` define a **mesma** função.
Diferença entre as duas, normalizando comentários e espaço: a assinatura escrita em outro estilo,
a tag do dollar-quote, e a ordem de duas atribuições adjacentes sem dependência entre si
(`v_versao` / `v_canon`). **Semanticamente idênticas.** A posterior ainda acrescenta um bloco
`do $verify$` que relê o corpo gravado e recusa o commit se qualquer peça do cutover sumir ou se
um campo privado aparecer.

Logo: aplicar este arquivo redefiniria a função para depois ser redefinida de novo, no mesmo
push, com um corpo equivalente e verificado. Redundância, não correção.

### 2. `public.cdb_current_receipt_snapshot(text)` — **indesejado**

Ausente de produção e **sem nenhum chamador**:

- `send_receipt_template_test.py`, para quem a função foi escrita, monta o snapshot em Python
  (`monta_snapshot()`, lendo `bolao_state` por REST) e nunca a chama;
- as únicas menções no repositório são um comentário num script já arquivado e desarmado, e o
  próprio registro de auditoria que a classificou como pendência.

E ela lê `select state into v_state from bolao_state` — o documento **legado**.
`MIGRATION_LEDGER_PROVENANCE_AUDIT.md` (2026-08-13) já a registrou como
"a **named legacy consumer**, and `LEGACY_RETIREMENT` must resolve it (repoint at
`bolao.cdb_authoritative_document()`) before the legacy row can go".

Criar hoje uma função sem uso, que lê o documento legado, enquanto existe um plano em andamento
para aposentar exatamente esse tipo de leitor, é adicionar dívida para não ganhar nada.

### Por que aposentar e não "marcar como aplicada"

Marcar como aplicada registraria que produção contém `cdb_current_receipt_snapshot`. **Não
contém**, e não vai passar a conter. O ledger passaria a afirmar um estado que não existe — que é
o defeito que o ledger existe para impedir. Aposentar diz a verdade: o arquivo nunca rodou, e não
vai rodar.

### Como desfazer

`git mv supabase/retired/20260813050000_*.sql supabase/migrations/`. O arquivo está preservado
byte a byte (`git mv`, 0 linhas alteradas). Se um dia `cdb_current_receipt_snapshot` for
necessária, o correto é uma migração nova que a crie lendo
`bolao.cdb_authoritative_document()` — não ressuscitar esta, que lê o legado.
