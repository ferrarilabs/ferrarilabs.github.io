# v3.2.1 RC1 Release Lock

Final surgical patch before production testing.

## Fixed
- England, Scotland and Wales flags now use correct Unicode tag flag sequences.
- Initial bracket dropdown options no longer show hardcoded `Time A` / `Time B`.
- Score input >20 is cleared without noisy alert while typing; final save validation still blocks invalid scores.
- Standalone receipt HTML now uses i18n labels for PT-BR, ES and EN-US.
- Added release lock documentation and changelog.

## Not changed
- No scoring changes.
- No admin/auth changes.
- No email payload changes.
- No broad schedule/data rewrite.
- No architecture rewrite.

## Release guidance
Treat this package as `v3.2.1-rc1`. Only fix real user-tested bugs from here.
