# FASE 0 — Gates obrigatórios de backup e restore

> **Nenhuma implementação de modernização pode ser autorizada antes que os oito
> gates abaixo estejam aprovados.** Isto é um bloqueador duro, não uma
> recomendação. Vale para DDL, migration, backfill, e para qualquer alteração de
> RLS ou policy.

## Por que este é o gate mais importante

Três observações do repositório:

1. `docs/bolao/CDB2026_BACKUP_AND_RECOVERY.md:36` — *"Nenhum procedimento
   documentado ou script testa 'pegar um backup e restaurá-lo' de ponta a ponta."*
   **Nenhuma evidência de restore executado foi encontrada no repositório.**
2. A documentação e o código se contradizem sobre a existência de backup automático
   (D-08): a doc afirma que não há rotina; `bolao/copa2026/scripts/backup_daily.py`
   existe, com `RETAIN_DAYS = 60`, e **nenhum workflow o invoca**.
3. `bolao/br2026/js/app.js:2785` e `bolao/cdb2026/js/app.js:3830` emitem `DELETE` da
   linha inteira com a chave pública. **O cliente emite a operação; a autorização real
   depende de grants e policies ainda não verificados** (D-02) — o que significa que
   nem sequer se sabe se essa via de perda está aberta ou fechada.

Um backup sem restore comprovado não é um backup — é um arquivo. E os quatro
bolões pagam prêmio em dinheiro real. Note que o item 3 não precisa estar confirmado
para justificar os gates: a incerteza sobre a via de perda é, ela própria, motivo para
exigir backup verificado antes de qualquer mudança.

---

## Os oito gates

### G1 · Identificar o mecanismo de backup gerenciado

Determinar, com evidência do painel: se PITR está habilitado, qual o plano do
projeto Supabase, qual a janela de retenção efetiva, e se backups diários
gerenciados existem.

**Critério de aceite:** resposta documentada e datada para cada item, com print.
Se PITR não estiver disponível no plano atual, isso vira uma decisão explícita de
custo, não um silêncio.
Depende de: Q8 (`PHASE0_EVIDENCE_GAPS.md`).

### G2 · Backup lógico real e reproduzível, independente do provedor

Um **dump lógico real** que não dependa do painel do Supabase estar acessível.
"Real" aqui é definido por exclusão: um snapshot de linhas obtido pela API REST com a
chave pública **não** é um backup lógico.

O backup se divide em **três componentes distintos**, com estatutos distintos. Tratar
os três como um só é o erro que faz um restore falhar no pior momento.

#### G2.a · `DATABASE_DUMP`

`pg_dump` com **schema + dados + objetos da aplicação**: tabelas, constraints,
índices, sequences, tipos/enums, views, materialized views, functions, triggers,
policies RLS e grants sobre objetos da aplicação.

#### G2.b · `GLOBALS_DUMP`

`pg_dumpall --globals-only` — roles, atributos de role e grants de nível de cluster —
**quando permitido e aplicável**. Em Postgres gerenciado, esse comando pode ser
recusado por falta de privilégio de superusuário. Se for recusado, isso é um **achado a
registrar**, não uma etapa a pular em silêncio: significa que parte do estado de
autorização não está no seu backup.

#### G2.c · `PROVIDER_MANAGED_OBJECTS`

Objetos que o Supabase cria e mantém — roles internas (`anon`, `authenticated`,
`service_role`, roles de replicação e de administração), schemas de plataforma
(`auth`, `storage`, `realtime`, `extensions`, `vault`, `graphql`), extensões e a
configuração do próprio serviço.

Devem ser **inventariados e documentados separadamente** do dump da aplicação. E vale
a advertência explícita: **não presumir que roles internos do Supabase possam ser
restaurados literalmente.** Eles pertencem à plataforma, podem ter atributos não
exportáveis, e um restore num projeto novo os recria à sua maneira. Um plano de
recuperação que assume clonagem literal desses roles falha na hora do incidente.

**Critério de aceite do G2:**

- `DATABASE_DUMP` gerado, cobrindo **todos** os schemas de aplicação e **todas** as
  tabelas — não um subconjunto escolhido a mão;
- `GLOBALS_DUMP` gerado, **ou** registrada por escrito a razão de não ser possível e o
  que fica descoberto por causa disso;
- `PROVIDER_MANAGED_OBJECTS` inventariados e documentados **em separado**, com
  indicação explícita do que é responsabilidade do provedor e do que não é portável;
- o procedimento restaura **os objetos da aplicação** e, junto deles, **policies,
  functions, triggers e grants da aplicação** — um restore que traz só as linhas de
  volta deixa o sistema sem autorização e é uma falha, não um sucesso parcial;
- **nenhuma promessa de clonagem literal de roles internos não portáveis** aparece no
  procedimento; onde houver dependência desses roles, ela é declarada como premissa do
  ambiente de destino;
- gerado com credencial de privilégio adequado (não a publishable key);
- contagem de linhas por tabela registrada no momento da geração;
- procedimento **reproduzível e documentado**, executável por mais de uma pessoa;
- não depende de credencial que só uma pessoa tenha.

#### O que `bolao/copa2026/scripts/backup_daily.py` é — e por que não passa neste gate

Registrado explicitamente para que não volte a ser tratado como o backup do sistema:

- é **snapshot parcial de três blobs `bolao_state`** (`select=state` para `main`,
  `br2026`, `cdb2026`);
- usa a **publishable key** — captura apenas o que as policies expõem à role `anon`;
- **não inclui schema**;
- **não inclui constraints**;
- **não inclui RLS/policies**;
- **não inclui grants, functions, triggers, sequences ou roles**;
- **não inclui as tabelas do modelo 2** (`users`, `bolao_types`,
  `user_bolao_participation`, `audit_log`, `email_log`);
- **não inclui tabelas `lottery_*`**;
- **não pode satisfazer o gate G2**;
- **pode existir apenas como proteção suplementar** — útil para reverter um estado de
  app corrompido, inútil para reconstruir o banco.

**Resolver junto:** D-08 — decidir se `backup_daily.py` permanece como proteção
suplementar (e então agendá-lo de verdade, documentar o agendamento e corrigir
`docs/bolao/CDB2026_BACKUP_AND_RECOVERY.md`) ou se é código morto a remover. Em
nenhuma das hipóteses ele fecha G2: o backup lógico real precisa ser escrito de
qualquer forma.

### G3 · Criptografia e armazenamento do dump

O dump contém PII: e-mails, telefones, IPs, referências de pagamento.

**Critério de aceite:** cifrado em repouso; guardado fora do repositório e fora do
diretório de trabalho; chave de decifração custodiada separadamente do dump;
retenção do próprio dump definida. Um dump em claro em `~/Downloads` reprova.

### G4 · Validação do dump

Um arquivo que existe não é um arquivo íntegro.

**Critério de aceite:** checksum registrado; o dump abre e é parseável; contagem
de linhas por tabela confere com o registrado em G2; nenhum truncamento silencioso.

### G5 · Restore em ambiente isolado

Restaurar num projeto/instância **separado**, jamais em produção.

**Critério de aceite:** restore concluído num ambiente descartável; o ambiente não
compartilha credencial, URL nem chave com produção; tempo de execução medido (é a
entrada para o RTO em G7).

### G6 · Reconciliação de contagens e constraints

**Critério de aceite:** contagem por tabela idêntica à origem; todas as chaves
primárias, únicas e estrangeiras válidas após o restore; **nenhuma policy RLS perdida
no caminho, e `relrowsecurity`/`relforcerowsecurity` conferidos por relação** —
restaurar as policies sem reabilitar a RLS deixa a tabela aberta com aparência de
protegida; functions, triggers e grants da aplicação presentes e com o mesmo
`security_definer`, owner e `search_path` da origem; para `bolao_state`, o JSONB
restaurado é parseável e o app carrega contra ele.

Divergências atribuíveis a `PROVIDER_MANAGED_OBJECTS` (G2.c) são registradas como
diferença esperada, com justificativa — não como reconciliação bem-sucedida.

Este último ponto é o que realmente importa no modelo atual: como todo o estado é
um único documento, um restore parcial é indistinguível de um restore correto até
alguém abrir o app.

### G7 · RPO e RTO definidos e aceitos

**RPO** — quanto dado se aceita perder. Hoje, sem backup verificado, o RPO real é
desconhecido e possivelmente total.
**RTO** — em quanto tempo o serviço volta. Medido em G5, não estimado.

**Critério de aceite:** ambos escritos, com número, e explicitamente aceitos pelo
Eduardo. Considerar que durante rodadas e sorteios a tolerância é muito menor —
pode ser necessário um RPO diferente em janela de evento.

### G8 · Rollback testado

Para cada migração que vier a ser proposta, um caminho de volta exercitado — não
descrito.

**Critério de aceite:** o rollback foi executado no ambiente isolado de G5 e o
sistema voltou ao estado anterior verificável; o procedimento está escrito; existe
um critério objetivo de quando acioná-lo (não "se der problema").

---

## Sequência

```
G1 ─→ G2 ─→ G3 ─→ G4 ─→ G5 ─→ G6 ─→ G7 ─→ G8 ─→ [ modernização liberada ]
```

Nenhum gate é pulável. Se um falhar, a fase para ali — não se contorna com uma
observação no changelog.

---

## Riscos operacionais a mitigar antes ou junto dos gates

| Risco | Origem | Mitigação candidata |
|---|---|---|
| Perda total de um bolão — o cliente emite `DELETE` com a chave pública; a autorização real depende de grants e policies ainda não verificados | D-02 | primeiro **ler** a policy e os grants (Q9, Q11); depois, conforme o resultado, remover o `DELETE` do cliente e/ou exigir privilégio de servidor |
| Lost update silencioso | D-05 | CAS com política de rejeição/retry — ver DEC-07; detectar não é resolver |
| Teto de 1 MB por linha de `bolao_state` | `check (pg_column_size < 1048576)` no DDL documentado | medir o tamanho atual (Q15) antes de qualquer coisa |
| Auditoria truncada em 200 entradas | D-04 | eventos descartados não são recuperáveis de backup nenhum |

O último merece ênfase: **backup não recupera o que nunca foi gravado.** As
entradas de auditoria descartadas pelo truncamento em
`bolao/copa2026/js/app.js:255-260` e `3212` não têm de onde ser recuperadas, e nenhum
gate desta lista as traz de volta.

---

## Estado atual dos gates

| Gate | Estado |
|---|---|
| G1 | ❌ não iniciado — depende da Fase 1 |
| G2 | ❌ **não atendido** — nenhum dos três componentes existe: sem `DATABASE_DUMP`, sem `GLOBALS_DUMP`, sem inventário de `PROVIDER_MANAGED_OBJECTS`. `backup_daily.py` é snapshot parcial de blob com chave pública e não satisfaz nenhum deles, esteja ou não agendado |
| G3 | ❌ não iniciado |
| G4 | ❌ não iniciado |
| G5 | ❌ nenhuma evidência de restore executado foi encontrada no repositório |
| G6 | ❌ não iniciado |
| G7 | ❌ RPO e RTO indefinidos |
| G8 | ❌ não aplicável ainda (não há migração proposta) |

**Conclusão: nenhuma implementação de modernização está autorizada.**
