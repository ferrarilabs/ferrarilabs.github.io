# CHATGPT.md — Bolão do Ferrari

Context file for AI assistants (ChatGPT, etc.) working on this codebase.

**`CLAUDE.md` (repo root) is the single source of truth for this project.** It is kept current
every session; this file previously duplicated its content and drifted out of date (still
described a single pre-BR2026/CDB2026 app as of 2026-06-27, three weeks after the platform had
already grown to three independent bolão apps and long after the Copa app moved from `bolao/`
to `bolao/copa2026/`). To avoid that drift happening again, this file no longer duplicates
`CLAUDE.md` — read `CLAUDE.md` first, exactly as a Claude Code session would.

`CLAUDE.md` covers: deployment, the three-app repository structure, the Copa do Mundo 2026
archive, script load order, state shape, scoring config for each app, admin auth, EmailJS/
Supabase setup, i18n, release process, rollback, and the full extended-documentation index
(`docs/bolao/*.md`).
