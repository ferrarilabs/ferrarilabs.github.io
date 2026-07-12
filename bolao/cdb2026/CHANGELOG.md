# Bolão Copa do Brasil 2026 — CHANGELOG

## v1.4 — 2026-07-12

### Fixed — alinhamento topbar

- `align-items: center` no grid do topbar (desktop e mobile)
- `audit_scoring.py`: 5/5.

---

## v1.3 — 2026-07-12

### Fixed — segurança + CSS (Big Tech QA audit)

- **SEC LOW-1**: whitelist antes de `location.href` no switcher de bolão
- **CSS MOB-3**: `-webkit-backdrop-filter` adicionado (blur do topbar no iOS Safari ≤ 15)
- `audit_scoring.py`: 5/5.

---

## v1.2 — 2026-07-12

### Design — padronização 100% com a Copa do Mundo (auditoria sistemática)

Mesmas 11 correções do BR2026 v1.9, adaptadas para 6 botões no nav (`repeat(6, 1fr)`). `audit_scoring.py`: 5/5.

---

## v1.1 — 2026-07-11

### Fixed
- **Bug crítico de pontuação**: `scoreEntry()` usava `semiSet = new Set(results.semis)` para checar semifinalistas, ignorando campeão e vice-campeão que também chegaram ao Final Four. Corrigido para usar `semifinalistSet` (que inclui todos os 4 finalistas). Palpite no semifinalista que acerta o campeão agora recebe os 10 pts corretos.
- **Email throttle**: `_lastEmailTs` agora é marcado somente *após* o `await emailjs.send()` ter sucesso (com try/catch). Antes, uma falha de rede consumia o throttle de 30s e o usuário não conseguia retentar.
- **iOS Safari — switcher**: `appearance: none; -webkit-appearance: none` adicionados ao `.bolao-switcher select`. No iOS Safari o seletor agora respeita `border-radius: 999px` e a cor de fundo customizada.

## v1.0 — 2026-07-11

### Initial release
- **Palpites**: campeão, vice-campeão e 2 semifinalistas (4 dropdowns com mutual-exclusion)
- **Pontuação**: campeão exato = 30pts · vice exato = 20pts · semifinalista no Final Four = 10pts cada · máx. 70pts
- **Tiebreaker**: campeão acertado → vice acertado → nome Z→A
- **Ranking**: pontuação final quando admin trava resultado; sem ranking provisório (bolão de cup, não de liga)
- **Admin**: lock/unlock de resultados, marcar pagamentos, editar/apagar entradas, CSV export, Sync Supabase
- **EmailJS**: comprovante ao participante + notificação ao admin (mesmos templates dos outros bolões)
- **Supabase**: pronto para habilitar (`database.enabled: true` após criar row `id='cdb2026'`)
- **Bolão switcher**: dropdown no header para navegar entre Copa do Mundo, Brasileirão e Copa do Brasil
- **Melhorias incluídas desde o início**:
  - `preferRemoteResults` no merge de estado (equivalente ao Copa v4.108)
  - `document.hidden` guard no countdown (sem CPU em background)
  - Seção padrão = Ranking quando prazo passou (equivalente ao Copa v4.104)
  - Tiebreaker Z→A (equivalente ao Copa v4.105)
  - Auto-sync 30s quando Supabase habilitado (equivalente ao Copa v4.108)
- **Times**: placeholder com 8 clubes — Eduardo deve atualizar `js/data.js` com os quarterfinalsitas reais após o sorteio
- Não publicado ainda (sem link a partir do site principal)
