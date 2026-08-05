# Supabase Final Setup — Alan Rech & Audit Logging

## Status Atual

✅ **Código pronto:**
- Alan Rech adicionado a data.js com email correto (REDACTED_EMAIL)
- RLS policies criadas para permitir INSERT de scripts
- Audit logging system implementado (local logs + Supabase tables)
- add_participant_to_supabase.py script criado

⏳ **Pendente:** Executar supabase_setup.sql no Supabase para aplicar as mudanças

## Passo 1: Executar SQL Setup no Supabase

1. Abra https://app.supabase.com
2. Selecione projeto `cmhqkkfczotdnssupkni`
3. Vá para **SQL Editor** (menu esquerdo)
4. Abra um novo query e copie/cole o conteúdo completo de:
   ```
   bolao/loterias/powerball/scripts/supabase_setup.sql
   ```
5. Clique **Run** (ou Ctrl+Enter)

**O que isso faz:**
- Cria/atualiza tabelas: users, bolao_types, user_bolao_participation, audit_log, email_log
- Define RLS policies (SELECT para frontend, INSERT para scripts)
- Insere dados de exemplo (14 participantes do Powerball 2026-08-01)
- Cria índices para performance

## Passo 2: Verificar Dados no Supabase

Após executar o SQL, rode estas queries para confirmar:

```sql
-- Verificar usuários
SELECT name, email FROM public.users WHERE name = 'Alan Rech';

-- Verificar tipos de bolão
SELECT code, name FROM public.bolao_types LIMIT 5;

-- Verificar participação do Alan
SELECT u.name, u.email, p.bolao_draw_id, p.status
FROM public.users u
JOIN public.user_bolao_participation p ON u.id = p.user_id
WHERE u.name = 'Alan Rech';
```

## Passo 3: Executar Script de Participante (Opcional)

Se Alan Rech não aparecer na query acima, adicione manualmente:

```bash
python3 bolao/loterias/powerball/scripts/add_participant_to_supabase.py \
  --name "Alan Rech" \
  --email "REDACTED_EMAIL" \
  --draw "2026-08-01"
```

## Passo 4: Testar Email System

Após o Supabase estar pronto, teste o email:

```bash
# Preview para você revisar
python3 bolao/loterias/powerball/scripts/send_result_email.py --test-send powerball

# Broadcast para todos os participantes (com dados corretos)
python3 bolao/loterias/powerball/scripts/send_result_email.py --send-all powerball
```

## Verificar Logs & Audits

Após enviar emails, verificar em Supabase:

```sql
-- Emails enviados
SELECT recipient_email, recipient_name, status, sent_at 
FROM public.email_log 
WHERE draw_id = '2026-08-01'
ORDER BY sent_at DESC;

-- Histórico de operações
SELECT action, entity_id, status, created_at 
FROM public.audit_log 
WHERE DATE(created_at) = CURRENT_DATE
ORDER BY created_at DESC;
```

## Resumo de Dados

**Alan Rech — Powerball 2026-08-01:**
- Email: REDACTED_EMAIL
- Valor: US$20.00
- Método: Cash App
- txId: REDACTED_PAYMENT_REFERENCE
- Status: Verificado
- Data: 04/08/2026 1:15 PM

**Total de Participantes:** 14
- 1 organizador (Eduardo)
- 13 participantes verificados

**Próximo sorteio:** 03/08/2026 (US$748M jackpot — condicional se 01/08 não acumular)

## Próximos Passos

1. ✅ Executar supabase_setup.sql
2. ✅ Verificar dados com queries
3. ✅ Testar --test-send powerball
4. ✅ Se OK, executar --send-all powerball
5. ✅ Verificar logs em Supabase

**Qualquer erro?** Verifique:
- RLS policies estão criadas? `SELECT * FROM information_schema.table_privileges WHERE table_name IN ('users', 'audit_log', 'email_log')`
- Supabase URL e key estão corretas no script? (devem estar)
- Firewall/proxy permite acesso a https://cmhqkkfczotdnssupkni.supabase.co?

---

**Última atualização:** 2026-08-04
**Versão:** 1.0 (Alan Rech setup + Audit logging)
