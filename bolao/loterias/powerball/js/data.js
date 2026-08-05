// Cada sorteio do bolão é uma entrada em `draws`. Para registrar um novo sorteio,
// duplique um objeto abaixo, atualize os dados e preencha `result`/`profit` depois
// que o sorteio sair — isso dá histórico automático (lucro, resultados anteriores etc.)
// sem precisar reestruturar nada. `window.POWERBALL_DATA` sempre aponta para o mais
// recente (o sorteio ativo/exibido na página principal).
// Configuração visual/textual de cada loteria. Jogamos em ambas dependendo da situação —
// cada sorteio (`draws[i]`) declara `gameType: "powerball" | "megamillions"` e a página
// troca cor, logo e o nome da bola especial automaticamente.
window.LOTTERY_GAME_TYPES = {
  powerball: {
    label: "Powerball",
    icon: "🔴",
    specialBallLabel: "Powerball",
    accent: "#CE1141",
    accent2: "#003DA5",
    previousResultsUrl: "https://www.powerball.com/previous-results",
    // NY Open Data (Socrata, CORS liberado) — fonte oficial dos sorteios.
    resultsApi: "https://data.ny.gov/resource/d6yy-54nr.json",
    // winning_numbers vem como "n1 n2 n3 n4 n5 PB" (a Powerball é o último número).
    parseResult: function (row) {
      var parts = row.winning_numbers.trim().split(/\s+/).map(Number);
      return { numbers: parts.slice(0, 5), special: parts[5], multiplier: Number(row.multiplier) || 1 };
    },
    // Tabela oficial de prêmios (Power Play sempre SIM nos nossos tickets).
    // Multiplicador não se aplica ao jackpot; no acerto de 5 sem PB o prêmio via
    // Power Play é sempre fixo em $2M, não escala com o multiplicador sorteado.
    prizeTable: function (mainMatches, specialMatch, multiplier) {
      if (mainMatches === 5 && specialMatch) return { label: "JACKPOT", amount: null };
      if (mainMatches === 5) return { label: "5 acertos", amount: 2000000 };
      if (mainMatches === 4 && specialMatch) return { label: "4 + Powerball", amount: 50000 * multiplier };
      if (mainMatches === 4) return { label: "4 acertos", amount: 100 * multiplier };
      if (mainMatches === 3 && specialMatch) return { label: "3 + Powerball", amount: 100 * multiplier };
      if (mainMatches === 3) return { label: "3 acertos", amount: 7 * multiplier };
      if (mainMatches === 2 && specialMatch) return { label: "2 + Powerball", amount: 7 * multiplier };
      if (mainMatches === 1 && specialMatch) return { label: "1 + Powerball", amount: 4 * multiplier };
      if (mainMatches === 0 && specialMatch) return { label: "Powerball", amount: 4 * multiplier };
      return null;
    }
  },
  megamillions: {
    label: "Mega Millions",
    icon: "🟡",
    specialBallLabel: "Mega Ball",
    accent: "#1c75bc",
    accent2: "#ffc72c",
    previousResultsUrl: "https://www.megamillions.com/Winning-Numbers.aspx",
    resultsApi: "https://data.ny.gov/resource/5xaw-6ayf.json",
    parseResult: function (row) {
      var parts = row.winning_numbers.trim().split(/\s+/).map(Number);
      return { numbers: parts.slice(0, 5), special: Number(row.mega_ball), multiplier: Number(row.multiplier) || 1 };
    },
    // Tabela oficial simplificada (Megaplier); confirmar valor exato no site oficial
    // quando o prêmio for relevante — multiplicadores/tiers mudam de tempos em tempos.
    prizeTable: function (mainMatches, specialMatch, multiplier) {
      if (mainMatches === 5 && specialMatch) return { label: "JACKPOT", amount: null };
      if (mainMatches === 5) return { label: "5 acertos", amount: 1000000 };
      if (mainMatches === 4 && specialMatch) return { label: "4 + Mega Ball", amount: 10000 * multiplier };
      if (mainMatches === 4) return { label: "4 acertos", amount: 500 * multiplier };
      if (mainMatches === 3 && specialMatch) return { label: "3 + Mega Ball", amount: 200 * multiplier };
      if (mainMatches === 3) return { label: "3 acertos", amount: 10 * multiplier };
      if (mainMatches === 2 && specialMatch) return { label: "2 + Mega Ball", amount: 10 * multiplier };
      if (mainMatches === 1 && specialMatch) return { label: "1 + Mega Ball", amount: 4 * multiplier };
      if (mainMatches === 0 && specialMatch) return { label: "Mega Ball", amount: 2 * multiplier };
      return null;
    }
  }
};

window.POWERBALL_DRAWS = [
  {
    id: "2026-08-03",
    gameType: "powerball",
    drawing: {
      name: "Powerball Jackpot",
      jackpot: 707000000,
      drawDateIso: "2026-08-01T22:59:00-04:00",
      drawDateLabel: "01/08/2026 22:59 ET"
    },

    // 14 participantes, 1 cota = US$20 cada. Eduardo é o organizador: fundo já
    // disponível na conta dele, sem depósito necessário (não há recibo de transferência).
    // Os tickets são comprados de uma vez só com o fundo do bolão e são coletivos —
    // todos os participantes concorrem aos mesmos números (ver `sharedTickets` abaixo).
    participants: [
      { name: "Eduardo Ferrari", cotas: 1, valor: 20, metodo: "Fundo próprio (organizador)", data: "31/07/2026", hora: "3:59:00 PM", txId: "—", status: "organizador", state: "FL", email: "emferrari@gmail.com" },
      { name: "Gustavo Bossle", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "4:52:51 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Tatiana Bossle", cotas: 1, valor: 20, metodo: "Zelle (depósito de Gustavo Bossle)", data: "01/08/2026", hora: "11:57:41 AM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado", state: "NC", email: "tatiana.bossle@example.com" },
      { name: "Marcelo Moreira", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "4:39:47 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Leandro Augustineli", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "4:43:30 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Alan Rech", cotas: 1, valor: 20, metodo: "Cash App", data: "31/07/2026", hora: "4:45:18 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado", state: "FL", email: "REDACTED_EMAIL" },
      { name: "Ewerton Gruba Silva", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "4:48:11 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Simone Hirle da Costa", cotas: 1, valor: 20, metodo: "Venmo", data: "31/07/2026", hora: "4:54:29 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Camila Ribeiro", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "9:12:05 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Marcus Steffenon", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "11:41:45 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Samuel Huller", cotas: 1, valor: 20, metodo: "Zelle", data: "01/08/2026", hora: "7:12:54 AM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Amanda Quaresma", cotas: 1, valor: 20, metodo: "Venmo", data: "01/08/2026", hora: "9:02:20 AM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Rodrigo Hajj", cotas: 1, valor: 20, metodo: "Zelle", data: "01/08/2026", hora: "12:29:15 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Nathalia Galeazzi Nedel", cotas: 1, valor: 20, metodo: "Zelle", data: "01/08/2026", hora: "12:36:16 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado", state: "NC", email: "REDACTED_EMAIL" }
    ],

    // Tickets comprados com o fundo do bolão (compra única por serial, valem para todos
    // os participantes). Números no formato "bolas — Powerball", todos Power Play SIM.
    sharedTickets: {
      compradoPor: "Eduardo Ferrari (organizador)",
      dataComprovante: "01/08/2026 10:59 PM ET",
      valorPorTicket: 3, // Power Play
      series: [
        {
          serial: "274CD4C12C6766A4C", qtd: 20, jogos: "01–20",
          numeros: [
            "01-14-27-63-64 — PB 25", "01-18-37-40-48 — PB 08", "01-22-47-53-66 — PB 17",
            "02-06-17-43-60 — PB 20", "02-10-55-57-58 — PB 12", "02-13-24-34-39 — PB 26",
            "02-23-25-61-66 — PB 25", "03-04-38-65-68 — PB 26", "03-24-29-57-66 — PB 04",
            "04-08-48-51-55 — PB 16", "04-09-11-43-56 — PB 01", "04-26-47-61-62 — PB 17",
            "05-08-12-35-45 — PB 08", "05-14-30-41-46 — PB 18", "06-12-41-50-69 — PB 11",
            "06-15-26-34-37 — PB 05", "06-20-35-49-58 — PB 03", "07-12-22-51-52 — PB 07",
            "07-20-30-36-39 — PB 24", "07-31-42-63-68 — PB 09"
          ]
        },
        {
          serial: "2B30C09BAC09CBD11", qtd: 10, jogos: "21–30",
          numeros: [
            "08-38-47-59-69 — PB 12", "08-43-49-52-57 — PB 07", "09-13-33-36-58 — PB 13",
            "09-19-34-40-45 — PB 22", "10-15-30-50-59 — PB 23", "10-16-21-51-63 — PB 02",
            "10-33-40-42-67 — PB 02", "11-21-29-38-46 — PB 23", "14-19-51-54-57 — PB 19",
            "14-25-31-38-49 — PB 15"
          ]
        },
        {
          serial: "2D8EA8E168063B40F", qtd: 8, jogos: "31–38",
          numeros: [
            "15-28-48-62-65 — PB 11", "16-25-39-55-56 — PB 06", "17-20-31-44-54 — PB 03",
            "17-29-42-50-62 — PB 21", "18-22-23-60-67 — PB 13", "19-35-44-46-56 — PB 10",
            "20-27-32-59-68 — PB 14", "24-28-45-53-54 — PB 05"
          ]
        },
        {
          serial: "2C98E48806903E477", qtd: 8, jogos: "jogados separadamente",
          compradoEm: "31/07/2026 15:59 ET", valorTotal: 24,
          numeros: [
            "21-28-36-61-64 — PB 14", "23-32-33-63-69 — PB 04", "03-18-52-56-59 — PB 01",
            "16-27-44-53-62 — PB 21", "11-23-36-54-64 — PB 09", "13-26-46-49-65 — PB 16",
            "32-41-47-58-67 — PB 24", "05-28-37-60-69 — PB 20"
          ]
        }
      ]
    },

    finance: {
      totalArrecadado: 280,
      valorUtilizado: 138,   // 46 tickets x US$3 (Power Play)
      valorGuardadoProximoSorteio: 142
    },

    // Preenchido manualmente após o sorteio de 01/08/2026.
    result: {
      numbers: [8, 30, 41, 48, 54],
      special: 4,
      multiplier: 2,
      checkedAt: "04/08/2026 07:25 ET",
      premiosGanhos: 16,
      jackpotHit: false,
      breakdown: ["Powerball ($8)", "Powerball ($8)"]
    },

    // Preenchido manualmente após conferir os tickets contra o resultado.
    // profit = prêmios ganhos - valorUtilizado (não conta o valor guardado, que é reciclado).
    profit: {
      premiosGanhos: null,
      lucro: null
    }
  },
  {
    id: "2026-08-05",
    gameType: "powerball",
    drawing: {
      name: "Powerball Jackpot",
      jackpot: 786000000,
      drawDateIso: "2026-08-05T22:59:00-04:00",
      drawDateLabel: "05/08/2026 22:59 ET"
    },

    // 14 participantes com cotas de US$10 cada (sorteio secundário)
    participants: [
      { name: "Eduardo Ferrari", cotas: 1, valor: 8, metodo: "Saldo anterior (cobriu -$2 do sorteio 08-03)", data: "04/08/2026", hora: "—", txId: "—", status: "organizador", state: "FL", email: "emferrari@gmail.com" },
      { name: "Marcus Steffenon", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "8:33 AM", txId: "—", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Jorge Augusto Junqueira Ferreira", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "8:35 AM", txId: "—", status: "verificado", state: "FL", email: "—" },
      { name: "Gustavo Bossle", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "8:37 AM", txId: "—", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Simone Hirle da Costa", cotas: 1, valor: 10, metodo: "Venmo", data: "04/08/2026", hora: "8:38 AM", txId: "—", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Marcelo Moreira", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "8:40 AM", txId: "—", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Camila Ribeiro", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "8:40 AM", txId: "—", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Ewerton Gruba Silva", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "8:45 AM", txId: "—", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Amanda Quaresma", cotas: 1, valor: 10, metodo: "Venmo", data: "04/08/2026", hora: "8:57 AM", txId: "—", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Nathalia Galeazzi Nedel", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "9:09 AM", txId: "—", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Leandro Augustineli", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "9:20 AM", txId: "—", status: "verificado", state: "NC", email: "REDACTED_EMAIL" },
      { name: "Marcelo Minghetti Pereira", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "10:51 AM", txId: "—", status: "verificado", state: "NC", email: "—" },
      { name: "Alan Rech", cotas: 1, valor: 10, metodo: "Cash App", data: "04/08/2026", hora: "1:15 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado", state: "FL", email: "REDACTED_EMAIL" },
      { name: "Samuel Huller", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "10:47 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado", state: "NC", email: "REDACTED_EMAIL" }
    ],

    sharedTickets: {
      compradoPor: "—",
      dataComprovante: "—",
      valorPorTicket: 3,
      series: []
    },

    finance: {
      totalArrecadado: 138,
      valorUtilizado: 0,
      valorGuardadoProximoSorteio: 138
    },

    result: null,
    profit: {
      premiosGanhos: null,
      lucro: null
    }
  }
];

// Sorteio ativo/mais recente — é o que a página principal exibe.
window.POWERBALL_DATA = window.POWERBALL_DRAWS[window.POWERBALL_DRAWS.length - 1];
