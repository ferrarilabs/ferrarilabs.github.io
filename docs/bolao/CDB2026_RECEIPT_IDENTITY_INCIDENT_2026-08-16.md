# CDB2026 — comprovante duplicado (2026-08-16) e o endurecimento da identidade de entrega

**Status:** incidente encerrado operacionalmente em 2026-08-16; endurecimento estrutural concluído
no mesmo dia.
**Apps afetados:** `bolao/cdb2026/` apenas. Ver "Propagação" no fim.
**Classificação:** `SECURITY` / `PLATFORM_SHARED` (camada de entrega de e-mail). Sem alteração de
scoring, bracket, regra de torneio ou palpite de participante.

---

## 1. O que aconteceu

`receipt_catchup_20260816.py` mandou comprovante de palpites salvos para quatro entradas.
Duas eram alvo legítimo (**Nathalia**, **Aline** — salvaram na noite anterior e não tinham
recebido nada). Duas **já tinham o recibo da mesma versão gravada**: **Bossle** (salvou 13/08) e
**Rodrigo Hajj** (salvou 14/08).

Nenhum e-mail de correção ou desculpa foi enviado, por decisão do operador: mandar mais um e-mail
para avisar do engano produz exatamente o ruído que o engano produziu.

## 2. As duas causas

### 2.1 A que o post-mortem do dia encontrou (verdadeira, mas secundária)

Ao generalizar o catch-up de 12/08 (que tinha `DIA_ALVO` fixo) para outro dia, o recorte por dia
foi **removido** em vez de reescrito. Sobrou `lastClientRef presente`, verdadeiro para qualquer
save antigo pelo caminho seguro. O filtro foi reposto no mesmo dia.

### 2.2 A que ficou de pé depois da correção (a real)

O cabeçalho do próprio script afirmava:

> `reserve_delivery` usa `UNIQUE(app, business_key, recipient_hash, generation)`; a chave carrega
> a versão gravada. Rodar duas vezes dá `JA_ENTREGUE` na segunda — o e-mail nunca sai duas vezes
> para o mesmo conteúdo.

Verdadeiro e **insuficiente**. As chaves em produção eram quatro para um fato só:

| caminho | `business_key` |
|---|---|
| produção (outbox) | `cdb2026:entry-saved-confirmation:<versão>:v1` |
| catch-up 12/08 | `cdb2026:entry-saved-confirmation-catchup-20260812:<entrada>:<versão>:v1` |
| catch-up 16/08 | `cdb2026:entry-saved-confirmation-catchup-20260816:<entrada>:<versão>:v1` |
| teste de template | `cdb2026:entry-saved-confirmation-template-test:<versão>:v3` |

Cada caminho estava protegido **contra si mesmo** e nenhum estava protegido **contra os outros**.
Bossle tinha recibo pela família de produção; Rodrigo, pela família do catch-up de 12/08. Nenhuma
das duas era consultada pelo catch-up de 16/08.

**Nome de transporte tinha virado identidade semântica.** O filtro de data mascarava isso: com o
recorte certo, os dois casos ficariam de fora *por acidente de calendário*, não por controle.

## 3. A identidade canônica

```
identidade de um comprovante  =  ENTRADA  +  VERSÃO GRAVADA DOS PALPITES
```

Independente de transporte. Se essa dupla já recebeu por **qualquer** caminho reconhecido, todo
remetente automático devolve NOOP.

### Duas camadas, deliberadamente redundantes

1. **Chave canônica.** Todo remetente automático reserva com a chave e a família de **produção**
   (`receipt_identity.canonical_business_key()`), porque um catch-up não é outro evento de
   negócio — é o mesmo recibo por outro transporte. `NORMAL→CATCHUP` e `CATCHUP→NORMAL` passam a
   colidir no `UNIQUE` do banco, sem depender de código Python nenhum.
2. **`cdb_has_accepted_receipt(entrada, versão)`** (RPC, `security definer`). Alcança o que a
   chave canônica não alcança: as famílias históricas com chave própria e a entrega legada pelo
   navegador, que nunca escreveu em `notification_deliveries`.

A camada 1 sozinha deixaria `TEMPLATE→CATCHUP` passar; a camada 2 sozinha teria janela de corrida
entre consultar e reservar. Juntas, não.

### O que conta como "já recebeu"

| status da entrega | decisão |
|---|---|
| `accepted` | recebeu → **bloqueia** |
| `uncertain` | provedor chamado, resposta perdida → **bloqueia** (falha fechada) |
| `claimed` | reserva concedida e nunca liquidada → **bloqueia** (falha fechada) |
| nenhum registro | elegível |

"Talvez tenha recebido" nunca autoriza um segundo e-mail.

### Famílias reconhecidas

Declaradas em `bolao.cdb_receipt_family_registry` (tabela, não lista embutida numa função — uma
família nova precisa ser **declarada** para deduplicar). Família não declarada **não** deduplica:
o erro sai ruidoso numa medição em vez de silencioso numa caixa de entrada.

## 4. Entrega legada (caminho antigo do navegador)

`queueReceipt()` → EmailJS nunca escreveu em `notification_deliveries`. Não existe registro para
consultar, e **não se inventa hash histórico**:

| situação | tabela | efeito |
|---|---|---|
| dá para amarrar a uma versão exata | `cdb_legacy_receipt_attestation`, `certainty='PROVEN'`, com `picks_version` | conta como recibo entregue |
| sabe-se que recebeu algo, não qual versão | mesma tabela, `certainty='UNCERTAIN'`, `picks_version` **NULL** | catch-up automático **falha fechado**; exige revisão do operador |

O `CHECK` da tabela recusa "provado, mas não sei de que versão" e recusa "incerto, mas com hash
preenchido". Registrar via `cdb_attest_legacy_receipt(...)`, que exige evidência em texto:

```bash
python3 - <<'PY'
import sys; sys.path.insert(0, "bolao/shared/scripts")
import m8m9
print(m8m9._rpc("cdb_attest_legacy_receipt", {
    "p_entry_id": "<uuid>",
    "p_picks_version": "<hash de 16 chars>",   # None para UNCERTAIN
    "p_certainty": "PROVEN",
    "p_evidence": "e-mail de 2026-08-11 19:42 BRT; código do comprovante confere",
}))
PY
```

## 5. O filtro de data é secundário — e o escopo é explícito

`--target-date` define a **população** pretendida, nunca a proteção contra duplicata.

- `DATE_FILTER_ONLY_DEDUPE = NO`
- `CROSS_PATH_VERSION_DEDUPE = YES`

Um envio real **sem** `--target-date` é **RECUSADO** (`REAL_RUN_WITHOUT_EXPLICIT_SCOPE = REFUSED`):
nenhuma operação irreversível pode mudar de significado conforme o dia em que alguém a reroda. Só
a medição, que é só leitura, aceita o default de hoje na linha de comando — e nem isso no
workflow, onde a data é campo obrigatório.

A ordem em que os motivos são **avaliados** também mudou: a pergunta canônica primeiro, a janela
depois. Uma entrada que já tem recibo sai rotulada `SKIP_ALREADY_RECEIVED_SAME_VERSION` mesmo
quando a janela também a excluiria — se o rótulo fosse `SKIP_FORA_DA_JANELA`, o relatório daria a
impressão de que foi a data que protegeu o participante, que é exatamente a impressão que
sobreviveu ao post-mortem e teria deixado o defeito de pé.

## 6. A leitura autoritativa dos palpites

Durante a perícia, um diagnóstico concluiu que vários participantes tinham palpites "só até as
quartas". Ele contava **confrontos registrados** (`phases[*].ties`) — que somam 12 (8 oitavas + 4
quartas) e param, porque semifinal e final não existem como confronto gravado enquanto a CBF não
os materializa. O renderizador do comprovante, lendo o **mesmo documento persistido**, encontrou o
chaveamento completo até a final.

**Classificação: `WRONG_DIAGNOSTIC_SOURCE`.**

Não era projeção velha. ~~Não era defeito de sincronização, e a projeção pública não precisa
mudar.~~ **Esta frase estava errada e foi refutada na mesma noite — ver §6.1: a projeção pública
não consegue conter os palpites virtuais, e mudou.**
`phases[*].ties` é autoritativo para *"que confrontos a CBF já materializou"* e não responde
*"até onde este participante palpitou"* — isso só se responde resolvendo os confrontos
**virtuais** (topologia + o `qualified` do próprio participante), que é o que
`virtualDerivedTies()` faz no `app.js` e `ties_virtuais()` faz em `receipt_render.py`.

`OPERATOR_DIAGNOSTIC_USES_AUTHORITATIVE_STATE = YES`: ferramenta de operador usa
`receipt_identity.authoritative_pick_completeness()`, e o relatório do catch-up imprime
"até 'final'; final completa=SIM" em vez de contagem de confrontos registrados. A regressão que
reproduz a discordância histórica está em `test_receipt_catchup_dedupe.py` §6.

### 6.1 Correção de classificação (auditoria de persistência, 2026-08-16, mesma noite)

`WRONG_DIAGNOSTIC_SOURCE` está certo e **parou cedo**. Faltavam duas coisas, as duas medidas:

**(a) A projeção pública não pode conter esses palpites.** `bolao_state_normalized_public` monta
`picks.qualified` com `JOIN bolao.ties`, e `sf-1`/`sf-2`/`final-1` não têm linha ali — são
confrontos virtuais, cuja composição muda por participante. Não é "o diagnóstico perguntou à
fonte errada"; é que aquela fonte **estruturalmente não pode responder**. Medido: das 12
entradas, as 5 completas aparecem com 15 palpites em `bolao_state` e **12** na projeção, sem
campeão nem vice.

Isso importa muito além do diagnóstico, porque a projeção é o `readTable` do navegador: o
ranking, o card de pódio, o detalhe "Ver palpites" e o CSV mostram campeão "—" para os cinco, e
quando a final for jogada `predictedPodium()` devolve `null` e os 30 + 20 pontos de bônus não são
somados. **O dado não está em risco** (o navegador não grava mais o documento inteiro, e o
participante edita a partir de `cdb_my_entry`, que lê o documento autoritativo) — é defeito de
leitura, não de dados.

Por que nenhum teste pegou: `cdb_mirror_entry_picks` monta `_mirror_want` com **o mesmo**
`join bolao.ties` e depois compara `_mirror_want` com `bolao.predictions`. Os dois lados da
asserção passam pelo mesmo filtro, então `MIRROR_DIVERGENCE` não consegue ficar vermelha por esta
causa.

A migração `20260813140000` já tinha registrado esses slugs — como "resíduo de um bracket
anterior", com a conclusão "nada os lê". Era verdade quando foi escrito e deixou de ser em
2026-08-12, quando `cdb_register_bracket_topology` gravou as vagas `sf-1`/`sf-2`: os mesmos slugs
viraram as chaves vivas da semifinal e da final. O caminho de ESCRITA foi corrigido para isso
(`cdb_authoritative_document()` remescla o resíduo, com comentário explícito). O de LEITURA não.

Classificação correta: **`SYNC_DEFECT`**, estrutural, no modelo normalizado.

**(b) A leitura "autoritativa" tinha o mesmo defeito que substituía.**
`authoritative_pick_completeness()` chama `receipt_render.ties_virtuais()`, que até esta noite só
sabia ler `topology` na forma ACHATADA que `snapshot_de()` produz. Alimentada com o estado cru,
devolvia "até as quartas" — a resposta errada de novo, agora com o nome de autoritativa.
Corrigido (`slots_da_topologia()`, aceita as duas formas); o fixture de `test_receipt.py`, que
fixava a forma achatada, passou a ser o documento real.

Nada disso invalida o §6: os comprovantes de 16/08 **saíram completos**, com semifinal, final,
campeão e vice. Verificado renderizando os 5 brackets a partir do snapshot autoritativo congelado
e conferindo as 29 linhas de placar e o par campeão/vice extraídos do HTML.

## 7. O one-off foi desarmado

| antes | depois |
|---|---|
| `scripts/receipt_catchup.py` | `scripts/archive/receipt_catchup_20260812.py` — **desarmado** |
| `scripts/receipt_catchup_20260816.py` | `scripts/archive/receipt_catchup_20260816.py` — **desarmado** |
| — | `scripts/receipt_catchup_tool.py` — ferramenta genérica |

O corpo dos dois está preservado byte a byte como evidência, inclusive a seção "POR QUE NÃO É UM
DUPLICADO POSSÍVEL" que estava errada — é justamente o que precisa continuar legível. A guarda
`raise SystemExit(...)` fica **no nível de módulo**, não em `__main__`: um arquivo com uma função
`enviar()` funcional dentro é uma arma carregada, e `python3 -c "import ..."` é um caminho tão
real quanto `python3 arquivo.py`.

O workflow `cdb2026_receipt_catchup_20260816.yml` foi removido. `cdb2026_receipt_catchup.yml`
passa a dirigir a ferramenta genérica, com `target_date` obrigatório nos dois jobs e o manifesto
passando como artefato entre "medir" e "enviar".

## 8. Prova

`bolao/cdb2026/scripts/test_receipt_catchup_dedupe.py` — **offline**, banco em memória,
`urlopen` substituído por sentinela que levanta para qualquer host.

| cenário | esperado | resultado |
|---|---|---|
| `NORMAL_RECEIPT_THEN_CATCHUP` | 0 | ✅ |
| `CATCHUP_THEN_NORMAL_RECEIPT` | 0 (`JA_ENTREGUE` no banco) | ✅ |
| `TEMPLATE_ACCEPTED_THEN_CATCHUP` | 0 | ✅ |
| `LEGACY_PROVABLE_SAME_VERSION_THEN_CATCHUP` | 0 | ✅ |
| `LEGACY_UNCERTAIN_THEN_CATCHUP` | 0 + revisão do operador | ✅ |
| `SAME_ENTRY_NEW_PICKS_VERSION` | 1 | ✅ |
| `SAME_VERSION_AGAIN` | 0 | ✅ |
| reprodução do incidente | Bossle 0, Rodrigo 0, Nathalia 1, Aline 1; `providerCalls = 2` | ✅ |
| segunda execução | `providerCalls = 0` | ✅ |
| RPC ausente/quebrada | falha fechada | ✅ |
| envio real sem escopo | recusado | ✅ |

**Mutações (têm de deixar vermelho):**

- remover a checagem cross-path → 4 alvos em vez de 2 → **RED** ✅
- elegibilidade só por data + `lastClientRef` → 4 alvos em vez de 2 → **RED** ✅

### Limitação declarada — e fechada no mesmo dia

O dublê implementa `cdb_has_accepted_receipt` chamando `receipt_identity.classify_ledger` — a
mesma regra da função SQL, escrita em Python. Isso prova a decisão e o fluxo; **não prova o corpo
do PL/pgSQL**. Por isso §9 do teste confere estruturalmente o SQL da migração (lista de famílias,
status que bloqueiam, `join` no registro, saídas de falha fechada, ausência de endereço no retorno)
— a mesma técnica que `test_entry_saved_confirmation.py` usa para provar a posição do insert
dentro de `cdb_save_my_picks`.

**A limitação era real, e cobrava.** A auditoria de persistência rodou o corpo PL/pgSQL num
Postgres 17 descartável, com linhas reais nas tabelas da migração, e a função **quebrou**:

```
ERROR: malformed array literal: "cdb2026:entry-saved-confirmation-legacy-attested#accepted"
```

`v_paths := v_paths || 'literal'` com `v_paths text[]` é ambíguo — o literal não tem tipo, o
Postgres resolve para `anyarray || anyarray` e tenta ler a string como literal de array. As duas
linhas equivalentes do laço acima escapam porque `(r.fam || '#accepted')` já é `text`. Corrigido
para `array_append`.

Conferência estrutural é leitura de texto: provava que a palavra estava lá, não que o ramo
executava. E o ramo que quebrava é justamente o da atestação legada — o que o §4 acima manda o
operador registrar.

`bolao/cdb2026/scripts/` não ganhou um teste novo para isso porque ele exige um Postgres local;
ele vive em
`~/Documents/GitHub/ferrarilabs-work/audits/cdb-persistence-20260816/harness/test_r3_rpc_body.py`
(20 asserções sobre a função real) e deve ser rodado antes de qualquer mudança nesta migração.

## 9. Migração

`supabase/migrations/20260816000000_cdb_receipt_identity_is_cross_path.sql`; o rollback vive em
`supabase/rollbacks/` desde 2026-08-16 (o CLI tratava todo `*.sql` de `migrations/` como migração de
avanço — ver `supabase/rollbacks/README.md`).
Só **cria** — duas tabelas, três funções; nada existente é alterado.

⚠ O rollback **desarma o catch-up automático**: `receipt_catchup_tool.py` falha fechado quando a
RPC não existe, em vez de cair para o critério antigo. É o comportamento correto, não um efeito
colateral.

## 10. Propagação (regra obrigatória de `PLATFORM_GOVERNANCE.md`)

Auditados os outros dois apps:

- **`bolao/copa2026/`** — não usa `reserve_delivery`/`notification_deliveries` e não tem
  comprovante por versão. Torneio encerrado e arquivado. **Não aplicável.**
- **`bolao/br2026/`** — usa `round_notification_ledger`, cuja identidade é
  `(round_number, entry_ref)`: **uma** identidade por fato de negócio, independente de transporte,
  por construção. Não existe fan-out de remetentes one-off por rodada
  (`round_catchup_dryrun.py` é só leitura e nunca envia). **Não aplicável — já correto.**

O **defeito** é `TOURNAMENT_SPECIFIC` do CDB2026 (é o único app com múltiplos remetentes para o
mesmo recibo). A **lição** é de plataforma e está registrada em `LESSONS_LEARNED.md`.

## 11. Verificação de efeito colateral

```
REAL_EMAILS_SENT            = 0
PARTICIPANT_PICKS_CHANGED   = 0
SCORING_CHANGED             = NO
SUPABASE_UNRELATED_CHANGES  = 0
```

`audit_scoring.py` dos três apps: **PASS**. `test_receipt.py`: **PASS**.
`test_receipt_catchup_dedupe.py`: **PASS**.
