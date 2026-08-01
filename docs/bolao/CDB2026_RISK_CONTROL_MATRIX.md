# CDB2026 — Risk & Control Matrix

**Gerado:** 2026-08, Fase 2, item 16 (§15-17 do mega-prompt).
**Regra de preenchimento:** todo controle listado aponta para código, teste ou procedimento
real — nenhuma linha genérica ou aspiracional. Onde não existe controle real, o campo diz
"NENHUM" explicitamente, não é omitido.

| # | Risco | Impacto se ocorrer | Controle existente | Onde verificar | Resíduo |
|---|---|---|---|---|---|
| 1 | Fórmula de pontuação divergir entre o que é exibido e o que "deveria" ser | Pagamento errado, disputa com participante | `audit_scoring.py` (transcrição Python, self-teste) + `audit_golden_master.mjs` (extrai a função REAL do `app.js`, não uma cópia) | `python3 bolao/cdb2026/scripts/audit_scoring.py`, `node bolao/cdb2026/scripts/audit_golden_master.mjs` | Baixo — dois mecanismos independentes cobrem o mesmo risco de ângulos diferentes |
| 2 | Merge de estado local×remoto perde um pagamento ou entrada (staleness sequencial) | Pagamento marcado desaparece; entrada de participante some | `mergeStates()` + read-merge-write em `saveRemoteState()` (AUDIT-01/02/03) | `node bolao/cdb2026/scripts/audit_state_merge.mjs` | Baixo para o caso sequencial |
| 3 | Merge de estado NÃO resolve escrita simultânea verdadeira (corrida) | Mudança de um admin apagada silenciosamente pela escrita quase simultânea de outro | **NENHUM controle técnico** — caracterizado, não corrigido (ver `ADR-002`) | Teste que PROVA o risco (não o resolve): `audit_state_merge.mjs`, seção "TRUE concurrent writes" | **Médio** — depende de dois admins agindo quase ao mesmo tempo, incomum mas possível |
| 4 | Segunda perna exibida com mandante/visitante trocado (recibo/CSV/ranking) | Participante vê seu próprio palpite invertido — confusão, disputa | `legTeams()` único ponto de orientação (AUDIT-05) | `audit_state_merge.mjs` "leg 2 home/away is SWAPPED" | Baixo |
| 5 | Jogo adiado gravado como resultado FINAL 0-0 | Pontuação errada para todas as entradas daquele confronto | Guarda `!postponed` (AUDIT-06) | Leitura de código (`app.js:2385-2407`) — sem teste automatizado de rede | **Médio** — sem teste automatizado, depende de revisão manual se a lógica da ESPN mudar |
| 6 | Admin marca pagamento errado sem deixar rastro | Disputa sem como reconstruir o que aconteceu | `appendAdminAuditLog()` em `toggle-paid` (AUDIT-08) | `CDB2026_CODE_INVENTORY.md` "Admin: Phases/Results/Payments/Entries" | Baixo para reconstrução; **ver risco 7** para confiabilidade do próprio log |
| 7 | Audit log alterado/apagado por quem tem acesso técnico (não é à prova de violação) | Trilha de auditoria não confiável num cenário adversarial | **NENHUM controle técnico** — limitação documentada (`ADR-004`) | `ADR-004` | **Médio-Alto se houver um adversário técnico; Baixo no caso normal (erro operacional, não ataque)** |
| 8 | Chave anônima do Supabase exposta publicamente permite escrita direta por qualquer visitante | Qualquer pessoa pode escrever na tabela `bolao_state` fora do app | RLS restringe operações a `id = 'cdb2026'` (não impede um visitante de reescrever o documento inteiro dessa linha) | `bolao/cdb2026/docs/DATABASE_SETUP_SUPABASE.md` (config SQL) | **Médio** — mitigado por RLS restrito à linha, mas não por autenticação de escrita |
| 9 | Recibo por e-mail nunca chega (fila em memória, sem retry persistente) | Participante não recebe comprovante, mas mensagem da UI dava a entender que sim | Fila serializada (`_emailQueue`) evita duplicidade por corrida, mas não sobrevive a refresh/fechar aba; mensagem corrigida (Fase 2 §6) para não prometer entrega | `bolao/cdb2026/js/app.js:1083-1118`; `renderReceiptBox()` como fallback sempre disponível | **Médio** — mitigado pelo comprovante local sempre disponível na página, mas o e-mail em si não tem garantia |
| 10 | XSS via campo controlado pelo usuário não sanitizado | Execução de script arbitrário na sessão de outro usuário/admin | `esc()` único ponto de sanitização, verificado em TODOS os 26 sites de `innerHTML =` (sweep de duplicação, Fase 2) | `CDB2026_MODERNIZATION_REPORT_2026-08.md` achado A10 | Baixo — nenhuma exceção encontrada, mas é uma disciplina manual, não automática (sem framework) |
| 11 | Sincronização automática ESPN trava um resultado errado sem confirmação humana | Pontuação/campeão errado publicado automaticamente | `withinResultMatchWindow()` + guarda `!postponed`; cai para confirmação manual em empate no agregado sem vencedor de pênaltis informado pela ESPN | `espnSyncAutoDisclaimer` (`i18n.js`, texto corrigido nesta modernização para descrever com precisão) | **Médio** — sem teste automatizado (R15 na `REQUIREMENTS_TRACEABILITY_MATRIX`) |
| 12 | `paid: true → false` (reversão) feita sem justificativa/confirmação extra | Pagamento legítimo desmarcado por engano ou clique errado | Audit log registra `from`/`to`, mas sem campo de motivo e sem confirmação extra (diferente de `clearAllData`, que usa `tripleConfirm`) | `renderAdminPayments()`, `app.js:3218-3234` | **Médio** — ver modelo futuro proposto em `CDB2026_MODERNIZATION_REPORT_2026-08.md` §5 |
| 13 | Cutoff de entrada contornável manipulando o relógio do navegador | Palpite enviado após o prazo real | Documentado como limitação conhecida (`CLAUDE.md`: "Enforcement is client-side only") | `CLAUDE.md` "Cutoff" | **Médio-Alto tecnicamente, mas historicamente sem incidente relatado** — aceito como risco de plataforma, não específico desta auditoria |
| 14 | Dependência de CDN (EmailJS, Supabase-js) comprometida (supply chain) | Código malicioso executado no navegador de todo participante | SRI (Subresource Integrity) configurado nos dois `<script>` do CDN (`index.html:21-26`, `integrity="sha384-..."`) — o navegador recusa o script se o hash não bater | `CDB2026_DEPENDENCY_INVENTORY.md` | Baixo — mitigado por SRI; resíduo é o CDN ficar fora do ar (falha de disponibilidade, não de integridade) |

## Resumo por severidade residual

- **Baixo:** 1, 2, 4, 6, 10, 14.
- **Médio:** 3, 5, 8, 9, 11, 12.
- **Médio-Alto / aceito como risco de plataforma preexistente:** 7 (cenário adversarial), 13.

Nenhum item acima foi corrigido silenciosamente nesta modernização além do que já está listado
como "Controle existente" com referência a um commit desta Fase 2 (itens 4, 6, 9, 10 têm partes
corrigidas nesta auditoria/modernização; os demais são caracterização, não correção).
