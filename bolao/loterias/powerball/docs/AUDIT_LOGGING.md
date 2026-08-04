# Audit Logging & Compliance

Complete audit trail for all Powerball email operations and data changes.

## Overview

The system maintains three levels of audit trails:

1. **Local Logs** — Script execution logs (file system)
2. **Email Log** — Detailed email sending records (Supabase)
3. **Audit Log** — All data operations and changes (Supabase)

## 1. Local Logs

### Location
```
bolao/loterias/powerball/logs/send_result_email_YYYYMMDD_HHMMSS.log
```

### Format
```
2026-08-04 17:27:18,327 | INFO     | Loading participants from Supabase for draw 2026-08-01
2026-08-04 17:27:18,453 | INFO     | ✓ Loaded 14 participants from Supabase for draw 2026-08-01
2026-08-04 17:27:18,454 | INFO     | Starting broadcast to 14 participants for draw 2026-08-01
2026-08-04 17:27:19,123 | INFO     | 📤 Sending email to emferrari@gmail.com [Eduardo Ferrari]
2026-08-04 17:27:20,456 | INFO     | ✅ Email sent successfully to emferrari@gmail.com
```

### Log Levels
- **INFO** — Normal operations (email sent, data loaded, etc.)
- **WARNING** — Issues that don't prevent execution (fallback used, etc.)
- **ERROR** — Critical failures (email failed, data missing, etc.)
- **DEBUG** — Detailed technical info (audit log written, etc.)

### Every Execution Logs
- Script start time
- Arguments passed
- Participant count loaded
- Broadcast start/completion
- Total sent/failed counts
- Log file location
- Execution duration

## 2. Email Log (Supabase)

### Table: `email_log`

Detailed record of every email sent, including delivery status and metadata.

```sql
SELECT 
  recipient_email,
  recipient_name,
  subject,
  bolao_type,
  draw_id,
  status,           -- 'sent', 'failed', 'bounced', etc.
  sent_at,
  error_reason
FROM public.email_log
WHERE draw_id = '2026-08-01'
ORDER BY sent_at DESC;
```

### Query Examples

**All emails for a draw:**
```sql
SELECT recipient_name, recipient_email, status, sent_at
FROM email_log
WHERE draw_id = '2026-08-01'
ORDER BY sent_at;
```

**Failed emails:**
```sql
SELECT recipient_email, error_reason, sent_at
FROM email_log
WHERE status = 'failed'
ORDER BY sent_at DESC;
```

**Today's sends:**
```sql
SELECT COUNT(*) as total, 
       SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as successful,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
FROM email_log
WHERE DATE(sent_at) = CURRENT_DATE;
```

## 3. Audit Log (Supabase)

### Table: `audit_log`

High-level audit of all operations: who did what, when, with what result.

```sql
SELECT 
  action,              -- 'email_sent', 'participants_loaded', 'broadcast_started'
  entity_type,         -- 'email', 'draw', 'user'
  entity_id,           -- email address, draw ID
  status,              -- 'success', 'failed', 'partial'
  details,             -- JSON with operation details
  performed_by,        -- 'send_result_email.py'
  created_at
FROM public.audit_log
WHERE DATE(created_at) = CURRENT_DATE
ORDER BY created_at DESC;
```

### Action Types

| Action | Entity | Meaning |
|--------|--------|---------|
| `participants_loaded` | draw | Participant list fetched (from Supabase or data.js) |
| `broadcast_started` | draw | Email broadcast beginning for a draw |
| `email_sent` | email | Single email sent successfully |
| `email_failed` | email | Single email send failed |
| `broadcast_completed` | draw | Broadcast finished (success/partial/failure) |

### Query Examples

**All operations today:**
```sql
SELECT action, entity_type, entity_id, status, details, created_at
FROM audit_log
WHERE DATE(created_at) = CURRENT_DATE
ORDER BY created_at DESC;
```

**All broadcasts (start + completion):**
```sql
SELECT action, entity_id as draw_id, status, details, created_at
FROM audit_log
WHERE action IN ('broadcast_started', 'broadcast_completed')
ORDER BY created_at DESC;
```

**Participant load failures:**
```sql
SELECT action, entity_id, details, error_message, created_at
FROM audit_log
WHERE action = 'participants_load_failed'
ORDER BY created_at DESC;
```

**Full trace of one broadcast:**
```sql
WITH draw_id AS (
  SELECT '2026-08-01' as id
)
SELECT action, entity_id, status, details, created_at
FROM audit_log
WHERE entity_id = (SELECT id FROM draw_id)
  OR (action LIKE 'broadcast_%' AND entity_id = (SELECT id FROM draw_id))
ORDER BY created_at;
```

## Compliance & Traceability

### What's Tracked
- ✅ Who ran the script (script name, timestamp)
- ✅ When each email was sent
- ✅ To whom (name + email)
- ✅ For which draw/game
- ✅ Success/failure status
- ✅ Error messages (if failed)
- ✅ How many participants were targeted
- ✅ How many actually received emails
- ✅ Which data source was used (Supabase vs. data.js fallback)

### Retention

- **Local logs:** Keep indefinitely (in git repo)
- **Supabase logs:** Keep indefinitely (encrypted at rest)
- **Email log:** Keep for 2 years (compliance + troubleshooting)
- **Audit log:** Keep for 7 years (legal requirement)

### Access Control

All logs are read-only from the frontend (RLS policies in place):
- Supabase employees: Cannot access
- Frontend app: SELECT only (no INSERT/UPDATE/DELETE)
- Python script: INSERT only (can log but not modify)
- Admin: Full access for compliance audits

## Troubleshooting with Logs

### Email didn't send but script says it did

1. **Check local log:**
   ```bash
   cat bolao/loterias/powerball/logs/send_result_email_*.log | grep "recipient@email.com"
   ```

2. **Check email_log in Supabase:**
   ```sql
   SELECT * FROM email_log WHERE recipient_email = 'recipient@email.com' ORDER BY sent_at DESC LIMIT 5;
   ```

3. **Check audit_log for errors:**
   ```sql
   SELECT * FROM audit_log WHERE entity_id = 'recipient@email.com' AND status = 'failed';
   ```

### Participant count mismatch

1. **Check if Supabase was consulted:**
   ```bash
   grep "Loading participants" bolao/loterias/powerball/logs/send_result_email_*.log
   ```

2. **Check which data source was used:**
   ```bash
   grep "source" bolao/loterias/powerball/logs/send_result_email_*.log
   ```

3. **Verify draw exists in Supabase:**
   ```sql
   SELECT COUNT(*) FROM user_bolao_participation
   WHERE bolao_draw_id = '2026-08-01' AND status = 'active';
   ```

### Broadcast failed midway

1. **Check total sent vs. expected:**
   ```sql
   SELECT COUNT(*) FROM email_log
   WHERE draw_id = '2026-08-01' AND status = 'sent';
   ```

2. **See which emails failed:**
   ```sql
   SELECT recipient_email, error_reason FROM email_log
   WHERE draw_id = '2026-08-01' AND status = 'failed';
   ```

3. **Check if fallback was triggered:**
   ```bash
   grep "Supabase unavailable\|Falling back" bolao/loterias/powerball/logs/send_result_email_*.log
   ```

## Monitoring

### Daily Check

```bash
# See latest log
ls -ltr bolao/loterias/powerball/logs/ | tail -1

# Check for failures
grep "ERROR\|FAILED" bolao/loterias/powerball/logs/send_result_email_*.log
```

### Weekly Audit

```sql
-- Summary of last 7 days
SELECT 
  DATE(sent_at) as date,
  COUNT(*) as total_emails,
  SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
FROM email_log
WHERE sent_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(sent_at)
ORDER BY date DESC;
```

## Compliance Reports

### Email Delivery Report
```sql
SELECT 
  draw_id,
  COUNT(*) as emails_sent,
  MAX(sent_at) as latest_send,
  MIN(sent_at) as earliest_send
FROM email_log
WHERE DATE(sent_at) = '2026-08-01' AND status = 'sent'
GROUP BY draw_id;
```

### Failed Delivery Report
```sql
SELECT 
  draw_id,
  recipient_email,
  recipient_name,
  error_reason,
  sent_at
FROM email_log
WHERE DATE(sent_at) >= '2026-08-01' AND status = 'failed'
ORDER BY draw_id, sent_at DESC;
```

### Participant Accuracy Report
```sql
SELECT 
  d.bolao_draw_id as draw,
  COUNT(*) as registered_participants,
  (SELECT COUNT(*) FROM email_log e 
   WHERE e.draw_id = d.bolao_draw_id AND e.status = 'sent') as emails_delivered
FROM user_bolao_participation d
WHERE d.bolao_type_id = (SELECT id FROM bolao_types WHERE code = 'powerball')
GROUP BY d.bolao_draw_id;
```
