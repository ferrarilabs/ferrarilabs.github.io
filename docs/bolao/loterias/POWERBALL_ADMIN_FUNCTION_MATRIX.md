# Powerball — Admin Function Matrix

Every action listed in the audit spec, checked against actual code (not intent). "Visible" means
a control exists in the rendered page. Since the admin panel itself doesn't render (Incident 3),
every downstream column is `N/A — panel unreachable` rather than individually re-tested; the one
root blocker is called out once instead of repeated 20 times.

| Ação | Visível? | Funciona? | Persiste? | Recarrega correto? | Valida? | Audita? | Desfazível? | Pode duplicar? | Confirmação? |
|---|---|---|---|---|---|---|---|---|---|
| Criar sorteio | ❌ Não | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| Editar sorteio | ❌ Não | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| Criar participante | ❌ Não (só via CLI local + commit) | ⚠️ CLI funciona, UI não existe | ✅ (CLI) via git | ✅ (novo page load) | ⚠️ Só valida `@` no email (`add_participants.py`) | ❌ Nenhum log | ❌ Requer `git revert` | ⚠️ Sim — CLI não verifica duplicata robustamente entre draws | ❌ Nenhuma |
| Editar participante | ❌ Não | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| Remover participante | ❌ Não (só edição manual de `data.js`) | ⚠️ Manual | ✅ via git | ✅ | ❌ Nenhuma | ❌ Nenhum log | ❌ | N/A | ❌ |
| Registrar pagamento | ❌ Não (é o mesmo objeto do participante, editado à mão) | ⚠️ Manual, confirmado nesta sessão (Incidente 3) | ✅ via git | ✅ | ❌ Nenhuma (nenhuma checagem de valor negativo, moeda, duplicata de txId) | ❌ Nenhum log | ❌ | ⚠️ Sim — nada impede dois commits somando o mesmo pagamento duas vezes | ❌ |
| Corrigir pagamento | ❌ Não | ⚠️ Manual | ✅ via git | ✅ | ❌ | ❌ | ❌ | N/A | ❌ |
| Adicionar ticket | ❌ Não | ⚠️ Manual (`data.js` `sharedTickets.series`) | ✅ via git | ✅ | ❌ Nenhuma validação de formato de número (`parseTicketNumeros` falha silenciosamente — retorna `null`, ticket é descartado sem aviso) | ❌ | ❌ | N/A | ❌ |
| Corrigir ticket | ❌ Não | ⚠️ Manual | ✅ via git | ✅ | ❌ | ❌ | ❌ | N/A | ❌ |
| Publicar tickets | ❌ Não (não existe conceito de rascunho vs. publicado — tickets em `data.js` já são "públicos" assim que commitados) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| Registrar resultado | ❌ Não (é automático-por-browser, ver Incidente 1/2) | ⚠️ Só client-side, sem confirmação de estabilidade | ⚠️ Só `localStorage` do browser que buscou — **não persiste para ninguém mais** | ❌ Não — outro browser não vê o resultado buscado | ❌ Nenhuma checagem de estabilidade (ver Incidente 2) | ❌ | ❌ | ⚠️ Sim — sem idempotência, dois browsers podem ambos disparar e-mail | ❌ Nenhuma antes de enviar e-mail a todos |
| Buscar resultado | ✅ Automático (botão "↻ Tentar buscar novamente" existe, `pbResultRetryBtn`) | ✅ Fetch funciona (API pública NY Open Data) | ⚠️ Só localStorage local | ❌ | N/A | ❌ | N/A | N/A | N/A |
| Corrigir resultado | ❌ Não | ⚠️ Manual (`data.js`) | ✅ via git | ✅ | ❌ | ❌ | ❌ | N/A | ❌ |
| Calcular prêmio | ✅ Automático (`computePrize()`, roda a cada render se houver resultado) | ✅ Cálculo correto contra `prizeTable` | N/A (derivado, não persiste) | ✅ | N/A | ❌ | N/A | N/A | N/A |
| Criar próximo sorteio | ❌ Não | ⚠️ Manual (duplicar objeto em `data.js`) | ✅ via git | ✅ | ❌ Nada impede duplicar um `id` de sorteio | ❌ | ❌ | ⚠️ Sim, se alguém commitar duas vezes | ❌ |
| Pré-visualizar e-mail | ❌ Não existe nenhuma preview — o e-mail é montado e enviado no mesmo passo (`sendResultEmail()` monta `html` e chama `emailjs.send()` na mesma função, sem etapa intermediária) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| Enfileirar e-mail | ❌ Não existe fila — envio é síncrono e imediato | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| Reenviar e-mail | ❌ Não existe reenvio controlado — só recarregar a página, que re-dispara tudo (potencial duplicata, ver Incidente 2) | N/A | N/A | N/A | N/A | N/A | N/A | ⚠️ Sim, exatamente esse é o risco | ❌ |
| Exportar | ❌ Não existe | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| Auditar | ❌ Não existe nenhum log de auditoria (nem em `data.js`, nem em `localStorage`, nem em qualquer lugar) | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |

## Root blocker (repeats across nearly every row)

1. **No admin UI reaches production** — Incident 3. Every "administrative" action today is: a
   human edits `js/data.js` by hand (or via `add_participants.py`/`add-participant.js`, which only
   append/dedup participants, nothing else) and commits directly to `main`. There is no draft
   state, no review step, no confirmation, no undo other than `git revert`, and no audit trail
   beyond the git log itself (which records *that* something changed, with a commit message a
   human wrote, not a structured before/after).
2. **No persistence layer other than git.** Nothing in this app writes to Supabase, despite a full
   schema being documented in `docs/DATABASE_SETUP_SUPABASE.md` (see Data Model doc) — that schema
   was designed but never connected to any code path.
3. **Result-handling has no server round-trip at all** — a result "registered" by one browser via
   `localStorage` is invisible to every other browser and to the git-committed source of truth.

## What "real" would require

See `POWERBALL_PROFESSIONALIZATION_REPORT.md` for the prioritized plan. In short: a real backend
(Supabase, using the schema already drafted but never wired up, with RLS — see
`POWERBALL_SECURITY_REVIEW.md`), a real authenticated admin UI backed by it, and the outbox model
in `POWERBALL_EMAIL_RELIABILITY.md` sitting between "admin decides to send" and "email actually
goes out."
