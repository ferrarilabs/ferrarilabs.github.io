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
      { name: "Eduardo Ferrari", cotas: 1, valor: 20, metodo: "Fundo próprio (organizador)", data: "31/07/2026", hora: "3:59:00 PM", status: "organizador", state: "NC" },
      { name: "Gustavo Bossle", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "4:52:51 PM", status: "verificado", state: "NC" },
      { name: "Tatiana Bossle", cotas: 1, valor: 20, metodo: "Zelle (depósito de Gustavo Bossle)", data: "01/08/2026", hora: "11:57:41 AM", status: "verificado", state: "NC" },
      { name: "Marcelo Moreira", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "4:39:47 PM", status: "verificado", state: "NC" },
      { name: "Leandro Augustineli", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "4:43:30 PM", status: "verificado", state: "NC" },
      { name: "Alan Rech", cotas: 1, valor: 20, metodo: "Cash App", data: "31/07/2026", hora: "4:45:18 PM", status: "verificado", state: "FL" },
      { name: "Ewerton Gruba Silva", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "4:48:11 PM", status: "verificado", state: "NC" },
      { name: "Simone Hirle da Costa", cotas: 1, valor: 20, metodo: "Venmo", data: "31/07/2026", hora: "4:54:29 PM", status: "verificado", state: "NC" },
      { name: "Camila Ribeiro", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "9:12:05 PM", status: "verificado", state: "NC" },
      { name: "Marcus Steffenon", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "11:41:45 PM", status: "verificado", state: "NC" },
      { name: "Samuel Huller", cotas: 1, valor: 20, metodo: "Zelle", data: "01/08/2026", hora: "7:12:54 AM", status: "verificado", state: "NC" },
      { name: "Amanda Quaresma", cotas: 1, valor: 20, metodo: "Venmo", data: "01/08/2026", hora: "9:02:20 AM", status: "verificado", state: "NC" },
      { name: "Rodrigo Hajj", cotas: 1, valor: 20, metodo: "Zelle", data: "01/08/2026", hora: "12:29:15 PM", status: "verificado", state: "NC" },
      { name: "Nathalia Galeazzi Nedel", cotas: 1, valor: 20, metodo: "Zelle", data: "01/08/2026", hora: "12:36:16 PM", status: "verificado", state: "NC" }
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
    // Os US$16 ganhos foram usados no sorteio seguinte (05/08) para cobrir parte da
    // compra de tickets — ver comentário em finance do draw 2026-08-05.
    profit: {
      premiosGanhos: 16,
      lucro: -122
    }
  },
  {
    id: "2026-08-05",
    gameType: "powerball",
    drawing: {
      name: "Powerball Jackpot",
      jackpot: 786000000,
      // Valor de lump sum ("Cash Value") divulgado oficialmente pela NC Lottery
      // (nclottery.com/Home, verificado 05/08/2026) — mais preciso que a estimativa
      // genérica de 50,5% do jackpot, que a loteria não usa de forma fixa (varia com
      // taxas de juros dos títulos do Tesouro no momento do sorteio).
      cashValue: 341600000,
      drawDateIso: "2026-08-05T22:59:00-04:00",
      drawDateLabel: "05/08/2026 22:59 ET"
    },

    // 15 participantes com cotas de US$10 cada (sorteio secundário)
    participants: [
      { name: "Eduardo Ferrari", cotas: 1, valor: 8, metodo: "Saldo anterior (cobriu -$2 do sorteio 08-03)", data: "04/08/2026", hora: "—", status: "organizador", state: "NC" },
      { name: "Marcus Steffenon", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "8:33 AM", status: "verificado", state: "NC" },
      { name: "Jorge Augusto Junqueira Ferreira", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "8:35 AM", status: "verificado", state: "FL" },
      { name: "Gustavo Bossle", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "8:37 AM", status: "verificado", state: "NC" },
      { name: "Simone Hirle da Costa", cotas: 1, valor: 10, metodo: "Venmo", data: "04/08/2026", hora: "8:38 AM", status: "verificado", state: "NC" },
      { name: "Marcelo Moreira", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "8:40 AM", status: "verificado", state: "NC" },
      { name: "Camila Ribeiro", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "8:40 AM", status: "verificado", state: "NC" },
      { name: "Ewerton Gruba Silva", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "8:45 AM", status: "verificado", state: "NC" },
      { name: "Amanda Quaresma", cotas: 1, valor: 10, metodo: "Venmo", data: "04/08/2026", hora: "8:57 AM", status: "verificado", state: "NC" },
      { name: "Nathalia Galeazzi Nedel", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "9:09 AM", status: "verificado", state: "NC" },
      { name: "Leandro Augustineli", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "9:20 AM", status: "verificado", state: "NC" },
      { name: "Marcelo Minghetti Pereira", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "10:51 AM", status: "verificado", state: "NC" },
      { name: "Alan Rech", cotas: 1, valor: 10, metodo: "Cash App", data: "04/08/2026", hora: "1:15 PM", status: "verificado", state: "FL" },
      { name: "Samuel Huller", cotas: 1, valor: 10, metodo: "Zelle", data: "04/08/2026", hora: "10:47 PM", status: "verificado", state: "NC" },
      { name: "Rodrigo Hajj", cotas: 1, valor: 10, metodo: "Zelle", data: "05/08/2026", hora: "11:19 AM", status: "verificado", state: "NC" }
    ],

    sharedTickets: {
      compradoPor: "Eduardo Ferrari (organizador)",
      dataComprovante: "05/08/2026 22:59 ET",
      valorPorTicket: 3, // Power Play
      series: [
        {
          serial: "25FCD6C065ACBBF0D", qtd: 1, jogos: "1",
          numeros: ["24-31-47-52-68 — PB 17"]
        },
        {
          serial: "2D6F455C923756663", qtd: 5, jogos: "1–5",
          numeros: [
            "35-48-49-52-56 — PB 21", "01-26-58-60-61 — PB 23", "02-23-30-43-64 — PB 22",
            "07-16-33-50-55 — PB 19", "18-21-25-42-67 — PB 11"
          ]
        },
        {
          serial: "25AE2E9403C675208", qtd: 5, jogos: "1–5",
          numeros: [
            "20-25-34-51-60 — PB 04", "20-28-31-33-58 — PB 15", "21-30-38-46-47 — PB 03",
            "22-27-29-40-62 — PB 06", "24-36-43-53-59 — PB 10"
          ]
        },
        {
          serial: "2529427987A488194", qtd: 20, jogos: "1–20",
          numeros: [
            "07-12-39-48-63 — PB 07", "07-15-18-46-49 — PB 13", "08-09-33-46-62 — PB 16",
            "08-10-23-32-55 — PB 16", "08-11-21-34-56 — PB 02", "09-12-22-45-60 — PB 22",
            "09-27-48-54-57 — PB 07", "10-16-29-42-61 — PB 12", "11-16-41-51-58 — PB 09",
            "11-26-53-63-64 — PB 14", "12-14-31-38-61 — PB 11", "13-22-41-65-68 — PB 13",
            "14-15-52-54-59 — PB 01", "15-24-33-35-66 — PB 18", "15-29-32-37-50 — PB 12",
            "16-40-45-64-67 — PB 25", "17-20-38-59-67 — PB 18", "18-23-41-53-56 — PB 26",
            "19-32-36-40-69 — PB 03", "19-42-50-51-63 — PB 01"
          ]
        },
        {
          serial: "2CD0E132C5697EA89", qtd: 20, jogos: "1–20",
          numeros: [
            "01-18-28-55-57 — PB 24", "01-25-44-64-66 — PB 24", "01-32-39-52-65 — PB 20",
            "02-07-25-61-62 — PB 14", "02-27-37-66-69 — PB 25", "02-31-36-46-57 — PB 05",
            "03-10-35-40-53 — PB 21", "03-17-30-51-68 — PB 10", "03-21-28-50-60 — PB 19",
            "04-06-26-39-57 — PB 17", "04-12-13-43-49 — PB 08", "04-19-30-65-67 — PB 08",
            "04-24-44-45-69 — PB 05", "05-08-47-58-63 — PB 23", "05-13-34-55-66 — PB 02",
            "05-17-26-54-69 — PB 15", "05-36-39-42-68 — PB 06", "06-09-23-44-65 — PB 20",
            "06-10-45-47-54 — PB 09", "06-14-22-37-43 — PB 04"
          ]
        },
        {
          serial: "22CC7A56751B4416E", qtd: 3, jogos: "1–3",
          numeros: [
            "03-14-27-34-41 — PB 26", "11-13-29-38-44 — PB 04", "17-28-37-48-62 — PB 07"
          ]
        }
      ]
    },

    // 54 tickets x US$3 (Power Play) = US$162 (51 originais + 3 do serial
    // 22CC7A56751B4416E). Arrecadado US$148 + crédito de US$16 do sorteio anterior
    // (2026-08-03) = US$164 disponível; sobra US$2 (164 - 162) guardado p/ próximo sorteio.
    finance: {
      totalArrecadado: 148,
      creditoSorteioAnterior: 16, // prêmio ganho em 2026-08-03, usado para cobrir o déficit de tickets
      valorUtilizado: 162,
      valorGuardadoProximoSorteio: 2 // 148 + 16 - 162
    },

    // Preenchido manualmente após o sorteio de 05/08/2026 (site oficial powerball.com;
    // fonte NY Open Data ainda não havia publicado no momento). Conferidos os 54 tickets
    // contra o resultado: 2 acertos de "Powerball" (sem números principais), $8 cada
    // (Power Play 2x) = $16. Sem jackpot.
    result: {
      numbers: [14, 20, 59, 60, 61],
      special: 25,
      multiplier: 2,
      checkedAt: "05/08/2026 23:13 ET",
      premiosGanhos: 16,
      jackpotHit: false,
      breakdown: ["Powerball ($8)", "Powerball ($8)"]
    },
    profit: {
      premiosGanhos: 16,
      lucro: -146 // 16 - 162 (valorUtilizado)
    }
  },

  // Próximo sorteio oficial após 05/08/2026 (quarta-feira): Powerball sorteia
  // segunda/quarta/sábado às 22:59 ET — o próximo dia da semana nessa lista
  // após uma quarta é sábado, 08/08/2026. Data e valores (jackpot $856M,
  // cash value $372.0M) confirmados diretamente em powerball.com em
  // 06/08/2026. Em planejamento: nenhum participante/ticket ainda —
  // participants não são uma estrutura permanente do pool (cada sorteio
  // anterior já teve uma lista diferente de participantes), então não são
  // copiados do sorteio anterior.
  {
    id: "2026-08-08",
    gameType: "powerball",
    status: "planejamento",
    createdAt: "2026-08-06T13:00:00-04:00",
    previousDrawId: "2026-08-05",
    drawing: {
      name: "Powerball Jackpot",
      jackpot: 856000000,
      cashValue: 372000000,
      drawDateIso: "2026-08-08T22:59:00-04:00",
      drawDateLabel: "08/08/2026 22:59 ET"
    },

    participants: [
      { name: "Samuel Huller", cotas: 1, valor: 10, metodo: "Zelle", data: "06/08/2026", hora: "—", status: "verificado", state: "NC" }
    ],

    // Nenhum ticket comprado ainda.
    sharedTickets: {
      compradoPor: null,
      dataComprovante: null,
      valorPorTicket: 3,
      series: []
    },

    // carryForward = saldo remanescente do sorteio anterior (valorGuardadoProximoSorteio,
    // $2) + prêmios CONFIRMADOS do sorteio anterior (premiosGanhos oficial, $16) -
    // qualquer valor já distribuído/utilizado deste saldo ($0, nada foi gasto ainda) = $18.
    // Nunca conta um prêmio não confirmado — o sorteio 2026-08-05 já tem resultado oficial
    // e premiosGanhos confirmado, então esse valor é seguro de usar aqui.
    finance: {
      totalArrecadado: 10, // Samuel Huller, Zelle, 06/08/2026
      creditoSorteioAnterior: 18, // 2 (saldo) + 16 (prêmios confirmados) - 0 (nada usado ainda)
      valorUtilizado: 0,
      valorGuardadoProximoSorteio: 28 // nada foi gasto ainda: 10 + 18 - 0 = 28
    },

    result: null,
    profit: null
  }
];

// Sorteio ativo/mais recente — é o que a página principal exibe.
window.POWERBALL_DATA = window.POWERBALL_DRAWS[window.POWERBALL_DRAWS.length - 1];
