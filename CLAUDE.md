# CLAUDE.md — FerrariLabs Corporate Website

This repository root is the FerrariLabs corporate public website.

## Corporate scope

Corporate scope is limited to:
- `index.html`
- `index.pt.html`
- `index.es.html`
- `index.jp.html`
- `insights.html`
- `financial-crimes/`
- `small-business/`
- `assets/`
- `styles.css`
- `docs/website/`
- `CNAME`
- `sitemap.xml`
- `.nojekyll`
- corporate-only deployment, SEO, forms, analytics, accessibility, translation, and website QA needed by those surfaces

Corporate production origin is `https://www.ferrarilabs.com`. GitHub Pages deploys from `main`.

## Corporate boundary

Non-company personal projects are outside FerrariLabs corporate scope. Corporate agents must not index, inventory, summarize, monitor, modify, operate, or treat non-company personal projects as FerrariLabs assets, dependencies, infrastructure, products, evidence, or sources of truth.

If a task targets an excluded subtree, stop corporate processing for that subtree and use the nearest nested assistant-context file if one exists. Do not name or describe personal projects in root corporate context.

Do not import FerrariLabs corporate brand, governance, CRM, Drive, Gmail, PMO, accounting, or operating rules into non-company personal projects.

## Change safety

Preserve the current corporate pages, CNAME, Formspree/Cloudflare Turnstile behavior, analytics, accessibility, SEO, and translations.

Use reversible feature-branch/PR changes for non-trivial work. Never force-push or rewrite history. Avoid unnecessary GitHub Actions.

Before any GitHub write, verify the current repository, branch, and remote/owner context. Do not infer repository ownership from old conversation context.
