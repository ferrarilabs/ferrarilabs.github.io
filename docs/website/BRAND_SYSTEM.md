# FerrariLabs Website Brand System

Canonical source for the public FerrariLabs corporate website only.

## Scope

Applies to:
- `/index.html`
- `/financial-crimes/`
- `/small-business/`
- `/small-business/pt/`
- `/insights.html`
- translated corporate pages
- `/styles.css`
- `/assets/ferrarilabs-mark.svg`

## Brand architecture

FerrariLabs is the master brand with two service families:

1. **Business AI & Automation**
2. **Financial Crime Technology** — AML, KYC, Sanctions, Fraud, Digital Assets

Do not create separate service-family logos.

## Typography

Use system-default **Arial**:
`Arial, Helvetica, sans-serif`

No Google Fonts or other webfont dependency is required for the corporate website.

## Color tokens

- Forest: `#0F3D2E`
- Terracotta: `#B85C3E`
- Ivory: `#F5EDE2`
- Charcoal: `#1F2937`
- Warm Gray: `#E7E1DA`
- Sage: `#6F8579`

Forest is primary. Terracotta is a controlled accent, not normal body text. Ivory/white is the preferred light background.

### Text-safe shades (WCAG AA, 4.5:1)

The brand hexes above are used as-is for fills (buttons, card top rules, the mark). Where Terracotta or Sage appear as **small text**, use these same-hue shades, because the brand values fall below 4.5:1 there:

- Terracotta text on Forest (dark mode kickers, eyebrows, links): `#E1B5A7`
- Terracotta text on Ivory/white (light mode kickers, eyebrows, active language): `#95472F` (also the button hover shade)
- Sage text on Ivory/Warm Gray (light mode labels, footer note): `#56675E`

In dark mode the mark sits on a small Ivory plate so its Forest geometry stays visible on the Forest header.

## Logo

The website uses the geometric architectural mark at `/assets/ferrarilabs-mark.svg` plus an Arial wordmark rendered in HTML/CSS.

The mark intentionally uses:
- Forest top/left geometry
- Sage upper-right block
- Terracotta lower block
- Negative-space center

Never add horses, shields, racing badges, checkered flags, racing stripes, racecars, automotive silhouettes, Rosso Corsa styling, or Ferrari S.p.A.-like typography.

## UI rules

- Light mode is the default.
- Dark mode uses Forest rather than generic black/blue.
- Buttons use Forest or Terracotta with accessible contrast.
- Cards stay restrained, grid-aligned, and low-decoration.
- Generous whitespace and strong alignment are preferred over decorative effects.
- Headings use Arial Bold; body text uses Arial Regular.
- Preserve semantic HTML, keyboard focus, reduced-motion support, and responsive behavior.


## Small-business commercial messaging

The public SMB offer is outcome-led, not technology-led. Use these four customer-facing paths consistently:

1. **Get Found** — website, Google Business Profile, local-search foundations, domain/email basics.
2. **Don't Lose the Lead** — forms, quote requests, lead routing and follow-up.
3. **Run Smarter** — scheduling, integrations, repetitive-work automation and practical AI.
4. **Fix What's Broken** — targeted repairs to websites, forms, domains, email and customer-path friction.

Guardrails:
- FerrariLabs is not a low-cost website factory and should not compete primarily on price.
- A complete local-business website should normally start around $1,500+; smaller repair work can be priced below that when the scope is genuinely smaller.
- Do not manufacture retainers. Recurring fees require recurring work.
- Lead with the business outcome and the observable problem before describing tools or AI.
- Portuguese is a localization/acquisition channel, not a separate brand and not a signal that FerrariLabs serves only Brazilian-owned businesses.
- English remains the default corporate language; the Portuguese SMB page is a localized route for people who prefer Portuguese.

## Change-control rule

A FerrariLabs corporate-site branding change should stay within the corporate-site files listed above. Never propagate these colors/fonts into other applications incidentally.

## Repository workflow

The site is static and has no build step. Before merging:
1. Preview locally with `python3 -m http.server 8080`.
2. Check desktop and mobile widths.
3. Verify `/`, `/financial-crimes/`, `/small-business/`, and `/insights.html`.
4. Verify contact forms and Turnstile markup were not altered unintentionally.
5. Run the repository's required `npm run check` locally before completing the change.
6. Avoid unnecessary GitHub Actions runs; feature branches do not need remote CI merely for visual iteration.

Drive source of truth: FerrariLabs Small Business → 08 Website → FerrariLabs Website Brand Migration Specification.
