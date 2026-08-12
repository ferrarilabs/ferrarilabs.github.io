# FASE 0 — Divergências e fontes de verdade em conflito

Severidade: **P0** = risco de exposição de dado ou perda de dinheiro/registro ·
**P0-CANDIDATE** = *seria* P0 se a evidência de produção confirmasse a premissa ·
**P1** = risco de corrupção de dado ou decisão errada · **P2** = dívida estrutural.

> **Recalibração registrada.** Antes de evidência de produção, nenhum item deste
> documento pode ser P0. D-01 e D-02 dependem inteiramente de qual policy e quais
> grants estão de fato em vigor — coisa que esta fase não observou. Foram rebaixados a
> `P0-CANDIDATE`. D-03 e D-04 descrevem propriedades do **modelo** (ausência de
> movimento financeiro; auditoria mutável e truncável), não exposição confirmada, e
> foram calibrados como P1.
>
> **A severidade poderá subir após a Fase 1.** Confirmada uma policy permissiva ou um
> grant de `DELETE` a `anon`, D-01 e D-02 passam a P0 imediatamente. `P0-CANDIDATE`
> significa "seria P0 se confirmado", não "é P0", e tampouco "é menos urgente de
> verificar" — são justamente os dois primeiros itens a resolver na Fase 1.

Nenhum item abaixo é uma correção autorizada. São achados. A implementação depende
de aprovação explícita, e dos gates de `PHASE0_BACKUP_GATES.md`.

---

## D-01 · P0-CANDIDATE · PII de participante dentro de blob legível por anon

**Conflito:** `state.entries[].participantEmail` vive dentro de
`public.bolao_state.state` (jsonb). A policy documentada é `allow anon read` sobre
a linha inteira. A própria documentação (`bolao/copa2026/docs/DATABASE_SETUP_SUPABASE.md`)
registra: *"anyone with the site's anon key can read/write the bolão state."*

**Por que é estrutural, não um bug:** a RLS do Postgres opera em nível de linha. Com
um documento por app, não existe granularidade possível — quem pode ler o estado
pode ler todos os e-mails. Nenhuma policy resolve isso sem mudar o modelo. É
exatamente o argumento do ADR-006 (branch `security-review-readonly`).

**Não verificado:** se a policy em produção é de fato permissiva, e quais grants a
acompanham. → Fase 1, Q6 e Q11. É essa verificação que decide entre `P0-CANDIDATE` e
P0.

---

## D-02 · P0-CANDIDATE · O cliente emite `DELETE` do bolão inteiro com a chave pública

`bolao/br2026/js/app.js:2785-2786` e `bolao/cdb2026/js/app.js:3830-3831` emitem
`DELETE /rest/v1/bolao_state?id=eq.<app>` com a chave publishable. Essa chave está
em `js/config.js`, servida publicamente.

O gate é o hash de admin conferido **no navegador** — ou seja, nenhum gate do lado
do servidor. Qualquer pessoa com a chave pública pode emitir a mesma requisição sem
passar pelo app.

**O que isto é e o que não é:** o repositório prova que o *cliente emite* o `DELETE`
com a chave pública. **A autorização real da operação depende de grants e policies
ainda não verificados** — o servidor pode recusar. Afirmar que "a chave pública apaga
o bolão" seria transformar a leitura do cliente em conclusão sobre o servidor.

**Não verificado:** se a role `anon` tem grant de `DELETE` em `bolao_state` e se
alguma policy o permite. → Fase 1, Q9 e Q11, **por leitura de `pg_policies` e de
`information_schema.role_table_grants`, jamais executando a operação.**

---

## D-03 · P1 · Sem partida dobrada; saldo entre sorteios é implícito

Os modelos ativos guardam **totais derivados**, não movimentos:
`finance{totalArrecadado, valorUtilizado, valorGuardadoProximoSorteio,
creditoSorteioAnterior}` por sorteio, e `paid{entryId: bool}` nos apps de futebol.

`creditoSorteioAnterior` aparece só no terceiro sorteio. O encadeamento
sorteio N → N+1 não é verificável: não há registro do movimento que o produziu,
não há reversão, não há reconciliação. Um valor errado não deixa rastro.

`tx_id` — a referência Zelle/Venmo/CashApp que a governança do Powerball exige por
entrada — **não tem coluna em nenhum schema versionado em `main`**. Só aparece no
modelo 3 (`REPO: DOCUMENTATION_ONLY`) e no modelo 4 (`REPO: BRANCH_ONLY`). Hoje vive
na fonte privada fora do repositório (`SECRET_EXISTENCE = UNVERIFIED`).

Este é o item que mais justifica a modernização: os três bolões de futebol e o
Powerball movimentam dinheiro real, e o registro financeiro atual não é auditável.

**Por que P1 e não P0 nesta fase:** é uma propriedade do modelo observável
diretamente no repositório — não depende de evidência de produção e não descreve
exposição de dado nem perda já ocorrida. A severidade sobe se a Fase 1 revelar que o
dado financeiro existente já diverge entre fontes.

---

## D-04 · P1 · Auditoria não é imutável e descarta eventos

`state.auditLog[]` é escrito pelo cliente, e truncado em 200 entradas em dois
pontos: no merge (`bolao/copa2026/js/app.js:255-260`) e na gravação local
(`bolao/copa2026/js/app.js:3212`). Eventos além de 200 **são perdidos
permanentemente**.

Sendo parte do mesmo JSONB que o cliente reescreve inteiro, qualquer cliente pode
reescrever o histórico. O ADR-004 já reconhece a limitação — o que este documento
acrescenta é que a perda por truncamento é silenciosa.

No DDL versionado, `public.audit_log` (modelo 2) tem policy de INSERT concedida à
mesma chave anon, sem role distinta — o "(scripts only)" do nome da policy não é
enforcement. Que essa seja a policy em vigor é `UNVERIFIED` (Q6).

Auditoria encadeada por hash existe só no modelo 4 (`REPO: BRANCH_ONLY`).

**Por que P1 e não P0 nesta fase:** a mutabilidade e o truncamento são observáveis no
código, mas quanto se perdeu de fato — se é que se perdeu — depende do estado real
das linhas, que não foi observado.

---

## D-05 · P1 · Read-modify-write sem CAS → lost update

O ADR-002 documenta a estratégia de merge. Nenhum dos três apps usa versionamento
otimista: lê o estado, funde em memória, reescreve a linha inteira.

Duas abas ou dois admins simultâneos: o último a gravar vence, e a perda é
silenciosa. O cdb2026 mitigou parcialmente com um segundo `SELECT` imediatamente
antes da escrita (`bolao/cdb2026/js/app.js:171`, com comentário explicando o bug do
br2026) — mas isso **estreita a janela, não a fecha**. O br2026 não tem nem isso.

`updated_at` existe na tabela mas não é usado como token de concorrência.

---

## D-06 · P1 · Junção entre dado público e PII feita por nome normalizado

`bolao/loterias/powerball/scripts/email/snapshot.mjs:48` declara
`MATCHING_MODEL = TRANSITIONAL_NAME_BASED`. `normalizeName()` (linhas 49, 78,
99-100) faz trim, colapso de espaços e lowercase, e usa o resultado como chave
para casar `bolao/loterias/powerball/js/data.js` público com o sidecar privado de
e-mails.

Modos de falha: dois participantes homônimos colidem; um acento ou grafia
divergente rompe a junção silenciosamente; renomear alguém quebra o vínculo. O
resultado de uma falha é **e-mail enviado ao destinatário errado ou não enviado**.

O próprio nome da constante admite que é transitório.

---

## D-07 · P1 · Cinco formas de participante, três tipos de chave

UUID de cliente · string de nome · BIGSERIAL · UUID de servidor · nome de exibição
(`bolao/loterias/powerball/scripts/email/outbox.json`, campo `participantId`).
Nenhuma tabela de correspondência entre elas.

Consequência: não existe pergunta respondível do tipo *"quanto esta pessoa pagou,
somando todos os bolões"*. Não há identidade de participante na plataforma.

Divergência de tipo associada: `data`/`hora` como strings pt-BR livres
(`"31/07/2026"`, `"4:52:51 PM"`) contra `createdAt` ISO contra `TIMESTAMP`.

---

## D-08 · P1 · Backup: documentação contradiz o código

| Fonte | Afirma |
|---|---|
| `docs/bolao/CDB2026_BACKUP_AND_RECOVERY.md:31` | *"**Backup automático agendado do Supabase.** Não há nenhuma rotina (`cron`, Supabase scheduled…)"* — e diz que isso foi *"Confirmado por ausência de qualquer script de agendamento no repositório"* |
| `bolao/copa2026/scripts/backup_daily.py` | Existe. `RETAIN_DAYS = 60` (linha 44). Poda backups antigos (128). Cobre `cdb2026` explicitamente. Docstring afirma *"Roda via cron a 01:00 AM EDT"*. |

Verificado nesta fase: **nenhum arquivo em `.github/workflows/` referencia
`backup.py` ou `backup_daily.py`**. Logo o script é `CODE_PRESENT_NOT_REFERENCED` no
repositório. Se existe um cron de máquina fora do repositório executando-o é
`UNVERIFIED` — e é exatamente isso que decide qual das duas fontes está errada.

Registro adicional, independente da contradição: mesmo que o cron exista e rode,
`backup_daily.py` **não pode satisfazer o gate G2** — é snapshot parcial de três blobs
`bolao_state` obtido com a publishable key, sem schema, constraints, RLS/policies,
grants, functions, triggers, sequences, roles, sem as tabelas do modelo 2 e sem
`lottery_*`. Ver `PHASE0_INVENTORY.md` §13.1 e `PHASE0_BACKUP_GATES.md` G2.

**Ambas as fontes concordam num ponto:** `docs/bolao/CDB2026_BACKUP_AND_RECOVERY.md:36`
— *"Nenhum procedimento documentado ou script testa 'pegar um backup e restaurá-lo' de
ponta a ponta."* **Nenhuma evidência de restore executado foi encontrada no
repositório.** Ver `PHASE0_BACKUP_GATES.md`.

---

## D-09 · P1 · Retenção documentada não é implementada

`bolao/loterias/powerball/docs/AUDIT_LOGGING.md` §Retention promete: audit 7 anos
*("legal requirement")*, e-mail 2 anos, logs locais indefinidamente.

**Nenhum código versionado implementa purga, TTL ou arquivamento.** Não há job, não há
policy, não há coluna de expiração no DDL versionado. Se existe algum mecanismo de
retenção criado diretamente no banco, é `UNVERIFIED` (Q7). A promessa de 7 anos é, hoje, apenas texto — e
uma promessa de retenção não cumprida é pior que nenhuma promessa, porque é citada
como controle.

---

## D-10 · P1 · Três histórias de schema mutuamente inconsistentes para o Powerball

O mesmo domínio descrito de três maneiras incompatíveis: modelo 2 (`users` +
`user_bolao_participation`, o único DDL de `main`), modelo 3 (`powerball_*`, só
markdown), modelo 4 (`lottery_*`, só branch).

Os scripts do Powerball leem participantes de uma forma que o modelo 2 define, mas
o modelo 2 não tem `valor`, `metodo`, `tx_id`, sorteio, bilhete nem resultado — que
são exatamente os dados que o `bolao/loterias/powerball/js/data.js` carrega. Ou seja: **o schema versionado não
comporta o dado que o sistema realmente manipula.**

---

## D-11 · P2 · Geradores de página pública não têm gate de PII

`bolao/copa2026/scripts/generate_audit_report.py` e
`bolao/copa2026/scripts/generate_classificacao_geral.py` geram
`bolao/copa2026/audit-report.html`, `bolao/copa2026/audit-detail-picks.html`,
`bolao/copa2026/audit-detail-governance.html` e
`bolao/copa2026/classificacao-geral.html` a partir do estado dos participantes. Essas
páginas são servidas publicamente e foram enviadas por e-mail a participantes reais.

**Correção do achado.** Uma redação anterior afirmava que essas páginas não eram
cobertas pelo scanner de PII. Isso estava errado: os quatro arquivos são rastreados e
`scripts/audit_pii_repo_wide.mjs` os enumera via `git ls-files`. O achado real é
outro, e permanece válido:

- **os geradores não possuem gate específico antes de escrever os arquivos** — a
  detecção existe, mas é posterior à escrita e ao commit, não preventiva;
- nenhum detector reconhece **nome de pessoa**, que é justamente o que essas páginas
  publicam por natureza.

Inspeção estática executada nesta fase (`PHASE0_PII_MAP.md` §5): os quatro HTMLs não
contêm e-mail, referência de transação nem material de chave. A parte detectável está
limpa; a parte não detectável é a decisão DEC-06.

---

## D-12 · P2 · Chave JWT legada malformada em dois scripts

`bolao/loterias/powerball/scripts/add_participant_to_supabase.py:13` e
`bolao/loterias/powerball/scripts/send_result_email.py:62` carregam uma string no formato
header/payload de JWT com a chave publishable colada no lugar da assinatura.
Provavelmente não autentica. Se não autentica, o caminho
`load_participants_from_supabase` **falha silenciosamente e cai no fallback** do
secret — o que significa que o Supabase pode não estar sendo usado de fato pelo
Powerball, apesar do código sugerir que está.

Isso muda a interpretação do modelo 2: seu `PRODUCTION_STATE` pode vir a ser
`CONFIRMED_ABSENT` ou `PRESENT_USAGE_UNKNOWN` em vez de um sistema vivo.
→ Fase 1, Q3 e Q10.

---

## D-13 · P2 · Powerball não usa banco no frontend

O frontend do Powerball é 100% `bolao/loterias/powerball/js/data.js` +
`localStorage`. Cada novo participante é um **commit no repositório** (os 3 commits
mais recentes de `data.js` em `origin/main` são exatamente isso).

Consequência de governança: dado de participante entra no histórico do git para
sempre. A remoção de PII feita no hotfix P0.1 limpa o estado atual do commit — não
prova que o artefato live reflete a remoção (`LIVE_SITE_PII = UNVERIFIED`,
`PHASE0_PII_MAP.md` §0) e **não limpa o
histórico**.

---

## D-14 · P2 · Duplicação de configuração entre os quatro apps

`adminPasswordHash` idêntico, `publicKey` do EmailJS idêntico, `adminEmail`
idêntico, copiados nos quatro `js/config.js`. Um mesmo hash de admin protege os
quatro bolões — comprometer um compromete todos.

Fora do escopo de banco, mas é a mesma raiz: não há noção de identidade nem de
papel na plataforma.

---

## Resumo por severidade

Severidade **antes** de evidência de produção:

| Severidade | Itens |
|---|---|
| P0 | *(nenhum — nenhum P0 é atribuível sem evidência de produção)* |
| P0-CANDIDATE | D-01 (PII em blob legível por anon), D-02 (cliente emite `DELETE` com chave pública) |
| P1 | D-03 (financeiro não auditável), D-04 (auditoria mutável e truncada), D-05 (lost update), D-06 (matching por nome), D-07 (identidade fragmentada), D-08 (backup contraditório), D-09 (retenção não implementada), D-10 (schema não comporta o domínio) |
| P2 | D-11 (geradores sem gate de PII), D-12 (chave malformada), D-13 (participante via commit), D-14 (config duplicada) |

**A severidade poderá subir após a Fase 1.** Gatilhos explícitos de promoção:

| Item | Sobe para P0 se a Fase 1 confirmar |
|---|---|
| D-01 | policy de `SELECT` em `bolao_state` acessível a `anon`, com PII presente nas linhas (Q2, Q6, Q10) |
| D-02 | grant de `DELETE` a `anon` em `bolao_state` **e** policy que o permita (Q9, Q11) |
| D-03 | divergência de valor entre fontes financeiras, ou dinheiro não reconciliável |
| D-04 | perda de evento de auditoria com consequência financeira |

O caminho inverso também vale: confirmada uma policy restritiva, D-01 e D-02 caem
para P2 como dívida de desenho (defesa em profundidade ausente no cliente), não como
exposição.
