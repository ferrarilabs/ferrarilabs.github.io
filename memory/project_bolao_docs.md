---
name: project-bolao-docs
description: Comprehensive docs for Bolão do Ferrari exist in docs/bolao/ and CLAUDE.md/CHATGPT.md at repo root — read these before asking about the project in new sessions.
metadata:
  type: project
---

As of 2026-06-27, all Bolão documentation lives in two places:

1. `docs/bolao/` — 8 detailed files covering context, requirements, architecture, security, QA, bugs, changelog, roadmap.
2. `CLAUDE.md` / `CHATGPT.md` at repo root — compact reference for AI assistants; single source of truth for quick facts.

**Why:** Requested by Eduardo to reduce repeated context-setting across sessions. Start every bolão session by reading `CLAUDE.md` or `CHATGPT.md` — they cover the full tech stack, scoring rules, state shape, admin auth, external services, and what NOT to do.

**How to apply:** For any Bolão task, read `CLAUDE.md` first. For deep dives (security, architecture, QA), read the relevant `docs/bolao/` file rather than reading source code cold.
