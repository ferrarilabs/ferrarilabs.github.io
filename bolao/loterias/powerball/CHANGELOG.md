# CHANGELOG — Ferrari Lotteries (Powerball / Mega Millions)

Este arquivo não existia até 2026-08-13. As entradas anteriores a essa data estão nas mensagens
de commit e em `docs/bolao/loterias/`; daqui para frente o histórico do app mora aqui, como nos
outros três bolões.

---

## 2026-08-24 — Issue #321: intake migrado para Cloudflare Worker

O canal de reporte mudou de runtime: deixou de ser uma Edge Function do projeto Supabase que
guarda participante, pagamento e scoring, e virou um **Cloudflare Worker isolado**
(`ferrarilabs-support-intake`). Motivo em `docs/bolao/adr/ADR-021-intake-em-cloudflare-worker.md`.

Em uma frase: no Supabase os segredos do projeto sao **injetados** em toda Edge Function; num Worker
os bindings sao **declarados**. O que nao esta no `wrangler.jsonc` nao existe no ambiente.

**O que muda neste app:** so o `endpoint` do `reportProblem`, que ficou **vazio**. Ele sera
preenchido no momento da ativacao, quando o endereco publico do Worker existir. Deixar a URL antiga
apontaria o cliente exatamente para o runtime que a migracao existe para abandonar.

**Nada aparece:** `reportProblem.enabled` continua `false`, e sem endpoint o componente nao monta.
As duas chaves de ativacao seguem desligadas.

**Scoring, ranking, entradas e pagamentos: intocados.**


## 2026-08-24 — Issue #321: versao do aviso de privacidade no coletor

O coletor compartilhado (`bolao/shared/js/report_safe_context.js`) passa a enviar
`noticeVersion` — qual versao do aviso de privacidade a pessoa VIU ao enviar o relato.

O texto do aviso vai mudar. A partir dai, "o que foi comunicado a esta pessoa" viraria pergunta de
memoria, e essa e exatamente a pergunta que importa se alguem pedir remocao ou questionar o que foi
coletado.

**Nada aparece e nada e enviado:** `reportProblem.enabled` continua `false`, e o canal segue inerte
tambem no servidor.

**Scoring, ranking, entradas e pagamentos: intocados.**


## 2026-08-24 — Issue #321: UI de reporte, montada e desligada

Entra o componente compartilhado do "Reportar problema" (`bolao/shared/js/report_ui.js` e
`report.css`): modal acessivel, quatro idiomas (pt-BR, en, es, ja), foco preso enquanto aberto,
`Escape` fecha, foco devolvido ao elemento de origem, e tela cheia a partir de 320px — porque
caixa flutuante em 320px vira janela de 280px com scroll duplo.

**Nada disso aparece.** `reportProblem.enabled` continua `false`, e com a flag desligada o
componente nao cria botao, nao registra listener e nao toca no DOM. O ponto de montagem no HTML
fica um `<div>` vazio. Um botao visivel sem backend aceito seria um botao morto — pior que a
ausencia dele, porque ensina o participante que reportar nao funciona.

O modal traz o aviso de privacidade em destaque (nao escondido atras de clique) e uma divulgacao
tecnica recolhida que mostra o objeto REAL que sairia do navegador, campo a campo — se algum campo
novo entrar no coletor, ele aparece la sozinho. E diz a verdade sobre expectativa: este canal nao e
suporte e nao garante resposta.

**Scoring, ranking, entradas e pagamentos: intocados.** Os tres `audit_scoring.py` continuam
passando.


## 2026-08-24 — Issue #321: canal de reporte de problema, desligado

O app ganha a chave de configuracao `reportProblem`, **desligada** (`enabled: false`), e mais
nada: nenhuma UI, nenhuma requisicao, nenhuma mudanca de comportamento para o participante.

A Edge Function `user-report-intake` foi implementada no mesmo PR mas **nao esta implantada**, e
nenhum dos oito segredos exigidos existe. Enquanto isso for verdade, um botao visivel seria um
botao morto — pior que nao ter botao, porque ensina o participante que reportar nao funciona. Por
isso a UI fica para a fase 2, junto com a provisao de producao.

O canal foi desenhado como um intake de incidentes **externo e nao confiavel**: o relato bruto vai
para um repositorio **privado** e nunca cruza automaticamente a fronteira privado->publico. O
endpoint nao alcanca banco de participante, pagamento, scoring nem competicao.

**Scoring, ranking, entradas e pagamentos: intocados.** Os tres `audit_scoring.py` continuam
passando.

Detalhe completo — modelo de ameacas, dados coletados e excluidos, retencao, rollback e runbook de
triagem — em `docs/bolao/SECURE_USER_REPORTING.md`.


## 2026-08-13 — Modernização do ciclo de vida das loterias

### Incidente fechado: run 31679185588

Na noite de 12/08 os 16 participantes receberam o resultado por e-mail e o workflow terminou
**vermelho**. Sequência real:

```
07:46:57  resultado gravado no data.js e commitado
07:47:48  "Broadcast completed: 16 sent, 0 failed"
07:47:49  settle_outbox_event -> 400 TRANSICAO_ILEGAL (evento em pending, esperado in_flight)
          exit 2
```

`emit_outbox_event` cria a obrigação em `pending`; o banco só liquida `in_flight`. **Nada a
reivindicava** entre uma coisa e outra. Consequência: entrega feita, obrigação presa em `pending`
para sempre — nenhuma execução seguinte voltava a olhar para ela — e o painel vermelho por um
motivo sem relação com a entrega.

O relatório de erro ainda **mentiu**: decidia `PROVIDER_CALLS` procurando a substring `"send"` na
mensagem da exceção. A mensagem não continha `"send"`, então afirmou **zero envios** depois de 16
e-mails reais aceitos.

**Estado de produção reconciliado** (leitura + reparo via `lottery_production_state.yml`):

| | |
|---|---|
| `PB_20260812_CANONICAL_RESULT_NULL` | NO — `[4, 26, 66, 67, 69] PB 9`, Power Play 2x |
| `PB_20260812_RESULT_HASH_PRESENT` | YES — `63bc7d9fc48cd620` |
| `PB_20260812_PRIZE_CREDIT_COUNT` | 1 (US$ 38,00) |
| `PB_20260812_DRAW_SETTLED` | YES (outbox `pending` → `sent`) |
| `PB_20260812_PROVIDER_CALLS_DURING_REPAIR` | 0 |
| `PB_20260812_RESENT` | 0 |
| `CURRENT_CARRYOVER` | US$ 39,00 |

### Corrigido

- **O jackpot lido era o do sorteio já realizado.** `jackpot_oficial` lia
  `powerball.com/draw-result`, cujo "Estimated Jackpot: $1.04 Billion" é o prêmio do sorteio de
  12/08 — fato histórico. O próximo sorteio vale **US$ 20 milhões**: o jackpot foi ganho e o jogo
  voltou ao piso. A política abre bolão acima de US$ 500M, então a leitura antiga concluiria
  "ELEGÍVEL" sobre um jackpot que não existe mais. A guarda é estrutural: jackpot só vale se
  pertencer a um sorteio que **ainda não ocorreu**.
- **A matriz da Mega Millions não era multiplicação.** Conferida contra a matriz que a própria
  megamillions.com publica (MatrixID 4, vigente desde 2025-04-04): em três faixas o valor oficial
  não é base × fator — 4 acertos US$599 → 2X US$1.000; 1+Mega Ball US$4 → 2X US$14; 0+Mega Ball
  US$2 → 2X US$10. `matrixVerified` passa a `true`, sustentado por `verify_mm_matrix.py`, que
  reconfere centavo por centavo contra o endpoint oficial.
- **A reivindicação virou portão.** Sem lease, o provedor não é tocado. Falhar antes de enviar
  custa um ciclo; falhar depois custa e-mail duplicado.
- **A obrigação órfã ganhou recuperação.** `_reconcilia_outbox_orfao` fecha a obrigação a partir
  do ledger por destinatário (que prova a entrega), com zero chamadas ao provedor.
- **Assunto de e-mail:** o resultado da Powerball saía com ⚽. Política única em
  `bolao/shared/scripts/subject_policy.py` — Powerball 🔴, Mega Millions 🔵, futebol ⚽, campeão
  final de competição 🏆 (e só ele).
- **`RESULT_EMAIL_DUPLICATE` lia `entry_ref`**; o campo é `entryRef`. Anunciava 15 duplicatas numa
  entrega sem nenhuma.
- **`DRAW_SETTLED` comparava com `'settled'`**; o enum do banco diz `'sent'`.

### Adicionado

- `lottery_status.py` / `lottery_status.json` — um documento só com jackpots, elegibilidade, pool
  escolhido e caixa. A UI e o e-mail leem daqui; nenhum dos dois recalcula a regra.
- `poll_results.py` — coleta idempotente com janela de recuperação de 10 dias. Slot perdido vira
  atraso, nunca perda. Powerball seg/qua/sáb, Mega Millions ter/sex, mais catch-up diário.
- `settle_draw.py` — liquidação derivada e idempotente. Reprocessar credita zero.
- `inspect_production_state.py` — os quatro fatos (resultado, livro-razão, ledger, outbox) num
  lugar só. Leitura por padrão.
- Parser da **NC Education Lottery** (secundária) para os dois jogos, escrito contra o HTML real.
- **NY Open Data** passa a procurar a linha do sorteio pedido e vira fallback também da Mega
  Millions — é a única fonte com histórico, e é o que faz a recuperação funcionar.
- Painel **"Próximo bolão"** na página, com o limiar em português claro.
- Bloco de caixa e jackpots no e-mail de resultado (**futuros**; o de 12/08 não foi reenviado).
- `test_failure_injection.py` — SIGKILL no meio da escrita, diretório sem permissão, linha
  truncada, 12 processos disputando a mesma chave, 6 coletores simultâneos.
- `test_run_31679185588_regression.py` — reproduz a noite inteira contra a máquina de estados
  real do banco.

### Testes corrigidos que estavam vermelhos por motivo errado

- `test_production_workflow_health` procurava `"return 2"` numa janela de 700 caracteres depois de
  `except Exception`; um comentário novo empurrou o `return` para fora e a suíte ficou vermelha com
  o código certo. Passa a **executar** `main()` e conferir o código de saída.
- `test_metadata_concurrency` esperava que o `data.js` de produção tivesse um sorteio aberto. Com
  o resultado de 12/08 gravado, não havia mais. Agora constrói a precondição na cópia.
- `test_outbox_precedes_provider`: o dublê nunca implementou `claim_outbox` e o ciclo engolia o
  `AttributeError` — passava verde pelo mesmo defeito da run 31679185588.

### Não alterado, de propósito

Scoring, bracket e regra de torneio dos três bolões de futebol. Os quatro `audit_scoring.py`
passam. Nenhum e-mail real enviado, nenhum bilhete comprado, `autoPurchase` segue `false` e não
existe caminho de código que fale com meio de pagamento.
