# CDB2026 — Operations Runbook

**Gerado:** 2026-08, Fase 2, item 16 (§26 do mega-prompt).
**Objetivo:** procedimentos operacionais reais para as situações mais prováveis, com o comando
ou tela exata a usar — não um runbook genérico.

## Sincronização com o servidor falhou (toast laranja "Salvo neste dispositivo, mas...")

**O que aconteceu:** `saveState()` salvou local mas `saveRemoteState()` rejeitou ou falhou
(`app.js:96-102`, toast `syncFailed` adicionado na Fase 1 desta auditoria).

**Ação:**
1. Não fechar a aba — o dado só existe em `localStorage` até a próxima tentativa de sync bem-sucedida.
2. Verificar conexão de rede do dispositivo.
3. Se persistir, verificar o status do Supabase (`https://cmhqkkfczotdnssupkni.supabase.co`) e/ou
   rodar a leitura read-only do backup (`CDB2026_BACKUP_AND_RECOVERY.md`) para confirmar se o
   remoto está acessível.
4. Assim que a rede voltar, qualquer ação que chame `saveState()` de novo (ex. reabrir a aba)
   tenta sincronizar novamente — não há botão de "retry manual" dedicado.

## Admin esqueceu a senha / bloqueado por 5 tentativas erradas

**Mecanismo:** `sessionStorage["cdb2026_loginAttempts"]`/`cdb2026_loginLockUntil"` —
bloqueio de 15 minutos após 5 tentativas (`CLAUDE.md` "Admin").

**Ação:**
1. Esperar 15 minutos, OU
2. Abrir em uma aba anônima/outro navegador (o bloqueio é por `sessionStorage`, local ao
   navegador — não é bloqueado no servidor).
3. Para trocar a senha: gerar um novo hash SHA-256 (comando em `CLAUDE.md` "Admin") e substituir
   `config.adminPasswordHash` em `bolao/cdb2026/js/config.js`, commitar e fazer deploy (push a
   `main`).

## Um confronto foi criado errado pela sincronização ESPN (times/fase errados)

**Ação:**
1. Ir em Admin → Fases/Confrontos.
2. Se nenhuma entrada ainda tem palpite para esse confronto: excluir e recriar manualmente.
3. Se já existem palpites: **não excluir sem avaliar impacto** — excluir um confronto com
   palpites órfãos os deixa sem aviso ao participante (ver `confirmRemoveTieWithPicks` em
   `i18n.js`, que já avisa o admin disso na própria UI antes de confirmar).
4. Registrar a correção manualmente se for uma situação incomum — não há um audit-log dedicado
   para "correção de confronto" além do genérico (ver `CDB2026_RISK_CONTROL_MATRIX.md` risco 6).

## Um jogo foi marcado como resultado errado pela sincronização automática da ESPN

**Ação:**
1. Ir em Admin → Resultados, localizar o confronto/perna.
2. Usar "Destravar" (`unlock-tie`, se já travado) para permitir edição.
3. Corrigir manualmente e salvar — isso grava um evento `save-leg`/`edit-leg` no audit log com
   o valor anterior preservado.
4. Se o erro já afetou pontuação exibida a participantes, considerar se uma comunicação é
   necessária (decisão de produto, não técnica).

## Preciso corrigir um pagamento marcado errado (`true` → `false`)

**Estado atual (sem mudança nesta modernização — ver `ADR` e `CDB2026_MODERNIZATION_REPORT`):**
um clique em Admin → Pagamentos já reverte e grava `from`/`to` no audit log, mas **sem** campo de
motivo e sem confirmação extra (diferente de excluir uma entrada, que usa `tripleConfirm`).

**Ação:**
1. Confirmar com a pessoa certa (ex. checar com quem processou o pagamento) antes de reverter.
2. Reverter em Admin → Pagamentos.
3. Registrar o motivo FORA do sistema (ex. mensagem para o Eduardo) até que o campo `reason`
   proposto em `CDB2026_MODERNIZATION_REPORT_2026-08.md` §5 seja implementado (não implementado
   nesta modernização).

## Preciso renomear/corrigir uma entrada existente (ex.: participante criou uma 2ª entrada)

**Precedente real:** REDACTED_PARTICIPANT, 2026-08-01 — entrada de 2026-07-16 renomeada para
"REDACTED_PARTICIPANT #1", nova entrada de 2026-08-01 para "REDACTED_PARTICIPANT #2".

**Ação (procedimento seguido nesse caso real, seguro e reversível):**
1. Ler o estado remoto (read-only, ver `CDB2026_BACKUP_AND_RECOVERY.md` para o comando `curl`).
2. Identificar as entradas certas por `id`/`createdAt` (nunca por nome — dois participantes
   podem ter nomes parecidos).
3. Fazer backup local do estado lido antes de qualquer escrita.
4. Editar SOMENTE o campo `entryName` das entradas certas (não tocar em `picks`, `paid`, ou
   qualquer outro campo).
5. Escrever de volta via `POST` com `Prefer: resolution=merge-duplicates`, o mesmo padrão do
   app.
6. Verificar com uma leitura de confirmação.

**Alternativa via UI (mais simples, para uso rotineiro sem acesso a terminal):** Admin →
Entradas → editar entrada (se a UI oferecer edição de nome) — usar o procedimento manual via
`curl` só quando a UI não cobrir o caso ou para correções em lote.

## Preciso restaurar de um backup depois de um erro grave

Ver `CDB2026_BACKUP_AND_RECOVERY.md` — procedimento completo de restauração com validação por
`audit_integrity.py` antes de escrever de volta.

## Suspeita de inconsistência nos dados (algo não bate)

**Ação:**
1. Baixar o estado atual (leitura read-only).
2. Rodar `python3 bolao/cdb2026/scripts/audit_integrity.py --file <arquivo>`.
3. Ler os achados por nível — `CRITICAL` exige ação imediata, `WARNING`/`INFO` são para revisão,
   não necessariamente um bug.
4. Se o achado envolver pontuação, cruzar com `python3 bolao/cdb2026/scripts/audit_scoring.py`
   e `node bolao/cdb2026/scripts/audit_golden_master.mjs` antes de concluir que é um bug de dado
   (pode ser um bug de fórmula, escopo diferente).

## Deploy de uma correção

Ver `CLAUDE.md` "Release process": editar em `bolao/cdb2026/`, bump `siteVersion` em
`config.js`, adicionar entrada no `CHANGELOG.md` do app, commit e push a `main` (GitHub Pages
faz deploy automático, sem etapa de build), rodar `docs/bolao/QA_CHECKLIST.md`.

**Antes de qualquer deploy que toque scoring/merge/orientação de dados**, rodar TODA a suíte:
```bash
python3 bolao/cdb2026/scripts/audit_scoring.py
node bolao/cdb2026/scripts/audit_state_merge.mjs
node bolao/cdb2026/scripts/audit_golden_master.mjs
python3 bolao/cdb2026/scripts/audit_integrity.py
```
E os das apps irmãs, por regra de propagação do `CLAUDE.md`:
```bash
python3 bolao/br2026/scripts/audit_scoring.py
python3 bolao/copa2026/scripts/audit_scoring.py
```
