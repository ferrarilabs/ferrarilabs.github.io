# ADR-018 — Modelar CHANGE_INTENT como intenção One-Shot ou obrigação Conditional

**Status:** Aceito.
**Data:** 2026-08-18. **Aplica-se a:** `CHANGE_INTENT.json`, `scripts/safety/surfaces.mjs`
(`validateLifecycle`, `evaluateConditionalInvariants`, `makeInvariantChecks`),
`scripts/safety/audit_safety_contract.mjs` (D1/D3), `scripts/sentinel/detectors/change_intent_stale.mjs`.

## Contexto

Toda declaração em `CHANGE_INTENT.json`, até 2026-08-18, tinha exatamente uma forma semântica:
**"eu mudei X, e aqui está por quê"** — uma autorização retroativa para uma mudança já feita. D3
(`audit_safety_contract.mjs`) responde corretamente a essa forma: se nenhum caminho coberto pela
superfície aparece no diff desde a base, a mudança que a declaração descrevia não está mais "em
andamento" — a declaração é ruído e deve ser removida. Essa autolimpeza por diff é deliberada (ver
o comentário original de D3): sem ela, `CHANGE_INTENT.json` viraria um depósito de autorizações
permanentes — exatamente a porta dos fundos que o arquivo existe para não ser.

Em 2026-08-18, um segundo caso de uso real apareceu: `br2026_round_emails.yml` foi desarmado
emergencialmente após um incidente real (participantes reais receberam e-mail de uma rodada
histórica já concluída). A declaração correspondente não descrevia "eu mudei X" — descrevia **"X
precisa continuar neste estado até a condição Y"**: o workflow deve permanecer em `--dry-run` até a
causa raiz ser confirmada, toda rodada histórica ser comprovadamente não-reenviável, e produção ser
verificada. Nenhuma dessas três condições estava satisfeita.

D3 não tem como distinguir essas duas formas. Um commit subsequente e totalmente não relacionado
(a fusão do PR #237, Sentinel V1.0-B) fez a base andar, os caminhos do workflow desapareceram do
diff, e D3 marcou a declaração da emergência real como obsoleta — o mesmo sintoma de #223, mas com
uma causa completamente diferente: não uma declaração esquecida após o trabalho terminar, e sim uma
declaração genuinamente ainda necessária sendo mal classificada pela única pergunta que D3 sabia
fazer. Investigação read-only confirmada na Issue #238.

## Decisão

`CHANGE_INTENT.json` passa a suportar um campo `lifecycle` por declaração, com dois valores:

- **`"one_shot"`** (padrão quando `lifecycle` está ausente — toda declaração histórica até
  2026-08-18 é deste tipo, sem migração necessária): semântica idêntica à de sempre. D3 continua
  reprovando quando nenhum caminho coberto aparece no diff desde a base.
- **`"conditional"`**: a declaração descreve um ESTADO que precisa continuar valendo até uma
  condição futura ser satisfeita. Isenta da autolimpeza por diff de D3 — mas nunca isenta de
  verificação. Exige:
  - `condition_id` (string estável, única entre declarações do mesmo arquivo);
  - `related_issue` (Issue numérica real, para rastreamento humano — nunca verificada por rede,
    já que o contrato é hermético por design);
  - `exit_conditions`: array com pelo menos uma entrada `MACHINE_VERIFIABLE`, cujo `check` resolve
    para uma função REAL, implementada em código, registrada em `makeInvariantChecks()` — nunca
    inventável via JSON. Entradas `HUMAN_OPERATIONS_VERIFIED` são permitidas para condições que o
    contrato genuinamente não consegue observar (causa raiz confirmada, verificação em produção) —
    são puramente auditáveis, nunca avaliadas mecanicamente.

Cada `MACHINE_VERIFIABLE` check é registrado com o `surface_id` que ele protege. Uma declaração
`conditional` cujo `exit_condition` referencia um check registrado para OUTRA superfície reprova D1
— sem isso, `surface_id` poderia ser trocado para qualquer superfície mantendo um invariante
emprestado que não verifica nada sobre ela.

D3, para uma declaração `conditional` bem formada, avalia cada invariante `MACHINE_VERIFIABLE`
contra o **estado atual do repositório** (nunca a base/diff) a cada execução. Se o invariante for
violado, D3 reprova com a mesma severidade que uma declaração `one_shot` obsoleta. "Isento de
staleness por idade" nunca significa "isento de verificação" — ver Seção 6 abaixo.

O detector Sentinel `change_intent_stale.mjs` importa as MESMAS funções (`validateLifecycle`,
`evaluateConditionalInvariants`, `makeInvariantChecks`) de `scripts/safety/surfaces.mjs` — nenhuma
segunda interpretação do modelo existe em lugar nenhum do repositório.

## Por que não um campo booleano "importante: nunca apagar"

Um booleano não distingue "isto precisa continuar assim" de "isto foi decidido arbitrariamente
como permanente" — e não impõe verificação nenhuma. O modelo `conditional` exige, estruturalmente,
que a obrigação seja acompanhada de pelo menos um fato REAL e continuamente verificado sobre o
mundo. Sem essa exigência, qualquer declaração poderia virar permanente só marcando um campo — a
mesma porta dos fundos que D3 existe para recusar, movida de "declaração nunca removida" para
"declaração nunca sequer precisou justificar por que continua lá".

## Revisão adversarial (antes de mesclar)

**Alguém poderia marcar uma declaração one_shot obsoleta como "conditional" só para calar D3?**
Só se conseguir nomear um `check` REAL, já implementado em código (não em CHANGE_INTENT.json), cujo
`surface_id` bata com a declaração, e cujo invariante GENUINAMENTE valha agora. Hoje só existe UM
check registrado (`BR2026_ROUND_EMAILS_DISARMED`, exclusivo de `NOTIFICATION_WORKFLOWS`) — toda
outra superfície não tem check algum registrado, então `conditional` é estruturalmente impossível
para elas até alguém escrever, revisar e mesclar uma função de verificação real — um code change
visível, não uma linha de JSON.

**Vira dívida permanente ignorada?** Não mecanicamente: o invariante `MACHINE_VERIFIABLE` é
reavaliado a cada execução do contrato, para sempre, até um humano remover a declaração. O que
FICA sem verificação automática são os campos `HUMAN_OPERATIONS_VERIFIED` (causa raiz confirmada
etc.) — puramente informativos por design (Seção 6: o contrato nunca finge provar um fato de
negócio que não pode observar). Uma futura revisão por idade (`CONDITIONAL_INTENT_REVIEW_DUE`,
deliberadamente NÃO implementada agora) poderia lembrar um humano de revisitar uma condicional
antiga — mas isso é um detector adicional, não uma mudança neste.

**JSON arbitrário pode contornar a segurança?** Não — `check` resolve contra um registro fechado em
código; um nome desconhecido reprova D1.

**Um usuário pode remover a verificação do invariante?** Só editando código (visível em diff/PR),
nunca via `CHANGE_INTENT.json` sozinho.

**Sentinel passa a perder intenções realmente obsoletas?** Não — o caminho `one_shot` é
byte-a-byte idêntico ao de antes; só uma declaração `conditional` bem formada E com invariante
válido fica isenta, e mesmo essa é ativamente checada a cada execução.

## Limite conhecido, documentado (não fingido)

Se alguém apagar a declaração `conditional` inteira de `CHANGE_INTENT.json` sem tocar no arquivo
protegido em si, nenhum check existente pega isso — D2 só dispara quando um caminho
`DECLARE_TO_CHANGE` aparece no diff, e D3 só avalia declarações que existem. Isto é um limite real
do modelo (`CHANGE_INTENT.json` nunca foi, e este ADR não o torna, uma trava contra a remoção da
própria documentação) — provado explicitamente em
`scripts/safety/test_safety_contract.mjs` ("LIMITE CONHECIDO"), não escondido.

## Consequência

A declaração real de emergência do BR2026 (Issue #238) foi migrada para `conditional` no mesmo
commit que introduz este modelo — preservando o estado de desarme, sem rearmar o workflow, sem
tocar em dado de participante ou Supabase. `npm run check` volta a ficar verde porque D3 consegue
agora representar honestamente uma obrigação de segurança de longa duração, não porque a
declaração foi apagada. `scripts/safety/test_change_intent_lifecycle.mjs` prova a camada de forma/
invariante isoladamente; `scripts/sentinel/test_change_intent_stale_detector.mjs` prova que o
Sentinel consome a mesma semântica; `scripts/safety/test_safety_contract.mjs` adiciona as mutações
M27–M33 (33/33 capturadas) mais o teste de limite conhecido.
