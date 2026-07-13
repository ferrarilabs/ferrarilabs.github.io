// Bracket da Copa do Brasil 2026 — mata-mata ida e volta (Oitavas → Quartas → Semifinal → Final)
// Times futuros (Quartas/Semifinal/Final) ainda não têm confronto real definido: "home"/"away"
// ficam null até o admin lançar o resultado do confronto anterior (fromHome/fromAway) — mesmo
// padrão de resolução dinâmica de bracket usado em bolao/js/data.js (Copa do Mundo).
// Datas/horários e emparelhamento de Quartas em diante são placeholders — atualizar em data.js
// conforme a CBF define o chaveamento real de cada fase (mesma manutenção manual de bolao/js/data.js).
window.CDB2026_DATA = {
  teams: [
    "Athletico-PR",
    "Atlético-MG",
    "Chapecoense",
    "Corinthians",
    "Cruzeiro",
    "Fluminense",
    "Fortaleza",
    "Grêmio",
    "Internacional",
    "Juventude",
    "Mirassol",
    "Palmeiras",
    "Remo",
    "Santos",
    "Vasco",
    "Vitória",
  ],

  // Escudo real de cada time (ESPN CDN) — mesmas URLs que bolao/br2026/js/app.js busca ao vivo
  // do endpoint de standings da Série A (site.api.espn.com/.../soccer/bra.1/teams), fixas aqui
  // porque o CDB2026 não tem nenhuma chamada de API ao vivo própria. Símbolo do time consistente
  // com o BR2026 (mesmo escudo, mesmas classes CSS .team-logo/.match-logo) — ver CLAUDE.md
  // "Toda vez que um componente visual for alterado".
  // IDs verificados diretamente no endpoint ESPN (bra.1 para Série A, bra.2 para Fortaleza e
  // Juventude, que estão na Série B nesta temporada) — não assumir que todos os 16 estão na
  // mesma divisão sem checar.
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

  // Força aproximada de cada time (escala 0-100, mesmo espírito do campo `strength` em
  // bolao/js/data.js) — usada só pela aba "Probabilidades" para estimar quem avança em cada
  // confronto. NÃO alimenta scoring/resultado real (audit_scoring.py não depende disto).
  // ATENÇÃO: valores abaixo são uma estimativa inicial de força relativa entre os 16 clubes,
  // não uma fonte oficial (não há rating público único para clubes brasileiros equivalente ao
  // ranking FIFA usado na Copa) — Eduardo deve revisar/ajustar antes de publicar o app.
  strength: {
    "Palmeiras": 85, "Atlético-MG": 78, "Corinthians": 76, "Internacional": 76,
    "Grêmio": 75, "Cruzeiro": 75, "Fluminense": 73, "Fortaleza": 70,
    "Santos": 68, "Athletico-PR": 66, "Vasco": 66, "Vitória": 62,
    "Mirassol": 62, "Juventude": 60, "Chapecoense": 55, "Remo": 55,
  },

  // Confrontos do mata-mata. Cada "tie" (confronto) pontua pelo placar agregado (ida + volta).
  // round: "oitavas" | "quartas" | "semifinal" | "final"
  // home/away: null enquanto o confronto anterior (fromHome/fromAway) não tiver resultado.
  // cutoffIso: null enquanto a data do jogo de ida não for confirmada — confronto fica
  // bloqueado para palpites até o admin preencher.
  ties: [
    {
      id: "oitavas-1", round: "oitavas", order: 1,
      home: "Vasco", away: "Fluminense", fromHome: null, fromAway: null,
      stadium: "Maracanã", date: "2026-08-01", time: "17:30",
      leg2: { home: "Fluminense", away: "Vasco", stadium: "Maracanã", date: "2026-08-05", time: "21:30" },
      cutoffIso: "2026-08-01T16:30:00-03:00",
    },
    {
      id: "oitavas-2", round: "oitavas", order: 2,
      home: "Internacional", away: "Corinthians", fromHome: null, fromAway: null,
      stadium: "Beira-Rio", date: "2026-08-02", time: "19:30",
      leg2: { home: "Corinthians", away: "Internacional", stadium: "Neo Química Arena", date: "2026-08-06", time: "20:00" },
      cutoffIso: "2026-08-02T18:30:00-03:00",
    },
    {
      id: "oitavas-3", round: "oitavas", order: 3,
      home: "Mirassol", away: "Grêmio", fromHome: null, fromAway: null,
      stadium: "Maião", date: "2026-08-02", time: "18:00",
      leg2: { home: "Grêmio", away: "Mirassol", stadium: "Arena do Grêmio", date: "2026-08-05", time: "19:30" },
      cutoffIso: "2026-08-02T17:00:00-03:00",
    },
    {
      id: "oitavas-4", round: "oitavas", order: 4,
      home: "Athletico-PR", away: "Vitória", fromHome: null, fromAway: null,
      stadium: "Arena da Baixada", date: "2026-08-03", time: "21:00",
      leg2: { home: "Vitória", away: "Athletico-PR", stadium: "Barradão", date: "2026-08-06", time: "20:00" },
      cutoffIso: "2026-08-03T20:00:00-03:00",
    },
    {
      id: "oitavas-5", round: "oitavas", order: 5,
      home: "Atlético-MG", away: "Juventude", fromHome: null, fromAway: null,
      stadium: "Arena MRV", date: "2026-08-01", time: "19:30",
      leg2: { home: "Juventude", away: "Atlético-MG", stadium: "Alfredo Jaconi", date: "2026-08-04", time: "19:30" },
      cutoffIso: "2026-08-01T18:30:00-03:00",
    },
    {
      id: "oitavas-6", round: "oitavas", order: 6,
      home: "Santos", away: "Remo", fromHome: null, fromAway: null,
      stadium: "Vila Belmiro", date: "2026-08-01", time: "21:00",
      leg2: { home: "Remo", away: "Santos", stadium: "Mangueirão", date: "2026-08-04", time: "21:30" },
      cutoffIso: "2026-08-01T20:00:00-03:00",
    },
    {
      id: "oitavas-7", round: "oitavas", order: 7,
      home: "Chapecoense", away: "Cruzeiro", fromHome: null, fromAway: null,
      stadium: "Arena Condá", date: "2026-08-02", time: "18:30",
      leg2: { home: "Cruzeiro", away: "Chapecoense", stadium: "Mineirão", date: "2026-08-05", time: "19:00" },
      cutoffIso: "2026-08-02T17:30:00-03:00",
    },
    {
      id: "oitavas-8", round: "oitavas", order: 8,
      home: "Palmeiras", away: "Fortaleza", fromHome: null, fromAway: null,
      stadium: "Nubank Parque", date: "2026-08-02", time: "16:00",
      leg2: { home: "Fortaleza", away: "Palmeiras", stadium: "Arena Pantanal", date: "2026-08-05", time: "21:30" },
      cutoffIso: "2026-08-02T15:00:00-03:00",
    },

    // Quartas de final — times resolvem quando oitavas-N/oitavas-N+1 tiverem resultado.
    // Emparelhamento e datas são placeholder até a CBF confirmar o chaveamento real.
    { id: "quartas-1", round: "quartas", order: 1, home: null, away: null, fromHome: "oitavas-1", fromAway: "oitavas-2", stadium: null, date: null, time: null, leg2: null, cutoffIso: null },
    { id: "quartas-2", round: "quartas", order: 2, home: null, away: null, fromHome: "oitavas-3", fromAway: "oitavas-4", stadium: null, date: null, time: null, leg2: null, cutoffIso: null },
    { id: "quartas-3", round: "quartas", order: 3, home: null, away: null, fromHome: "oitavas-5", fromAway: "oitavas-6", stadium: null, date: null, time: null, leg2: null, cutoffIso: null },
    { id: "quartas-4", round: "quartas", order: 4, home: null, away: null, fromHome: "oitavas-7", fromAway: "oitavas-8", stadium: null, date: null, time: null, leg2: null, cutoffIso: null },

    // Semifinal — times resolvem quando as quartas correspondentes tiverem resultado.
    { id: "semifinal-1", round: "semifinal", order: 1, home: null, away: null, fromHome: "quartas-1", fromAway: "quartas-2", stadium: null, date: null, time: null, leg2: null, cutoffIso: null },
    { id: "semifinal-2", round: "semifinal", order: 2, home: null, away: null, fromHome: "quartas-3", fromAway: "quartas-4", stadium: null, date: null, time: null, leg2: null, cutoffIso: null },

    // Final — times resolvem quando as duas semifinais tiverem resultado.
    { id: "final-1", round: "final", order: 1, home: null, away: null, fromHome: "semifinal-1", fromAway: "semifinal-2", stadium: null, date: null, time: null, leg2: null, cutoffIso: null },
  ],
};
