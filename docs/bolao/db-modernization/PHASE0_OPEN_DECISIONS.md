# FASE 0 — Decisões arquiteturais em aberto

**Nenhuma decisão foi tomada.** Nenhuma arquitetura foi escolhida ou aprovada.
Este documento apresenta as escolhas que a Fase 4 precisará fazer, com trade-offs
e com a evidência que cada uma exige antes de ser decidível.

Onde há recomendação, ela está marcada como **inclinação**, não como decisão.

---

## Princípios candidatos (a validar com o Eduardo, não impostos)

1. **O dinheiro é auditável.** Todo valor exibido deve ser reconstruível a partir
   de movimentos registrados, não guardado como total.
2. **PII não trafega por audiência pública.** O que é público é público por
   construção do schema, não por disciplina de quem escreve o código.
3. **A auditoria não é reescrevível pelo cliente.**
4. **Nenhuma migração antes de restore testado.** Ver `PHASE0_BACKUP_GATES.md`.
5. **Diferenças de torneio são preservadas.** Scoring, bracket e regra de avanço
   permanecem específicos por app (regra de governança já vigente no CLAUDE.md).
6. **Patch mínimo e reversível continua valendo** — inclusive para banco.

---

## Domínios candidatos (fronteiras possíveis, não aprovadas)

| Domínio | Entidades | Observação |
|---|---|---|
| Identidade | pessoa, contato, consentimento | hoje inexistente; é a raiz de D-06 e D-07 |
| Competição | bolão/pool, temporada, rodada/fase, confronto/sorteio | 4 formas hoje, todas incompatíveis |
| Participação | inscrição, cotas, palpites/bilhetes | palpites são específicos por torneio |
| Financeiro | movimento, cota, ajuste, saldo, referência de transação | o mais crítico (D-03) |
| Resultado & Pontuação | resultado oficial, versão de regra, pontuação apurada | ADR-003 e ADR-005 já existem |
| Notificação | evento, job, entrega | modelo 5 é a proposta mais madura |
| Auditoria | trilha imutável | modelo 4 é a única proposta tamper-evident |
| Publicação | projeções públicas, snapshots estáticos | separa audiência |

---

## DEC-01 · Documento JSONB vs. relacional

| Opção | A favor | Contra |
|---|---|---|
| **A. Manter `bolao_state`** | zero migração; local-first funciona; nenhum risco imediato | não resolve D-01, D-03, D-04, D-05; teto de 1 MB; sem histórico |
| **B. Relacional por domínio** | endereça D-01 a D-04 de uma vez | migração grande; muda o modelo local-first dos 3 apps |
| **C. Híbrido** — relacional para dinheiro, PII e auditoria; JSONB para palpites e estado de UI | endereça D-01 a D-04 com blast radius menor; palpites realmente variam por torneio | duas fontes coexistindo por um período; exige regra clara de fronteira |

**Inclinação:** C. O que precisa de constraint, histórico e controle de audiência
é justamente o subconjunto que hoje está no lugar errado — palpites e estado de UI
não precisam disso.
**Evidência necessária:** Q2, Q15 (tamanho das linhas), Q6 (policies reais).

---

## DEC-02 · O que fazer com os modelos 2, 3, 4 e 5

| Opção | Descrição |
|---|---|
| A | Descartar tudo e desenhar do zero |
| B | Adotar o modelo 4 (`lottery_*`) como base para loterias e o 5 para notificações, após revisão formal |
| C | Extrair princípios dos 4 e 5 (RLS deny-by-default, escrita via RPC, transação financeira, auditoria hash-chained, fila com `SKIP LOCKED`) sem herdar o schema |

**Inclinação:** B para o modelo 5 (é auto-contido, resolve uma lacuna real e não
toca em dado existente) e C para o modelo 4 (o desenho é bom, mas 33 commits não
revisados não devem virar fundação por inércia).
**Evidência necessária:** Q4, Q5 — se essas tabelas já existirem em produção, o
quadro muda completamente. Existe um relato de sessão externa anterior sobre criação
de tabelas `lottery_*` (`PHASE0_INVENTORY.md` §19.3); ele
`REQUIRES_PHASE1_RECONFIRMATION` e **não** deve ser usado como substituto da inspeção
de catálogo ao decidir este item.
**Decisão adicional:** o modelo 3 é `DOCUMENTATION_ONLY` e inviável (sem Auth).
Recomendo marcá-lo como obsoleto na própria doc, para não voltar a confundir.

---

## DEC-03 · Autenticação de participante

Hoje não existe. O "admin" é hash SHA-256 conferido no navegador. Sem Auth:
- não há `PARTICIPANT_SELF` como audiência;
- RLS não consegue distinguir participantes;
- o modelo 3 é inaplicável;
- toda proteção real precisa acontecer via RPC com segredo de servidor, ou fora do banco.

> **Restrição de hospedagem — determinante para este DEC.** A plataforma é servida por
> **GitHub Pages: hospedagem estática, sem servidor de aplicação**. Um segredo de
> servidor **não pode existir no GitHub Pages** — tudo o que a página carrega é
> público por construção, e nenhum artifício de ofuscação muda isso.
>
> Consequência: **RPC com segredo exige backend ou Edge Function.** "Proteger via RPC"
> não é uma mudança apenas de banco; introduz um componente de execução que hoje a
> plataforma não tem (Supabase Edge Function, ou qualquer backend próprio), com
> custo, deploy, observabilidade e superfície de ataque próprios.

| Opção | Consequência |
|---|---|
| A. Sem Auth, admin via RPC com segredo de servidor | **inviável sem introduzir backend ou Edge Function** — o segredo não tem onde morar no GitHub Pages. Não é a "menor mudança": é uma nova dependência de infraestrutura |
| B. Supabase Auth só para admin | endereça D-02 e D-04 sem exigir componente de execução próprio — o token vem do Auth, não de um segredo embutido; participante segue sem login |
| C. Auth para todos | resolve `PARTICIPANT_SELF`; muda o produto — hoje se entra num bolão por e-mail, sem cadastro |

**Inclinação:** B. Endereça os itens de admin sem transformar o produto **e sem
introduzir um componente de execução novo**. A é registrada, não descartada — mas
precisa ser lida com sua dependência de infraestrutura explícita, não como a opção
barata. C é uma decisão de produto, não de banco, e deve ser tratada como tal.

---

## DEC-04 · Modelo financeiro

| Opção | A favor | Contra |
|---|---|---|
| A. Manter totais | nada muda | D-03 permanece; sem reversão, sem reconciliação |
| B. Livro de movimentos (append-only, com estorno explícito) | reconstrói qualquer saldo; auditável; `creditoSorteioAnterior` vira consequência, não campo | mais tabelas; exige disciplina de escrita |
| C. Partida dobrada completa | rigor contábil | complexidade desproporcional a um bolão |

**Inclinação:** B. É o mínimo que torna o dinheiro auditável sem virar contabilidade.
**Requisito não negociável em qualquer opção:** `tx_id` precisa de coluna — a
governança de txId do Powerball já é regra, e hoje não tem onde morar.

---

## DEC-05 · Auditoria

| Opção | |
|---|---|
| A. Manter `state.auditLog[]` | mantém D-04, inclusive o truncamento silencioso em 200 |
| B. Tabela append-only, sem UPDATE/DELETE para nenhum papel de aplicação | resolve mutabilidade e truncamento |
| C. B + encadeamento por hash (como no modelo 4) | tamper-evident |

**Inclinação:** B como piso obrigatório; C se a auditoria for usada para resolver
disputa sobre dinheiro — e, dado que os quatro bolões pagam prêmio real, provavelmente será.

---

## DEC-06 · Nome + dado de pagamento em repositório público

Ver `PHASE0_PII_MAP.md` §4. `bolao/loterias/powerball/js/data.js` publica nome completo + método +
valor + data/hora + UF de cada participante, num repositório aberto.

| Opção | |
|---|---|
| A. Manter | transparência total do bolão; é o que existe hoje |
| B. Publicar nome, mover pagamento para audiência admin | mantém o ranking público, tira o dado financeiro do ar |
| C. Publicar apenas primeiro nome ou apelido | máxima proteção; muda o que os participantes veem |

**Esta é uma decisão do Eduardo sobre o produto e sobre o combinado com os
participantes — não uma correção técnica.** Registro sem recomendar.
Nota: qualquer opção afeta só o estado atual; o histórico do git é imutável (D-13).

---

## DEC-07 · Concorrência

> **CAS detecta conflito. CAS não resolve conflito.** Um `UPDATE … WHERE updated_at =
> <valor lido>` que afeta zero linhas informa que houve escrita concorrente — e nada
> mais. Sem uma política do que fazer em seguida, o efeito prático é trocar perda
> silenciosa por **falha silenciosa**, o que não é necessariamente melhor num app que
> grava estado de bolão.
>
> Qualquer adoção de CAS exige, junto, as três peças:
> 1. **rejeição** — a escrita falha de forma explícita e observável, nunca ignorada;
> 2. **retry** — reler o estado e reaplicar a intenção do usuário, com limite de
>    tentativas e comportamento definido ao esgotá-las;
> 3. **merge** — regra de resolução para quando as duas escritas tocam o mesmo campo,
>    incluindo o que fazer quando o merge é impossível (perguntar ao usuário, preservar
>    ambas, ou recusar).
>
> `updated_at` **sozinho não resolve D-05.**

| Opção | |
|---|---|
| A. Manter read-modify-write | D-05 permanece; perda silenciosa |
| B. CAS via `updated_at` ou coluna de versão, **acompanhado de política de rejeição, retry e merge** | detecta o conflito; o custo real está na política, não no token |
| C. Escrita via RPC que resolve o merge no servidor | move a política para um único lugar; mais trabalho; herda a restrição de hospedagem do DEC-03 se exigir segredo |

**Inclinação:** B **com as três peças definidas** como correção imediata (aplicável
mesmo sem modernização, e propagável ao br2026, que hoje não tem nem o mitigador do
cdb2026); C na arquitetura-alvo. B implementado como token sem política não é
correção — é troca de sintoma.

---

## DEC-08 · Ingestão de participante do Powerball

Hoje: commit em `bolao/loterias/powerball/js/data.js` (D-13). Cada participante entra
no histórico do git.

| Opção | |
|---|---|
| A. Manter | simples; PII no histórico para sempre; sem transação |
| B. Banco como fonte, `data.js` **gerado offline ou em CI** e publicado como artefato estático | tira PII do versionamento de conteúdo; **cria dependência do pipeline de publicação** |
| C. Banco como fonte, frontend lê direto | remove o passo estático; exige projeção pública sem PII (como a `lottery_public_projection`) |

**Correção de premissa.** Uma redação anterior falava em "`data.js` gerado no build"
enquanto afirmava que o site não tem build — o que é contraditório. O que a opção B
realmente propõe é **geração offline (na máquina de quem opera) ou em CI (GitHub
Actions)**, com o artefato resultante publicado no site estático.

**Dependência a registrar antes de decidir B:** o site passa a depender do pipeline de
publicação para estar correto. Isso significa que a correção de um dado de
participante deixa de ser um commit e passa a ser uma execução; que uma falha de CI
vira uma divergência entre banco e site; e que é preciso definir quem pode disparar a
geração, com quais credenciais, e como se detecta que o artefato publicado está
defasado em relação ao banco. Nada disso existe hoje.

**Nenhuma inclinação registrada.** As três opções permanecem abertas; B e C dependem
de DEC-01, DEC-02 e da restrição de hospedagem discutida em DEC-03. A escolha é da
Fase 5.

---

## DEC-09 · Retenção

D-09: 7 anos de auditoria e 2 de e-mail são promessas sem implementação.

Decidir: (a) implementar de fato, (b) reduzir a promessa ao que se pretende
sustentar, ou (c) remover a afirmação da documentação. Manter como está é a única
opção inaceitável — um controle citado e não implementado é pior que a ausência dele.

---

## DEC-10 · Escopo e ritmo

| Opção | |
|---|---|
| A. Só os itens de maior severidade (D-01 a D-04) | menor risco, maior retorno imediato |
| B. Um app por vez, começando pelo Powerball | o Powerball é o mais estático e o único sem Supabase no frontend — menor blast radius, e isso é observável no código |
| C. Plataforma inteira de uma vez | coerência máxima; risco máximo em sistema que paga prêmio real |

**Inclinação:** A e B combinados.

**Estado operacional — não afirmável por esta fase.** Uma redação anterior ordenava os
apps por risco com base em afirmações que o repositório não pode sustentar: que
copa2026 está arquivado, que br2026 não foi publicado, e que cdb2026 é o único em
produção com participantes ativos. Documentação e flags de config registram
*intenção*; não provam o que está no ar nem quem está usando.

```
OPERATIONAL_STATUS(copa2026)  = REQUIRES_OWNER_CONFIRMATION
OPERATIONAL_STATUS(br2026)    = REQUIRES_OWNER_CONFIRMATION
OPERATIONAL_STATUS(cdb2026)   = REQUIRES_OWNER_CONFIRMATION
OPERATIONAL_STATUS(powerball) = REQUIRES_OWNER_CONFIRMATION
```

Para cada app, o Eduardo precisa confirmar: se está publicado e acessível hoje; se há
participantes ativos; se há dinheiro em aberto; e qual a janela de evento em que
mexer é inaceitável. **A ordem de execução depende dessa confirmação e não pode ser
fixada antes dela** — ordenar por risco usando premissas não confirmadas é
exatamente o erro que esta correção existe para eliminar.

---

## Ordem em que estas decisões precisam ser tomadas

```
Fase 1 (evidência)  →  DEC-02 (o que já existe?)
                    →  DEC-01 (qual o volume real?)
Fase 3 (backup)     →  gate duro, nada avança sem ele
Fase 4              →  DEC-03, DEC-04, DEC-05, DEC-07  (as que definem o desenho)
                    →  DEC-06, DEC-09                  (produto/governança, paralelas)
Fase 5              →  DEC-08, DEC-10                  (dependem do desenho pronto)
```
