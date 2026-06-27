# Deploy — v4.0-clean

## Prerequisites

- GitHub repo `ferrarilabs.github.io` with GitHub Pages enabled on `main` branch.
- No build step. Just push HTML/CSS/JS files.

## Steps

1. Make sure only files under `bolao-teste/` changed — never touch the repo root site.
2. Commit:
   ```
   git add bolao-teste/
   git commit -m "Release bolao v4.0-clean"
   git push
   ```
3. GitHub Pages deploys automatically (usually < 2 min).
4. Open https://ferrarilabs.github.io/bolao-teste/ and run the QA checklist.

## Rollback

```
git revert HEAD
git push
```

Or revert to a specific commit:

```
git checkout <previous-commit> -- bolao-teste/
git commit -m "Revert bolao to previous version"
git push
```

## Local preview

```
python3 -m http.server 8080
```

Open http://localhost:8080/bolao-teste/

## What NOT to deploy

- Never push `.env` files, API keys, or service role keys.
- Never push the admin password in plain text.
- The `adminPasswordHash` in `config.js` is safe to push (it's a public one-way hash).
