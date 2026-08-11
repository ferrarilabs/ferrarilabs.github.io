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
      breakdown: ["Powerball (US$ 8.00)", "Powerball (US$ 8.00)"]
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
      { name: "Eduardo Ferrari", cotas: 1, valor: 8, metodo: "Saldo anterior (cobriu -US$ 2.00 do sorteio 08-03)", data: "04/08/2026", hora: "8:32 AM", status: "organizador", state: "NC" },
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
      breakdown: ["Powerball (US$ 8.00)", "Powerball (US$ 8.00)"]
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
      { name: "Eduardo Ferrari", cotas: 1, valor: 10, metodo: "Fundo próprio (organizador)", data: "06/08/2026", hora: "8:58 AM", status: "organizador", state: "NC" },
      { name: "Samuel Huller", cotas: 1, valor: 10, metodo: "Zelle", data: "06/08/2026", hora: "2:10 PM", status: "verificado", state: "NC" },
      { name: "Jorge Augusto Junqueira Ferreira", cotas: 1, valor: 10, metodo: "Zelle", data: "06/08/2026", hora: "8:59 AM", status: "verificado", state: "FL" },
      // Camila pagou $12 no total; $10 é a cota deste sorteio (valor abaixo),
      // os outros $2 são um ajuste não alocado — ver finance.ajustesPendentes.
      { name: "Camila Ribeiro", cotas: 1, valor: 10, metodo: "Zelle", data: "06/08/2026", hora: "9:09 AM", status: "verificado", state: "NC" },
      { name: "Simone Hirle da Costa", cotas: 1, valor: 10, metodo: "Venmo", data: "06/08/2026", hora: "9:10 AM", status: "verificado", state: "NC" },
      { name: "Gustavo Bossle", cotas: 1, valor: 10, metodo: "Zelle", data: "06/08/2026", hora: "9:16 AM", status: "verificado", state: "NC" },
      { name: "Marcelo Moreira", cotas: 1, valor: 10, metodo: "Zelle", data: "06/08/2026", hora: "9:23 AM", status: "verificado", state: "NC" },
      { name: "Amanda Quaresma", cotas: 1, valor: 10, metodo: "Venmo", data: "06/08/2026", hora: "9:36 AM", status: "verificado", state: "NC" },
      { name: "REDACTED_PARTICIPANT", cotas: 1, valor: 10, metodo: "Zelle", data: "06/08/2026", hora: "9:11 AM", status: "verificado", state: "FL" },
      { name: "Ewerton Gruba Silva", cotas: 1, valor: 10, metodo: "Zelle", data: "06/08/2026", hora: "9:26 AM", status: "verificado", state: "NC" },
      { name: "Marcus Steffenon", cotas: 1, valor: 10, metodo: "Zelle", data: "06/08/2026", hora: "9:30 AM", status: "verificado", state: "NC" },
      { name: "Leandro Augustineli", cotas: 1, valor: 10, metodo: "Zelle", data: "06/08/2026", hora: "10:21 AM", status: "verificado", state: "NC" },
      { name: "Marcelo Minghetti Pereira", cotas: 1, valor: 10, metodo: "Zelle", data: "06/08/2026", hora: "6:49 PM", status: "verificado", state: "NC" },
      { name: "Alan Rech", cotas: 1, valor: 10, metodo: "Cash App", data: "06/08/2026", hora: "9:06 AM", status: "verificado", state: "FL" },
      { name: "Rodrigo Hajj", cotas: 1, valor: 10, metodo: "Zelle", data: "08/08/2026", hora: "12:12 AM", status: "verificado", state: "NC" }
    ],

    sharedTickets: {
      compradoPor: "Eduardo Ferrari (organizador)",
      dataComprovante: "08/08/2026 22:59 ET",
      valorPorTicket: 3, // Power Play
      series: [
        {
          serial: "2F9A732E08768E8FF", qtd: 1, jogos: "1",
          numeros: ["29-32-40-47-59 — PB 20"]
        },
        {
          serial: "2389B6EFC635C761F", qtd: 5, jogos: "1–5",
          numeros: [
            "20-38-39-46-57 — PB 23", "25-26-46-59-65 — PB 22", "26-27-38-45-47 — PB 25",
            "27-30-34-54-57 — PB 03", "28-41-42-49-51 — PB 17"
          ]
        },
        {
          serial: "23E483B8A39B5342C", qtd: 50, jogos: "1–50",
          numeros: [
            "01-10-20-51-64 — PB 12", "01-12-13-43-56 — PB 24", "01-15-39-54-66 — PB 18",
            "01-28-35-38-40 — PB 06", "02-11-47-50-55 — PB 26", "02-16-32-35-51 — PB 14",
            "02-24-31-53-67 — PB 07", "02-27-56-65-68 — PB 10", "03-14-28-43-45 — PB 19",
            "03-23-27-48-49 — PB 11", "03-33-36-62-69 — PB 03", "03-50-52-53-63 — PB 05",
            "04-05-14-39-63 — PB 17", "04-07-24-32-49 — PB 02", "04-23-45-46-58 — PB 10",
            "04-30-31-55-64 — PB 14", "05-07-10-57-68 — PB 20", "05-13-24-64-65 — PB 01",
            "05-17-40-44-58 — PB 04", "06-08-13-37-69 — PB 25", "06-15-22-48-61 — PB 17",
            "06-19-31-49-56 — PB 09", "06-25-55-57-62 — PB 13", "07-11-36-42-54 — PB 25",
            "07-12-29-34-66 — PB 05", "08-10-25-35-39 — PB 24", "08-12-17-50-51 — PB 15",
            "08-15-16-33-60 — PB 18", "09-12-46-55-67 — PB 13", "09-21-48-58-68 — PB 08",
            "09-23-36-38-50 — PB 21", "09-37-53-56-60 — PB 23", "10-22-37-41-43 — PB 22",
            "11-24-48-52-59 — PB 06", "11-26-44-61-62 — PB 07", "13-17-47-52-54 — PB 01",
            "13-20-29-33-44 — PB 21", "14-26-35-36-41 — PB 08", "14-31-44-60-69 — PB 16",
            "15-21-41-52-64 — PB 09", "16-22-30-53-65 — PB 19", "16-34-43-62-63 — PB 15",
            "17-21-30-33-42 — PB 03", "18-19-22-50-69 — PB 04", "18-21-23-34-67 — PB 26",
            "18-29-42-58-61 — PB 08", "18-40-49-60-63 — PB 12", "19-25-28-61-68 — PB 16",
            "19-37-42-59-66 — PB 11", "20-32-45-66-67 — PB 02"
          ]
        }
      ]
    },

    // 56 tickets (1 + 5 + 50) x US$3 (Power Play) = US$168. carryForward = saldo
    // remanescente do sorteio anterior (valorGuardadoProximoSorteio, $2) + prêmios
    // CONFIRMADOS do sorteio anterior (premiosGanhos oficial, $16) = $18. Nunca conta
    // um prêmio não confirmado — o sorteio 2026-08-05 já tem resultado oficial e
    // premiosGanhos confirmado, então esse valor é seguro de usar aqui.
    finance: {
      totalArrecadado: 150, // 15 participantes x $10 (contribuição alocada a este sorteio); Rodrigo Hajj entrou em 08/08/2026
      creditoSorteioAnterior: 18, // 2 (saldo) + 16 (prêmios confirmados) - 0 (nada usado ainda)
      valorUtilizado: 168, // 56 tickets x $3 (Power Play)
      valorGuardadoProximoSorteio: 0, // 150 + 18 - 168 = 0
      // Camila Ribeiro pagou $12; $2 não são cota, prêmio, saldo anterior, crédito
      // automático do próximo sorteio, nem dívida pessoal — ficam explicitamente
      // pendentes de classificação, fora de totalArrecadado/valorGuardadoProximoSorteio.
      ajustesPendentes: 2
    },

    result: {
      numbers: [5, 9, 35, 54, 63],
      special: 7,
      multiplier: 3,
      checkedAt: "09/08/2026 07:45 ET",
      premiosGanhos: 24,
      jackpotHit: false,
      breakdown: ["2x Powerball"]
    },
    profit: null
  },

  // ── Próximo sorteio: segunda-feira, 10/08/2026 ──────────────────────────────────────────
  // Powerball sorteia segunda/quarta/sábado às 22:59 ET; o próximo dia dessa lista após o
  // sábado 08/08 é segunda 10/08. Data, jackpot ($905M) e cash value ($391.9M) confirmados
  // diretamente em powerball.com em 09/08/2026 — a mesma página que confirma o resultado de
  // 08/08 (5 9 35 54 63 | PB 7, Power Play 3x) que já está gravado acima.
  //
  // creditoSorteioAnterior = valorGuardadoProximoSorteio do 08/08 ($0) + prêmios CONFIRMADOS do
  // 08/08 ($24, resultado oficial já gravado) - nada distribuído ($0) = $24. Os $2 de
  // `ajustesPendentes` do 08/08 NÃO entram: continuam fora de totalArrecadado/valorGuardado até
  // serem classificados.
  //
  // O Eduardo entrou neste sorteio em 09/08/2026 08:40 AM (America/New_York), inicialmente sem
  // valor/método definidos (ficaram nulos até ele decidir quanto ia contribuir). Mais tarde no
  // mesmo dia ele confirmou $10 — mesmo valor por cota dos demais participantes — via fundo
  // próprio (sem transferência bancária, por isso sem txId no sidecar privado).
  {
    id: "2026-08-10",
    gameType: "powerball",
    status: "planejamento",
    createdAt: "2026-08-09T08:40:00-04:00",
    previousDrawId: "2026-08-08",
    drawing: {
      name: "Powerball Jackpot",
      jackpot: 905000000,
      cashValue: 391900000,
      drawDateIso: "2026-08-10T22:59:00-04:00",
      drawDateLabel: "10/08/2026 22:59 ET"
    },

    participants: [
      {
        name: "Eduardo Ferrari",
        cotas: 1,
        valor: 10,
        metodo: "Fundo próprio (organizador)",
        data: "09/08/2026",
        hora: "8:40 AM",
        status: "organizador",
        state: "NC"
      },
      { name: "Marcelo Moreira", cotas: 1, valor: 10, metodo: "Zelle", data: "09/08/2026", hora: "9:00:45 AM", status: "verificado", state: "NC" },
      { name: "Simone Hirle da Costa", cotas: 1, valor: 10, metodo: "Venmo", data: "09/08/2026", hora: "9:42:55 AM", status: "verificado", state: "NC" },
      { name: "Marcus Steffenon", cotas: 1, valor: 10, metodo: "Zelle", data: "09/08/2026", hora: "9:46:39 AM", status: "verificado", state: "NC" },
      { name: "Leandro Augustineli", cotas: 1, valor: 10, metodo: "Zelle", data: "09/08/2026", hora: "9:54:35 AM", status: "verificado", state: "NC" },
      { name: "Gustavo Bossle", cotas: 1, valor: 10, metodo: "Zelle", data: "09/08/2026", hora: "10:03:04 AM", status: "verificado", state: "NC" },
      { name: "Ewerton Gruba Silva", cotas: 1, valor: 10, metodo: "Zelle", data: "09/08/2026", hora: "11:04:07 AM", status: "verificado", state: "NC" },
      { name: "Alan Rech", cotas: 1, valor: 10, metodo: "Cash App", data: "09/08/2026", hora: "11:23:59 AM", status: "verificado", state: "FL" },
      { name: "REDACTED_PARTICIPANT", cotas: 1, valor: 10, metodo: "Zelle", data: "09/08/2026", hora: "11:49 AM", status: "verificado", state: "FL" },
      { name: "Camila Ribeiro", cotas: 1, valor: 10, metodo: "Zelle", data: "09/08/2026", hora: "12:10 PM", status: "verificado", state: "NC" },
      // Zelle veio da conta empresarial "PS Place LLC" (memo "JORGE FL") — confirmado
      // pelo Eduardo que é o Jorge, mesma pessoa dos sorteios anteriores.
      { name: "Jorge Augusto Junqueira Ferreira", cotas: 1, valor: 10, metodo: "Zelle", data: "09/08/2026", hora: "12:13 PM", status: "verificado", state: "FL" },
      { name: "Amanda Quaresma", cotas: 1, valor: 10, metodo: "Venmo", data: "09/08/2026", hora: "12:14 PM", status: "verificado", state: "NC" },
      { name: "Marcelo Minghetti Pereira", cotas: 1, valor: 10, metodo: "Zelle", data: "09/08/2026", hora: "12:45 PM", status: "verificado", state: "NC" },
      { name: "Samuel Huller", cotas: 1, valor: 10, metodo: "Dinheiro (cash)", data: "10/08/2026", hora: "12:26 PM", status: "verificado", state: "NC" },
      { name: "Rodrigo Hajj", cotas: 1, valor: 10, metodo: "Zelle", data: "10/08/2026", hora: "3:03:24 PM", status: "verificado", state: "NC" }
    ],

    sharedTickets: {
      compradoPor: "Eduardo Ferrari (organizador)",
      dataComprovante: "10/08/2026 22:59 ET",
      valorPorTicket: 3, // Power Play
      series: [
        {
          serial: "207F604D666D98DE7", qtd: 8, jogos: "1–8",
          numeros: [
            "22-26-47-61-67 — PB 02", "23-26-27-34-69 — PB 18", "24-25-46-49-58 — PB 09",
            "27-38-39-46-65 — PB 04", "28-31-45-54-56 — PB 05", "33-41-42-47-64 — PB 06",
            "34-35-42-63-65 — PB 16", "40-41-51-53-60 — PB 26"
          ]
        },
        {
          serial: "2F4D8C413A888EA86", qtd: 50, jogos: "1–50",
          numeros: [
            "01-06-16-57-62 — PB 03", "01-10-24-41-63 — PB 01", "01-22-59-64-69 — PB 11",
            "01-28-50-53-55 — PB 05", "02-07-31-46-68 — PB 13", "02-13-35-59-66 — PB 09",
            "02-16-28-33-51 — PB 20", "02-26-49-55-64 — PB 07", "03-05-35-52-58 — PB 22",
            "03-10-18-38-51 — PB 06", "03-20-23-36-56 — PB 16", "03-22-28-39-68 — PB 12",
            "04-09-36-43-67 — PB 19", "04-17-27-55-58 — PB 15", "04-23-29-47-54 — PB 15",
            "04-25-31-32-37 — PB 11", "05-06-11-44-59 — PB 16", "05-07-30-32-50 — PB 24",
            "05-12-19-38-66 — PB 05", "06-14-39-49-63 — PB 18", "06-17-19-36-41 — PB 23",
            "07-15-16-40-64 — PB 13", "07-45-62-65-66 — PB 08", "08-15-56-60-69 — PB 17",
            "08-17-21-43-52 — PB 24", "08-35-40-44-67 — PB 13", "08-48-49-54-59 — PB 21",
            "09-11-24-39-54 — PB 10", "09-12-16-42-55 — PB 25", "09-18-27-45-48 — PB 02",
            "10-21-34-47-56 — PB 26", "10-29-48-57-68 — PB 17", "10-31-40-61-62 — PB 23",
            "11-12-32-47-62 — PB 07", "11-14-29-34-51 — PB 21", "11-40-52-65-68 — PB 03",
            "12-43-53-58-63 — PB 19", "13-18-24-60-61 — PB 08", "13-23-32-45-52 — PB 20",
            "13-42-44-50-69 — PB 14", "14-20-25-43-61 — PB 22", "14-36-37-53-57 — PB 01",
            "15-21-22-35-50 — PB 25", "15-25-30-36-45 — PB 12", "17-34-44-57-60 — PB 04",
            "18-26-29-37-58 — PB 07", "19-20-37-52-62 — PB 23", "19-21-33-46-48 — PB 14",
            "20-30-33-38-67 — PB 06", "21-27-30-49-66 — PB 10"
          ]
        }
      ]
    },

    // 58 tickets (8 + 50) x US$3 (Power Play) = US$174. Arrecadado US$150 + crédito de
    // US$24 do sorteio anterior (2026-08-08) = US$174 disponível — bate exato, nada sobra.
    // Comprovante NC Education Lottery, pedido #2CBCCF0B2A2761EDD.
    finance: {
      totalArrecadado: 150,
      creditoSorteioAnterior: 24,
      valorUtilizado: 174,
      valorGuardadoProximoSorteio: 0,
      ajustesPendentes: 0
    },

    result: {
      numbers: [6, 37, 54, 55, 64],
      special: 10,
      multiplier: 3,
      checkedAt: "11/08/2026 11:07 ET",
      premiosGanhos: 24,
      jackpotHit: false,
      breakdown: ["1x 1 + Powerball", "1x Powerball"]
    },
    profit: null
  },

  {
    id: "2026-08-12",
    gameType: "powerball",
    status: "planejamento",
    createdAt: "2026-08-11T10:26:07-04:00",
    previousDrawId: "2026-08-10",

    drawing: {
      name: "Powerball Jackpot",
      // jackpot/cashValue sao publicados pela loteria; ficam null ate serem informados.
      jackpot: 975000000,
      cashValue: 422300000,
      jackpotSource: "powerball_official",
      jackpotFetchedAt: "2026-08-11T15:26:03Z",
      jackpotDrawId: "2026-08-12",
      drawDateIso: "2026-08-12T22:59:00-04:00",
      drawDateLabel: "12/08/2026 22:59 ET"
    },

    // BOLAO ABERTO. Participantes entram progressivamente conforme os pagamentos sao
    // confirmados (reconciliacao via Gmail — ver auditoria de pagamentos de 11/08/2026).
    // Eduardo Ferrari (organizador) usa sempre a data/hora do primeiro pagamento recebido
    // no sorteio, por padrao explicito do Eduardo.
    participants: [
      { name: "Eduardo Ferrari", cotas: 1, valor: 10, metodo: "Fundo próprio (organizador)", data: "11/08/2026", hora: "9:17:36 AM", status: "organizador", state: "NC" },
      { name: "Jorge Augusto Junqueira Ferreira", cotas: 1, valor: 10, metodo: "Zelle", data: "11/08/2026", hora: "9:17:36 AM", status: "verificado", state: "FL" },
      { name: "Gustavo Bossle", cotas: 1, valor: 10, metodo: "Zelle", data: "11/08/2026", hora: "9:45:58 AM", status: "verificado", state: "NC" },
      { name: "Ewerton Gruba Silva", cotas: 1, valor: 10, metodo: "Zelle", data: "11/08/2026", hora: "9:46:43 AM", status: "verificado", state: "NC" },
      { name: "Simone Hirle da Costa", cotas: 1, valor: 10, metodo: "Venmo", data: "11/08/2026", hora: "10:00:30 AM", status: "verificado", state: "NC" },
      { name: "Camila Ribeiro", cotas: 1, valor: 10, metodo: "Zelle", data: "11/08/2026", hora: "10:03:42 AM", status: "verificado", state: "NC" },
      { name: "Rodrigo Hajj", cotas: 1, valor: 10, metodo: "Zelle", data: "11/08/2026", hora: "10:25:42 AM", status: "verificado", state: "NC" }
    ],

    // Sem bilhetes ainda. Os numeros entram depois da compra -- abrir o bolao nunca dependeu
    // de ja existirem jogos.
    sharedTickets: {
      compradoPor: null,
      dataComprovante: null,
      valorPorTicket: 3,
      series: []
    },

    finance: {
      totalArrecadado: 70,
      // Premio do sorteio anterior + o que ficou guardado. Derivado do que esta gravado, nao
      // arbitrado aqui.
      creditoSorteioAnterior: 24,
      valorUtilizado: 0,
      valorGuardadoProximoSorteio: 0,
      ajustesPendentes: 0
    },

    result: null,
    profit: null
  }
];

// Sorteio ativo/mais recente — é o que a página principal exibe.
window.POWERBALL_DATA = window.POWERBALL_DRAWS[window.POWERBALL_DRAWS.length - 1];
