# QA Checklist — Bolão v2

## Public flow
- [ ] Invalid email blocks save
- [ ] Valid email saves
- [ ] Receipt opens in new tab
- [ ] Returning to site allows scroll and navigation
- [ ] Ranking opens
- [ ] Participants opens
- [ ] Language switch updates static and dynamic content

## Score validation
- [ ] 1x2 cannot advance Team A
- [ ] 2x1 cannot advance Team B
- [ ] 1x1 requires explicit advancement
- [ ] 10x0 triggers unusual score warning
- [ ] Many identical scores trigger repetitive warning

## Admin
- [ ] Admin login works
- [ ] Admin logout works without clearing cache
- [ ] Delete entry appears in Admin
- [ ] Delete entry removes from ranking
- [ ] Delete entry attempts notification email

## Email/receipt
- [ ] New entry email has readable formatting
- [ ] No visible raw literal `\n` blob in main email template
- [ ] Podium appears in receipt/email
