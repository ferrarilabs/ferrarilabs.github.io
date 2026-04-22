# Ferrari Labs

Personal site for Eduardo Ferrari.

## What this site is

A static website focused on:

- financial crime transformation
- AML, fraud, and sanctions strategy
- model validation and explainability
- AI in compliance environments
- digital asset risk

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
