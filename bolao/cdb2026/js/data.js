// Copa do Brasil 2026 — modelo de fases dinâmicas, ver docs/bolao/CDB2026_RULES_AND_MODEL.md
// (fonte oficial do modelo, aprovada por Eduardo em 2026-07-13).
//
// Diferença fundamental em relação ao bracket fixo da Copa do Mundo (bolao/js/data.js): aqui
// só a ESTRUTURA da fase (nome, formato, ordem) é conhecida em tempo de deploy — o regulamento
// da CBF define isso, não muda durante o torneio. QUAIS TIMES se enfrentam em cada fase só é
// conhecido depois de cada sorteio real, então confrontos/partidas NÃO ficam aqui: eles vivem
// no estado dinâmico (s.competition.phases[id].ties — ver app.js), cadastrados pelo admin
// conforme cada sorteio acontece. Isso evita "inventar" confrontos futuros no código-fonte.
window.CDB2026_DATA = {
  // 9 fases da Copa do Brasil 2026 — 1ª a 4ª e a Final em partida única, 5ª a 8ª (incluindo a
  // Semifinal) em ida e volta. Nomes descritivos das últimas fases (Oitavas/Quartas/Semifinal)
  // são só rótulo de exibição — o formato/ordem é o que importa para a lógica.
  phases: [
    { id: "fase-1",     name: "1ª Fase",             format: "SINGLE_MATCH", order: 1 },
    { id: "fase-2",     name: "2ª Fase",              format: "SINGLE_MATCH", order: 2 },
    { id: "fase-3",     name: "3ª Fase",              format: "SINGLE_MATCH", order: 3 },
    { id: "fase-4",     name: "4ª Fase",              format: "SINGLE_MATCH", order: 4 },
    { id: "fase-5",     name: "5ª Fase",              format: "TWO_LEG",      order: 5 },
    { id: "oitavas",    name: "Oitavas de Final",     format: "TWO_LEG",      order: 6 },
    { id: "quartas",    name: "Quartas de Final",     format: "TWO_LEG",      order: 7 },
    { id: "semifinal",  name: "Semifinal",            format: "TWO_LEG",      order: 8 },
    { id: "final",      name: "Final",                format: "SINGLE_MATCH", order: 9 },
  ],

  // Escudo real (ESPN CDN) por time — cobre os clubes de Série A/B mais prováveis de aparecer
  // nas fases finais (mesmo conjunto já usado antes desta reformulação). Times de divisões mais
  // baixas que o admin cadastrar sem entrada aqui simplesmente não mostram escudo (fallback
  // gracioso em teamLogoImg() — ver app.js) — não é erro, é esperado num torneio de 126 clubes.
  teamLogos: {
    "Athletico-PR": "https://a.espncdn.com/i/teamlogos/soccer/500/3458.png",
    "Atlético-MG": "https://a.espncdn.com/i/teamlogos/soccer/500/7632.png",
    "Chapecoense": "https://a.espncdn.com/i/teamlogos/soccer/500/9318.png",
    "Corinthians": "https://a.espncdn.com/i/teamlogos/soccer/500/874.png",
    "Cruzeiro": "https://a.espncdn.com/i/teamlogos/soccer/500/2022.png",
    "Fluminense": "https://a.espncdn.com/i/teamlogos/soccer/500/3445.png",
    "Fortaleza": "https://a.espncdn.com/i/teamlogos/soccer/500/6272.png",
    "Grêmio": "https://a.espncdn.com/i/teamlogos/soccer/500/6273.png",
    "Internacional": "https://a.espncdn.com/i/teamlogos/soccer/500/1936.png",
    "Juventude": "https://a.espncdn.com/i/teamlogos/soccer/500/6270.png",
    "Mirassol": "https://a.espncdn.com/i/teamlogos/soccer/500/9169.png",
    "Palmeiras": "https://a.espncdn.com/i/teamlogos/soccer/500/2029.png",
    "Remo": "https://a.espncdn.com/i/teamlogos/soccer/500/4936.png",
    "Santos": "https://a.espncdn.com/i/teamlogos/soccer/500/2674.png",
    "Vasco": "https://a.espncdn.com/i/teamlogos/soccer/500/3454.png",
    "Vitória": "https://a.espncdn.com/i/teamlogos/soccer/500/3457.png",
  },

  // Força aproximada (escala 0-100) só para a aba "Probabilidades" (estimativa, não fonte
  // oficial — ver disclaimer na própria aba). Time cadastrado pelo admin que não estiver aqui
  // usa um valor neutro padrão (ver DEFAULT_STRENGTH em app.js) em vez de quebrar a estimativa.
  strength: {
    "Palmeiras": 85, "Atlético-MG": 78, "Corinthians": 76, "Internacional": 76,
    "Grêmio": 75, "Cruzeiro": 75, "Fluminense": 73, "Fortaleza": 70,
    "Santos": 68, "Athletico-PR": 66, "Vasco": 66, "Vitória": 62,
    "Mirassol": 62, "Juventude": 60, "Chapecoense": 55, "Remo": 55,
  },
};
