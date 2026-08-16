# Contrato Permanente de Segurança de Mudança

**Comando canônico: `npm run check`.** Nenhuma tarefa neste repositório está concluída sem ele.

Este documento descreve o contrato que torna regressões em superfícies críticas
**mecanicamente detectáveis** em toda mudança. Ele substitui a prática anterior, que dependia de
um prompt lembrar de dizer "rode npm test", "confira que o hero não mudou", "confira que o cron
não mudou".

Memória de prompt não é controle de engenharia. Ela falha exatamente na mudança que parecia não
ter relação — e os dois defeitos achados na auditoria de julho/2026 estavam justamente em código
que parecia não ter relação com o que estava sendo mexido.

---

## As duas perguntas

O contrato responde a duas perguntas **independentes**. A segunda é a que costuma faltar.

| | Pergunta | Como é respondida |
|---|---|---|
| **A** | Alguma superfície crítica **mudou**? | Classificação de diff contra uma base do git (`classify.mjs`) |
| **B** | Mesmo que **não pareça** ter mudado, os invariantes críticos ainda valem? | Invariantes estruturais verificados em toda execução (`audit_safety_contract.mjs`) |

Detecção por caminho responde só à pergunta A. Ela é cega para o caso em que o arquivo continua
lá, o nome continua o mesmo, o gate continua "passando" — e a proteção já não existe. Foi assim
que 17 gates ficaram órfãos até 2026-08-10, e um deles esteve **vermelho por vários commits**
tendo pego uma regressão real que nenhuma suíte reportou.

---

## Anatomia

```
bolao/shared/safety/
  critical_surfaces.json        registro canônico das superfícies protegidas
  notification_workflows.json   manifesto dos workflows de e-mail/cron
scripts/safety/
  surfaces.mjs                  biblioteca comum (registros, globs, base do git)
  classify.mjs                  CHANGE_SAFETY_REPORT
  audit_safety_contract.mjs     o meta-gate  (36 checks)
  test_safety_contract.mjs      as 16 mutações que provam que ele morde
  check.mjs                     npm run check
CHANGE_INTENT.json              declaração — só existe quando algo crítico muda de propósito
.github/workflows/safety_check.yml
```

`npm run check` compõe, nesta ordem:

1. **classificação da mudança** — quais superfícies o diff tocou;
2. **contrato de segurança** — invariantes + autoproteção dos gates *(roda antes da suíte longa: custa ~1 s e responde "esta mudança tem direito de existir?")*;
3. **suíte canônica** — `scripts/verify.mjs`, 150 checks, agregados;
4. **árvore/evidência** — nada gerado pela própria execução fica para trás.

### Por que a suíte canônica é o `verify.mjs` e não o `npm test`

Porque o `verify.mjs` **domina** a cadeia do `npm test`, e isso é *verificado, não suposto*: o
check **G2** reprova se um só comando da cadeia do `npm test` deixar de ser um check do verify.

Enquanto G2 está verde, rodar o verify executa tudo que o `npm test` executa — **mais 46 gates
que o `npm test` nunca alcançou**, entre eles a matriz de crash do Powerball, os leitores
privados da Copa e a política de assunto.

E o verify **agrega**: roda todos os checks e falha no fim. A cadeia `&&` do `npm test`
curto-circuita no primeiro vermelho — numa execução medida deste repositório, **uma** falha
escondeu **oito** suítes que passavam.

Quem quiser a cadeia literal: `npm run check -- --with-npm-test`.

---

## Políticas

| Política | Significado |
|---|---|
| `DECLARE_TO_CHANGE` | Qualquer diferença exige entrada em `CHANGE_INTENT.json`. Padrão para o que nunca deve mudar por acidente. |
| `APPEND_ONLY` | Pode **crescer** sem declaração; **encolher** exige declaração. Acrescentar um gate é sempre seguro; remover um é a mudança perigosa. |
| `STRUCTURALLY_ENFORCED` | Não exige declaração para edição de conteúdo — o arquivo é grande e muda legitimamente o tempo todo. Em troca, os invariantes são verificados em **toda** execução e tocar no arquivo aciona os gates pesados dedicados. |

`APPEND_ONLY` compara **identidades, nunca contagens.** A versão por contagem foi derrubada pela
suíte de mutação na primeira execução: o próprio patch que criou este contrato acrescentou seis
checks ao verify, então apagar `scoring-copa` deixava o total em 149 contra 144 da base —
*cresceu*, e a regra por total aplaudiu. Um patch que acrescenta ruído barato e remove um gate
caro passa por qualquer regra de total, e é exatamente o formato que um patch apressado tem.

---

## Declarando uma mudança crítica

Uma mudança **comum não declara nada** e `CHANGE_INTENT.json` nem precisa existir — a ausência é
o estado normal. Nenhuma burocracia para o dia a dia.

Quando uma superfície `DECLARE_TO_CHANGE` muda de propósito:

```json
{
  "declarations": [
    {
      "surface_id": "SHARED_DESIGN_TOKENS",
      "reason": "por que a mudança precisa acontecer",
      "expected_behavior_change": "o que muda no comportamento observável",
      "tests_required": ["visual-consistency", "responsive-14-width"]
    }
  ]
}
```

Para workflows de notificação a declaração precisa **nomear o workflow** em `affected_workflows`.
Uma declaração de nível de superfície autorizaria, com uma linha, qualquer violação em *qualquer*
workflow — bastaria tocar num arquivo de CI para ganhar permissão de apagar o cron do Powerball
no mesmo commit.

### O arquivo se autolimpa

Depois que a mudança declarada entra em `main`, a base do git anda, os caminhos somem do diff e a
declaração fica **obsoleta** — o check **D3** exige que seja removida. É a mesma regra que o
`ALLOWLIST.json` já aplica a si mesmo. Sem a autolimpeza, `CHANGE_INTENT.json` viraria um
depósito de autorizações permanentes, que é a porta dos fundos que ele existe para não ser.

---

## Superfícies protegidas (23)

**Regras de negócio** — `SCORING_CONSTANTS`, `SCORING_ENGINES`, `RANKING_AND_TIEBREAK`,
`ROUND_FINALIZATION`, `LOTTERY_ECONOMICS`

**Visual** — `SHARED_DESIGN_TOKENS`, `SHARED_VISUAL_FRAMEWORK`, `APP_STYLESHEETS`,
`LIVE_MATCH_HEROES`, `RANKING_AND_STANDINGS_LAYOUT`

**Persistência** — `SUPABASE_MIGRATIONS`, `SECURITY_BOUNDARY`

**Notificação** — `NOTIFICATION_WORKFLOWS`, `REAL_SEND_GUARDS`, `NOTIFICATION_EXACTLY_ONCE`,
`EMAIL_SUBJECT_POLICY`

**Infra de qualidade** — `GATE_REGISTRY`, `TEST_CHAIN`, `VERIFY_RUNNER`,
`SAFETY_CONTRACT_ITSELF`, `VISUAL_ALLOWLIST`, `CI_WORKFLOW`

O `SAFETY_CONTRACT_ITSELF` existe porque, sem ele, o caminho mais curto para um patch ficar verde
seria editar o registro em vez do defeito.

### Precisão deliberada

Duas escolhas evitam que o contrato vire carimbo:

- **`siteVersion` fica fora do fingerprint de scoring.** Ele sobe em todo release por política do
  repo; incluí-lo exigiria uma declaração de mudança crítica a cada release, e uma declaração que
  se assina sempre não é lida nunca.
- **Snapshots da ESPN não são superfície.** O bot commita `espn-normalized.json` a cada 10
  minutos; protegê-lo deixaria o contrato vermelho o dia inteiro por dado que ninguém escreveu.

---

## Prova de que o contrato morde

`npm run safety:mutations` quebra cada superfície crítica, uma por vez, e exige **vermelho no
check específico** que deveria pegá-la — não apenas "vermelho em algum lugar", que um contrato
que reprova tudo por um motivo só também satisfaria.

| | Mutação | Pega por |
|---|---|---|
| M1 | elemento estrutural do hero removido | `H:br2026` |
| M2 | token compartilhado removido | `L1` |
| M3 | constante de scoring alterada | `S1` |
| M4 | gate removido da cadeia do npm test | `G4` |
| M5 | cron de workflow alterado | `N:POWERBALL_RESULTS_EMAIL` |
| M6 | guard de envio real removido | `N:BR2026_ROUND_EMAILS` |
| M7 | rollback SQL sob `migrations/` | `M1` |
| M8 | allowlist visual alargada | `G8` |
| M9 | check removido do verify.mjs | `G3` |
| M10 | sub-suíte removida do npm test | `G1`/`G4` |
| M11 | gate silenciosamente pulado | `G6` |
| M12 | gate esvaziado (assertions removidas) | `G7` |
| M13 | gatilho do CI estreitado | `C1` |
| M14 | comando canônico trocado no CI | `C1` |
| M15 | registro de gates encolhido | `G5` |
| M16 | workflow de teste ganha guard real | `N:CDB2026_CONFIRMATION_FAKE_TRANSPORT_TEST` |

Toda mutação é desfeita **byte a byte** no `finally`, e a restauração é reconferida por `git` e
independentemente por **sha-256** — se o índice do git estivesse mentindo, o hash não mente.

Nenhuma mutação toca dado de participante, banco, provedor de e-mail ou rede.

---

## CI

`.github/workflows/safety_check.yml` — dispara em `pull_request` e em `push` para `main`, roda
`npm run check`.

**Hermético por estrutura, não por configuração**: nenhum secret é exposto ao job. Sem
`SUPABASE_SERVICE_ROLE_KEY`, sem `BOLAO_ALLOW_REAL_SEND` e sem `POWERBALL_EMAIL_MODE`, os
caminhos capazes de escrever em produção ou enviar e-mail falham **fechados** por contrato
próprio. Gates que exigem credencial de produção são reportados `SKIPPED` — nunca `PASSED`.
Mockar a credencial para "cobrir" esses gates trocaria uma lacuna honesta por um verde falso.

Dois detalhes que parecem menores e não são:

- **`fetch-depth: 0`.** Com o checkout raso padrão não existe `HEAD~1` nem merge-base, e *toda*
  comparação de baseline viraria `SKIPPED` — o contrato passaria sem ter medido o que existe para
  medir.
- **O navegador é obrigatório.** Um gate de navegador que não roda por falta de navegador seria
  `SKIPPED` — honesto, mas silencioso demais para uma regressão visual. O job aborta antes de
  produzir um verde que não cobriu geometria nenhuma.

O cache guarda apenas o **binário** do Playwright, imutável para uma versão. Nenhuma evidência
gerada entra em cache: um artefato reaproveitado esconderia exatamente a regressão que a execução
seguinte deveria encontrar.

---

## Evidência regenerada

`audit_visual_consistency.{json,md}` carregam um carimbo de geração (hora + commit), então ficam
"modificados" depois de toda execução mesmo quando nenhum achado mudou.

Duas saídas erradas seriam possíveis, e o contrato recusa as duas: **ignorar** esconderia uma
mudança real de achado visual; **reprovar sempre** ensinaria a ignorar `git status` — e um
`git status` ignorado é como uma edição acidental viaja junto com um commit legítimo.

A saída certa é comparar o conteúdo com os campos voláteis normalizados: igual, o arquivo é
restaurado e a árvore termina limpa; diferente, o check **reprova** e manda revisar.

---

## Ver também

- `docs/bolao/PLATFORM_GOVERNANCE.md` — classificação de mudanças e política de auditoria
- `docs/bolao/ENGINEERING_STANDARD.md` — audit-first workflow
- `docs/bolao/QA_MASTER_CHECKLIST.md` — checklist cross-app
- `bolao/scripts/gate_registry.json` — registro de gates (nenhum gate pode existir sem classificação)
