# Ferrari Labs

FerrariLabs — Eduardo Ferrari's owner-operated technology practice.

## What this site is

A static website with two service areas:

- `/financial-crimes/` — financial crimes & compliance technology: AML, fraud, sanctions,
  model validation, AI in compliance, digital asset risk
- `/small-business/` — practical technology for local and small businesses: websites,
  Google presence, lead capture/follow-up, scheduling, customer communication and automation
- `/small-business/pt/` — Portuguese localization of the small-business offer for the Charlotte-area Brazilian/Portuguese-speaking channel

The homepage (`index.html`) briefly introduces FerrariLabs and links to both.

## Contact form setup

The contact form is live on every page that has one: `/`, `/financial-crimes/`, `/small-business/`,
`/small-business/pt/` and the root PT/ES/JP pages. All of them post to the same Formspree form and
use the same Cloudflare Turnstile widget. The form endpoint and the Turnstile site key are already in
the HTML; nothing needs to be replaced.

When changing the form:

1. Keep the Formspree endpoint and the Turnstile site key identical on every form page.
2. The Turnstile **secret** key lives only in Formspree (enable Turnstile there); never put it in this repo.
3. In Formspree, keep submissions restricted to `www.ferrarilabs.com`.
4. After any change, submit one test lead and confirm the notification reaches the business mailbox.

## Deployment

This site is intended for GitHub Pages.


## Brand system

The corporate site uses the FerrariLabs Italian Heritage design system: Arial system typography, Forest `#0F3D2E`, Terracotta `#B85C3E`, Ivory `#F5EDE2`, Charcoal `#1F2937`, Warm Gray `#E7E1DA`, and Sage `#6F8579`. See `docs/website/BRAND_SYSTEM.md`.
