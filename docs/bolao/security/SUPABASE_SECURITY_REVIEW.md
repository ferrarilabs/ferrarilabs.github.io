# Supabase Security Review — Plataforma Bolão

2026-08-02. Somente leitura. Método: leitura de código (`js/config.js`, `js/app.js`,
`scripts/*.py` dos 3 apps) + leitura de `bolao/copa2026/docs/DATABASE_SETUP_SUPABASE.md` (única
fonte versionada das policies RLS reais — não há `.sql` de migration no repo) + testes passivos
(GET) contra o projeto Supabase real, usando a chave `anon`/`publishable` pública, exatamente como
qualquer visitante do site já faz. Nenhuma escrita foi enviada. Nenhum dado real é reproduzido
neste documento — apenas contagens/estrutura.

## Projeto

- Projeto Supabase (URL): `https://cmhqkkfczotdnssupkni.supabase.co`.
- Chave usada por todo o cliente (3 apps + todos os `scripts/*.py`): `anon`/`publishable`
  (`sb_publishable_9eJs…5`, mascarada). Idêntica nos três `config.js` e em todo script Python.
- **Nenhum `service_role` encontrado em nenhum lugar do repositório** (código, docs, git
  history) — busca detalhada em `docs/bolao/security/SECURITY_ASSESSMENT_REPORT.md` seção
  "Chaves encontradas". Este é o achado mais importante desta seção: **não há segredo
  privilegiado exposto**.
- Tipo de chave: formato novo do Supabase (`sb_publishable_…`), não o JWT legado
  (`eyJhbGci…`). Teste empírico confirmou que esse tipo de chave **não** dá acesso ao endpoint de
  introspecção OpenAPI (`GET /rest/v1/` sem tabela) — a API responde
  `{"message":"Secret API key required","hint":"Only secret API keys can be used for this
  endpoint."}` (HTTP 401). Isso é uma melhoria de postura da própria Supabase (chaves
  publishable mais novas não permitem mais dump de schema), não algo configurado por este repo.

## Tabelas chamadas pelo cliente

| Tabela | Schema | Usada por | Colunas selecionadas | Filtros observados no código |
|---|---|---|---|---|
| `bolao_state` | `public` | Os 3 apps (`js/app.js`) + todo `scripts/*.py` | `id`, `state` (jsonb), `updated_at` — leitura de `select=*` no código (`loadRemoteState`) | `?id=eq.main` (Copa), `?id=eq.br2026` (BR2026), `?id=eq.cdb2026` (CDB2026) — cada app só filtra pela própria linha **na aplicação**, não é um limite imposto pelo servidor (ver "RLS" abaixo) |

Nenhuma outra tabela é referenciada em nenhum `js/app.js` ou `scripts/*.py` dos três apps.

## Métodos HTTP observados no código-fonte (não executados nesta auditoria, exceto GET)

| Método | Onde | Efeito |
|---|---|---|
| `GET .../bolao_state?id=eq.<id>&select=*` | `loadRemoteState()` (JS) e todo script Python de leitura (`backup.py`, `send_result_email.py --auto`, `auto_reopen.py`) | Lê a linha inteira |
| `POST .../bolao_state` com `Prefer: resolution=merge-duplicates` | `saveRemoteState()` (JS), `send_result_email.py`/`send_round_email.py` (grava resultado + envia e-mail) | Upsert da linha inteira (cria se não existir, substitui se existir) |
| (Nenhum `DELETE` encontrado) | — | A "limpar todos os dados" do admin faz `POST`/upsert com um objeto de estado vazio, não `DELETE` da linha — confirmado lendo `renderAll`/admin handlers; a linha em si nunca é deletada pelo app |

## RLS — o que está documentado como fonte da verdade

Não existe RLS policy versionada como `.sql` de migration neste repo — a única fonte é
`bolao/copa2026/docs/DATABASE_SETUP_SUPABASE.md`, que documenta o SQL que **deveria** ter sido
rodado manualmente no SQL Editor do Supabase (fora deste repositório). Texto relevante
(reproduzido de `DATABASE_SETUP_SUPABASE.md`, seção "Múltiplos apps na mesma tabela",
2026-07-13):

```sql
alter table public.bolao_state enable row level security;

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

Nenhuma policy de `delete` é documentada em lugar nenhum do repo — se existe uma no banco real,
não está versionada aqui (gap de governança, ver `SECURITY_BASELINE_FOR_FUTURE_POOLS.md`).

**Constraint de tabela** (mesmo arquivo): `id` até 50 caracteres, `state` até 1 MB
(`pg_column_size(state) < 1048576`).

## Teste passivo real (2026-08-02, leitura, chave anon pública)

Executado via `curl`, só `GET`, headers `apikey`/`Authorization: Bearer` com a chave anon já
pública no bundle do navegador — exatamente o que qualquer visitante do site já pode fazer sem
nenhuma ferramenta especial.

| Teste | Resultado |
|---|---|
| `GET /rest/v1/bolao_state?select=*` sem nenhum header de chave | HTTP 401 — bloqueado |
| `GET /rest/v1/bolao_state?select=*` com `apikey` (sem `Authorization`) | HTTP 200 — **retornou as 3 linhas completas** (`main`, `br2026`, `cdb2026`), ~184 KB |
| `GET /rest/v1/bolao_state?select=*` com `apikey` + `Authorization: Bearer <anon>` | HTTP 200 — mesmo resultado (idêntico ao anterior; `Authorization` não muda o comportamento com este tipo de chave) |
| `GET /rest/v1/bolao_state?id=eq.main&select=id,updated_at` | HTTP 200 — 1 linha, campos pedidos |
| `GET /rest/v1/bolao_state?id=eq.doesnotexist12345&select=*` | HTTP 200, corpo `[]` — nenhuma diferença de erro/tamanho que permita enumerar ids válidos vs. inválidos além dos 3 já públicos por design |
| `GET /rest/v1/` (introspecção OpenAPI, schema completo) com `apikey` | HTTP 401, `"Secret API key required"` — bloqueado pela própria Supabase para este tipo de chave |

**Confirmação empírica**: a policy de `select` documentada (`using (id in ('main', 'br2026',
'cdb2026'))`) está de fato ativa e se comporta exatamente como escrita — **uma única consulta
sem filtro de `id` retorna as três linhas completas dos três apps de uma vez**, não apenas a
linha do app que originou a chamada. Isso **não é uma descoberta de bug novo** — é o
comportamento documentado e intencional (`PROJECT_MEMORY.md`: "é um bolão público e
transparente"; `SECURITY.md`: "Anyone with the site URL can read/write the bolão state. This is
intentional"). O que esta auditoria acrescenta é a confirmação empírica de um detalhe que não
estava testado explicitamente antes: a exposição **atravessa a fronteira entre os três
aplicativos** — um visitante que só conhece a URL do BR2026 (não publicado) pode, com uma única
chamada REST direta (não pelo app, que sempre filtra por `id`), ler o estado completo da Copa e
do CDB2026 também, incluindo nome/e-mail/método de pagamento/diagnóstico de dispositivo de todos
os participantes dos três bolões — não só do bolão que ele está visitando. Ver
`API_RESPONSE_DATA_REVIEW.md` e `ENUMERATION_REVIEW.md` para o detalhamento desse achado e
`SECURITY_RISK_MATRIX.md` RM-006/RM-007 para a classificação de risco.

**Escrita não foi testada em produção** (proibido pelo escopo desta auditoria). Com base
apenas na policy documentada acima, o papel `anon` também tem `insert`/`update` para os mesmos
três `id`s — ou seja, o mesmo público de leitura tem, em teoria, permissão de escrita na mesma
linha inteira. Ver `RLS_POLICY_MATRIX.md` e a seção "Limitação da linha JSON única" abaixo.

## Papéis efetivos

- **`anon`**: usado por todo navegador e por todo `scripts/*.py` (os scripts Python **não** usam
  uma chave de serviço separada — usam a mesma chave publishable que o navegador, ver
  `SESSION_AND_TOKEN_SECURITY.md`). Tem select/insert/update nos 3 `id`s conhecidos, conforme a
  policy documentada.
- **`authenticated`**: não utilizado — não há Supabase Auth em nenhum dos 3 apps, não existe
  login de usuário real, apenas a senha admin client-side (ver seção "Administração
  client-side" no relatório consolidado).
- **`service_role`**: não utilizado em nenhum lugar (confirmado por busca de código e por não
  haver nenhuma chamada fora do padrão `apikey: sb_publishable_...` em todo o repo).

## Limitação da linha JSON única

O modelo `bolao_state` é **um documento JSON grande por linha**, com uma policy que autoriza
`update`/`insert` do papel `anon` na linha inteira. Isso significa que **o mesmo cliente que
precisa gravar sua própria entrada de palpite (`entries[]`) tecnicamente tem, ao nível do banco,
o mesmo poder de gravar qualquer outra propriedade do mesmo documento** — resultado oficial
(`results`), pagamento (`paid`), audit log (`auditLog`), cutoff (`cutoffAt`/`phases[].cutoffAt`),
confrontos (`phases[].ties` no CDB2026), tombstones de exclusão (`deletedIds`) e entradas de
terceiros. A defesa real hoje **não é o banco — é o código do app**: o `app.js` de cada bolão só
constrói e envia payloads específicos (nunca deixa o participante editar `results`/`paid`
diretamente pela UI), e o merge-before-save (`mergeStates()`) tenta reconciliar em vez de
sobrescrever cegamente. Mas qualquer cliente HTTP direto (fora do `app.js`, ex.: um script, o
DevTools, ou um `curl`/Postman) que envie um `POST`/upsert bem formado para
`.../bolao_state?id=eq.main` **não é impedido pelo RLS** de substituir o documento inteiro,
incluindo `results`/`paid`/`auditLog` — só o filtro de `id` (`in ('main','br2026','cdb2026')`) é
verificado pelo banco, nada mais granular.

Classificação (OWASP API Security):

| Categoria | Aplica-se? | Nota |
|---|---|---|
| Broken Object Level Authorization (BOLA) | Parcial | O "objeto" aqui é a linha inteira (`id`), corretamente limitada a 3 valores — não há BOLA entre linhas de outros ids fora desse conjunto. Mas não há isolamento por participante dentro da mesma linha. |
| Broken Object Property Level Authorization (mass assignment de propriedade) | **Sim** | Um `insert`/`update` autorizado na linha não distingue propriedades administrativas (`results`, `paid`, `auditLog`) de propriedades de participante (`entries[]` do próprio autor) — é o achado central desta seção. |
| Broken Function Level Authorization | **Sim** | Não existe, ao nível de banco, uma "função" de submissão de palpite distinta de uma "função" de gravação de resultado oficial — ambas são o mesmo `update` de linha. A separação de função só existe no client-side `app.js` (gate de UI + `guardAdmin()`), nunca reforçada pelo servidor. |
| Mass Assignment | **Sim** | Consequência direta do ponto acima — um payload malicioso poderia, em teoria, incluir campos além dos que o formulário do participante deveria gerar. |
| Excessive Data Exposure | **Sim** | Ver `API_RESPONSE_DATA_REVIEW.md` — o `select=*` devolve e-mail, nome do pagador, método de pagamento, diagnóstico de dispositivo e audit log completo para qualquer leitor. |

Esses riscos **são consistentes com o modelo de produto já documentado e aceito** ("bolão
informal, transparente, sem servidor próprio") — não são uma falha de configuração inesperada.
O que esta auditoria contribui é (a) confirmação empírica de leitura, (b) análise explícita de
escrita por análise de policy/código (não execução), e (c) uma proposta de arquitetura
incremental para reduzir a superfície — ver `docs/bolao/adr/ADR-006-supabase-rls-hardening-and-future-architecture.md`.

## RLS sozinha é suficiente? (resumo — detalhe completo no ADR-006)

O que RLS **protege hoje**: acesso a linhas fora do conjunto `('main','br2026','cdb2026')` —
nenhuma outra linha/tabela é alcançável com a chave anon.

O que RLS **não resolve** no modelo atual: separação entre campo admin e campo participante no
mesmo documento JSON (mass assignment), transições de estado válidas (ex.: um resultado só pode
mudar de "não definido" para "definido", nunca ser apagado por um update comum — hoje isso não é
garantido pelo banco), segregação de funções (participante vs. admin), trilha de auditoria
imutável (`auditLog` está dentro do mesmo JSON mutável — um `update` malicioso poderia apagá-lo),
senha admin client-side (RLS não sabe quem é "admin" — não há conceito de admin no banco),
concorrência (dois `update`s simultâneos competem por `merge-before-save`, mas nada no banco
impede um "last write wins" bruto se o merge do cliente for pulado), e dupla aprovação para
ações sensíveis (não existe).

Alternativas de curto prazo e a proposta de arquitetura de médio prazo estão detalhadas no ADR
`docs/bolao/adr/ADR-006-supabase-rls-hardening-and-future-architecture.md` — não implementadas
nesta tarefa (somente leitura/documentação, conforme escopo).

## Supabase Security Advisor

Não verificado — esta sessão não tem acesso ao dashboard do Supabase (limitação documentada, não
contornável de forma somente-leitura/passiva a partir do repositório). Recomendação para Eduardo:
abrir **Supabase Dashboard → Advisors → Security Advisor** no projeto
`cmhqkkfczotdnssupkni` e revisar, no mínimo: tabelas sem RLS habilitada, funções
`security definer`, `search_path` mutável em funções, extensões desnecessárias, "leaked password
protection" (não aplicável — não há Supabase Auth em uso), e policies permissivas sinalizadas
automaticamente. Nenhum resultado foi inventado aqui — esta seção documenta apenas a limitação e
os passos para o Eduardo rodar depois.
