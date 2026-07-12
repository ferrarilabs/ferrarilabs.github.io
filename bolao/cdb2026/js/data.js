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

  // Abreviação de 3 letras por time — usada no símbolo/badge junto ao nome, nos mesmos
  // pontos onde a Copa usa bandeira e o Brasileirão usa o escudo da ESPN.
  teamAbbrev: {
    "Athletico-PR": "CAP",
    "Atlético-MG": "CAM",
    "Chapecoense": "CHA",
    "Corinthians": "COR",
    "Cruzeiro": "CRU",
    "Fluminense": "FLU",
    "Fortaleza": "FOR",
    "Grêmio": "GRE",
    "Internacional": "INT",
    "Juventude": "JUV",
    "Mirassol": "MIR",
    "Palmeiras": "PAL",
    "Remo": "REM",
    "Santos": "SAN",
    "Vasco": "VAS",
    "Vitória": "VIT",
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
