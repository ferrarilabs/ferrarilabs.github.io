# Release Lock

Current release candidate: `v3.2.1-rc1`

## Rule for the final test day

Only accept:
- confirmed bugs,
- broken translations,
- broken payment/receipt/email/admin flows,
- incorrect match data that is visibly wrong.

Do not add:
- new features,
- new integrations,
- redesign,
- database/backend work,
- extra simulator logic.

## Emergency rollback

If production breaks, redeploy the previous stable zip:
`bolao_copa_2026_v3_2_surgical_fixes.zip`

## EmailJS template reminder

The EmailJS templates should contain only:

```text
{{{html_message}}}
```

Do not include `receipt_text`, `receipt_html`, or old raw detail variables.
