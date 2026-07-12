# Bolão Copa do Brasil 2026 — CHANGELOG

## v2.0 — 2026-07-12

### Novo — palpites por confronto (placar agregado ida+volta), símbolos de time, comprovante

Reformulação pedida por Eduardo: regras similares à Copa do Mundo (placar por jogo, 10/5/1
pts), com a diferença de que os times de Quartas/Semifinal/Final só se definem — e só ficam
liberados para palpite — conforme a fase anterior termina.

- **Palpites por confronto**: além dos 4 palpites de pódio (campeão/vice/2 semifinalistas —
  mantidos travados desde antes do cutoff global, igual à Copa: se o time cai, o bônus é
  perdido, sem chance de trocar depois), agora existe um palpite de **placar agregado**
  (ida+volta) para cada um dos 15 confrontos do bracket (8 oitavas + 4 quartas + 2 semifinal +
  1 final). Pontuação por confronto: 10 pts placar exato / 5 pts quem avança certo / 1 pt um
  dos dois lados do agregado certo — mesmos valores da Copa do Mundo (`bolao/js/config.js`),
  aplicados ao agregado.
- **`js/data.js`**: bracket completo (`DATA.ties`), com Quartas/Semifinal/Final como slots
  `home:null/away:null` que resolvem dinamicamente a partir do resultado do confronto anterior
  (`fromHome`/`fromAway`) — mesmo padrão de resolução de bracket da Copa do Mundo. Datas e
  emparelhamento de Quartas em diante são placeholder até a CBF confirmar o chaveamento real.
- **Reabertura de palpites fase a fase**: cada confronto tem seu próprio `cutoffIso` (1h antes
  do jogo de ida); um confronto só aparece pra palpitar quando os dois times já estão
  resolvidos E o cutoff dele ainda não passou. Participante edita a própria entrada
  (auto-atendimento, ver abaixo) para preencher os confrontos liberados conforme cada fase
  termina.
- **Símbolo do time**: badge circular colorido com abreviação de 3 letras (`teamBadge()`),
  cor determinística por nome de time (sem depender de API externa/logo real, já que o
  CDB2026 não tem integração ao vivo). Aplicado nos jogos, no formulário de palpites e no
  ranking — não só numa barra de probabilidade (a Copa do Brasil nem tem barra de
  probabilidade; ver também o fix equivalente no Brasileirão nesta mesma sessão).
- **Comprovante (novo — antes o app não tinha nenhum)**: código no formato
  `CDB2026-XXXXXXXX-YYYYMMDD`, mesmo algoritmo FNV-32 (`hashString`) da Copa do Mundo. Exibido
  na tela após salvar e incluído no e-mail de confirmação.
- **Editar minha entrada (auto-atendimento)**: campo "e-mail + código do comprovante" na aba
  Palpites — e-mail sozinho não é considerado segredo suficiente (é visível para o admin e
  seria fácil de adivinhar/coletar), então a edição exige os dois.
- **Botão WhatsApp** no topbar, reaproveitando o mesmo grupo/QR/ícone da Copa do Mundo
  (`assets/whatsapp.svg`, `assets/whatsapp-group-qr.png`) — resolve a divergência `MISSING`
  catalogada em `docs/bolao/CONSISTENCY_MATRIX.md` item 34.
- **QR code Zelle** no card de pagamento (`assets/zelle-qr.png`, reaproveitado da Copa) —
  resolve item 36 da matriz.
- **Admin**: export JSON de backup (`💾 JSON`) e botão "Limpar tudo" (`🗑️`) — resolvem itens 16
  e 7 da matriz. Resultado de cada confronto agora é lançado individualmente pelo admin
  (placar agregado + quem avança), não mais como um único "resultado final" travado de uma vez.
- **CSV**: agora usa `\r\n` (CRLF) em vez de `\n` — resolve item 14 da matriz (regressão do bug
  já corrigido na Copa em v3.0); inclui uma coluna por confronto.

### Ainda não implementado (dívida técnica registrada)

- Sem `audit_scoring.py` equivalente para o CDB2026 (item 1 da matriz) — o novo modelo de
  scoring por confronto + bônus de pódio ainda não tem uma suíte de auto-teste dedicada.
- Sem `AbortController`/timeout nas chamadas Supabase (item 50 da matriz).
- Sem badge de status "ao vivo"/"finalizado" nos jogos (item 44 da matriz) — o CDB2026 não tem
  API externa, então o status vem só de o resultado ter sido lançado ou não pelo admin.

## v1.6 — 2026-07-12

### Novo — seção Jogos (Oitavas de Final) + times reais populados

- **Jogos**: nova aba no nav com os 8 confrontos das Oitavas de Final (ida e volta)
  - Exibe stadium, data e horário em BRT para cada jogo
  - Dados estáticos em `js/data.js` (não depende de API externa)
- **Times**: `js/data.js` atualizado com os 16 times reais das Oitavas:
  Athletico-PR, Atlético-MG, Chapecoense, Corinthians, Cruzeiro, Fluminense,
  Fortaleza, Grêmio, Internacional, Juventude, Mirassol, Palmeiras, Remo, Santos, Vasco, Vitória
- **CSS nav**: `repeat(6, 1fr)` → `repeat(7, 1fr)` para acomodar novo botão
- `audit_scoring.py`: 5/5.

---

## v1.5 — 2026-07-12

### Novo — botões de idioma no topbar (padronização com Copa)

- Adicionado `lang-links` ao topbar: PT-BR ativo, ES-MX e EN-US desabilitados
- CSS `.lang-links button` adicionado (pill style, igual Copa e BR2026)
- Desktop: grid `1fr auto auto` → brand | lang | switcher
- Mobile: brand | switcher (row 1) → lang (row 2) → nav (row 3)
- `audit_scoring.py`: 5/5.

---

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
