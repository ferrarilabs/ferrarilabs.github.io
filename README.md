# Ferrari Labs

FerrariLabs — Eduardo Ferrari's owner-operated technology practice.

## What this site is

A static website with one active service area and one background page:

- `/financial-crimes/` — **professional background and published writing** (AML, fraud, sanctions,
  model validation, AI in compliance, digital asset risk). **Not an active service offering:** the
  commercial Financial Crime solicitation is paused until employer / outside-activity clearance exists.
  Do not add calls to action, contact forms or service positioning to this page.
- `/small-business/` — practical technology for local and small businesses: websites,
  Google presence, lead capture/follow-up, scheduling, customer communication and automation
- `/small-business/pt/` — Portuguese localization of the small-business offer for the Charlotte-area Brazilian/Portuguese-speaking channel

The homepage (`index.html`) introduces FerrariLabs' small-business services and links to the background page.

## Contact form setup

The site includes a contact form designed for static hosting.

To activate it:

1. Create a form in Formspree.
2. Replace `REPLACE_WITH_YOUR_FORM_ID` in `index.html` with your Formspree form endpoint.
3. Create a Cloudflare Turnstile widget for your domain.
4. Replace `REPLACE_WITH_TURNSTILE_SITE_KEY` in `index.html` with your Turnstile site key.
5. In Formspree, enable Cloudflare Turnstile and add your Turnstile secret key.
6. In Formspree, restrict submissions to your domain.

## Deployment

This site is intended for GitHub Pages.


## Brand system

The corporate site uses the FerrariLabs Italian Heritage design system: Arial system typography, Forest `#0F3D2E`, Terracotta `#B85C3E`, Ivory `#F5EDE2`, Charcoal `#1F2937`, Warm Gray `#E7E1DA`, and Sage `#6F8579`. See `docs/website/BRAND_SYSTEM.md`.
