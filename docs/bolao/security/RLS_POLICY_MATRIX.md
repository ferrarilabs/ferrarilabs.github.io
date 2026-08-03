# RLS Policy Matrix — `public.bolao_state`

2026-08-02. Fonte: `bolao/copa2026/docs/DATABASE_SETUP_SUPABASE.md` (único SQL versionado no
repo — não há diretório de migrations). Comportamento de `select` confirmado empiricamente via
teste passivo (GET, chave anon pública) em 2026-08-02 — ver `SUPABASE_SECURITY_REVIEW.md`.
Comportamento de `insert`/`update` **não foi executado** contra produção; a coluna "Teste" abaixo
reflete isso explicitamente.

| Tabela | Operação | Role | Policy (nome) | USING | WITH CHECK | Justificativa | Risco | Teste |
|---|---|---|---|---|---|---|---|---|
| `public.bolao_state` | SELECT | `anon` | `allow anon read` | `id in ('main','br2026','cdb2026')` | — | Bolão público/transparente por design — qualquer participante pode ver ranking/entradas de todos | Alto — inclui e-mail, nome do pagador, método de pagamento, diagnóstico de dispositivo, audit log; e cruza fronteira entre os 3 apps numa única query sem filtro | **CONFIRMADO empiricamente** (GET real, 2026-08-02) — retorna as 3 linhas completas |
| `public.bolao_state` | INSERT | `anon` | `allow anon insert` | — | `id in ('main','br2026','cdb2026')` | Permite que o primeiro `saveState()` de cada app crie a própria linha via upsert | Médio — qualquer cliente pode criar/recriar uma das 3 linhas com conteúdo arbitrário (sujeito ao `check` de tamanho ≤1MB e `id`≤50 chars) | **NÃO EXECUTADO** — análise de código/policy apenas |
| `public.bolao_state` | UPDATE | `anon` | `allow anon update` | `id in ('main','br2026','cdb2026')` | `id in ('main','br2026','cdb2026')` | Permite merge-before-save e ações admin (client-side) gravarem a linha | **Alto** — nenhuma distinção entre propriedade admin (`results`,`paid`,`auditLog`,`cutoffAt`) e propriedade de participante (`entries[]` próprio) dentro do mesmo `update` — ver "Mass Assignment" em `SUPABASE_SECURITY_REVIEW.md` | **NÃO EXECUTADO** — análise de código/policy apenas |
| `public.bolao_state` | DELETE | `anon` | *(nenhuma policy documentada)* | — | — | Nenhuma necessidade de `DELETE` de linha — "limpar dados" do admin faz upsert com objeto vazio, não `DELETE` | Baixo, **se** nenhuma policy de delete existir de fato no banco (não verificável sem dashboard) | **NÃO VERIFICÁVEL** sem acesso ao dashboard — RLS sem policy explícita nega por padrão (comportamento padrão do Postgres RLS), então o risco é baixo *supondo* que nenhuma policy adicional foi criada fora deste SQL documentado |
| `public.bolao_state` | SELECT/INSERT/UPDATE | `authenticated` | *(nenhuma policy — não aplicável)* | — | — | Não há Supabase Auth em uso; nenhum usuário jamais autentica como `authenticated` | N/A | N/A — não aplicável ao modelo atual |
| `public.bolao_state` | qualquer | `service_role` | N/A (bypassa RLS por definição do Postgres/Supabase) | — | — | Nunca usado no cliente nem em scripts — confirmado por busca de código | N/A (RLS não se aplica a este role por design da plataforma Supabase) | N/A |

## GRANT/REVOKE diretos

Não encontrados no repositório — o SQL documentado usa apenas `create policy`, sem `grant`/
`revoke` explícitos além do `create table`. Como não há acesso ao dashboard nesta auditoria, não é
possível confirmar se os grants padrão do schema `public` (herdados da criação do projeto
Supabase) foram alterados manualmente fora do SQL versionado aqui. **Lembrete do próprio task**:
RLS não substitui grants corretos — se o role `anon` tiver `GRANT ALL` na tabela por engano (fora
de RLS), uma policy mal escrita fica pior do que parece. Recomendação: Eduardo rodar
`select grantee, privilege_type from information_schema.role_table_grants where table_name =
'bolao_state';` no SQL Editor do Supabase e colar o resultado (sem credenciais) numa próxima
sessão para fechar esse gap de verificação.

## RLS habilitada? Classificação por tabela

| Tabela | Classificação |
|---|---|
| `public.bolao_state` | **RLS CONFIRMADA MAS PERMISSIVA** — `enable row level security` está no SQL documentado e o comportamento de SELECT foi confirmado empiricamente batendo com a policy (não seria possível ler a tabela sem RLS habilitada E sem a policy — uma tabela sem RLS habilitada normalmente barraria todo acesso `anon` completamente quando RLS existe mas sem policies, ou permitiria tudo se RLS nunca foi habilitada; o resultado observado — leitura das 3 linhas específicas, nada além — é consistente com RLS habilitada + policy exatamente como documentada). A classificação é "permissiva" porque a policy de escrita não distingue propriedade dentro do JSON (ver acima), não porque o escopo de linhas esteja errado. |

Nenhuma outra tabela em `public` é referenciada pelo código do site — não há evidência de outras
tabelas para classificar.
