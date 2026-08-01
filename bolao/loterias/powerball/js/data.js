// Cada sorteio do bolão é uma entrada em `draws`. Para registrar um novo sorteio,
// duplique um objeto abaixo, atualize os dados e preencha `result`/`profit` depois
// que o sorteio sair — isso dá histórico automático (lucro, resultados anteriores etc.)
// sem precisar reestruturar nada. `window.POWERBALL_DATA` sempre aponta para o mais
// recente (o sorteio ativo/exibido na página principal).
window.POWERBALL_DRAWS = [
  {
    id: "2026-08-03",
    drawing: {
      name: "Powerball Jackpot",
      jackpot: 707000000,
      drawDateIso: "2026-08-03T22:59:00-04:00",
      drawDateLabel: "03/08/2026 22:59 ET"
    },

    // 14 participantes, 1 cota = US$20 cada. Eduardo é o organizador: fundo já
    // disponível na conta dele, sem depósito necessário (não há recibo de transferência).
    // Os tickets são comprados de uma vez só com o fundo do bolão e são coletivos —
    // todos os participantes concorrem aos mesmos números (ver `sharedTickets` abaixo).
    participants: [
      { name: "Eduardo Ferrari", cotas: 1, valor: 20, metodo: "Fundo próprio (organizador)", data: "31/07/2026", hora: "—", txId: "—", status: "organizador" },
      { name: "Gustavo Bossle", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "4:52:51 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado" },
      { name: "Tatiana Bossle", cotas: 1, valor: 20, metodo: "Zelle (depósito de Gustavo Bossle)", data: "01/08/2026", hora: "11:57:41 AM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado" },
      { name: "Marcelo Moreira", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "4:39:47 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado" },
      { name: "Leandro Augustineli", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "4:43:30 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado" },
      { name: "Alan Rech", cotas: 1, valor: 20, metodo: "Cash App", data: "31/07/2026", hora: "4:45:18 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado" },
      { name: "Ewerton Gruba Silva", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "4:48:11 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado" },
      { name: "Simone Hirle da Costa", cotas: 1, valor: 20, metodo: "Venmo", data: "31/07/2026", hora: "4:54:29 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado" },
      { name: "Camila Ribeiro", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "9:12:05 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado" },
      { name: "Marcus Steffenon", cotas: 1, valor: 20, metodo: "Zelle", data: "31/07/2026", hora: "11:41:45 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado" },
      { name: "Samuel Huller", cotas: 1, valor: 20, metodo: "Zelle", data: "01/08/2026", hora: "7:12:54 AM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado" },
      { name: "Amanda Quaresma", cotas: 1, valor: 20, metodo: "Venmo", data: "01/08/2026", hora: "9:02:20 AM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado" },
      { name: "Rodrigo Hajj", cotas: 1, valor: 20, metodo: "Zelle", data: "01/08/2026", hora: "12:29:15 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado" },
      { name: "Nathalia Galeazzi Nedel", cotas: 1, valor: 20, metodo: "Zelle", data: "01/08/2026", hora: "12:36:16 PM", txId: "REDACTED_PAYMENT_REFERENCE", status: "verificado" }
    ],

    // Tickets comprados de uma vez com o fundo do bolão (compra única, valem para todos).
    sharedTickets: {
      compradoPor: "Eduardo Ferrari (organizador)",
      dataComprovante: "01/08/2026 10:59 PM ET",
      valorPorTicket: 3, // Power Play
      series: [
        { serial: "274CD4C12C6766A4C", qtd: 20, numeros: ["1-14-27-63-64-25", "1-18-37-40-48-8"] },
        { serial: "2B30C09BAC09CBD11", qtd: 10, numeros: [] },
        { serial: "2D8EA8E168063B40F", qtd: 8, numeros: [] }
      ]
    },

    finance: {
      totalArrecadado: 280,
      valorUtilizado: 114,   // 38 tickets x US$3 (Power Play)
      valorGuardadoProximoSorteio: 166
    },

    // Preenchido manualmente após o sorteio de 03/08/2026.
    result: {
      numbers: null,       // ex: [12, 24, 33, 47, 61]
      powerball: null,     // ex: 9
      powerPlay: null,     // ex: 3
      checkedAt: null
    },

    // Preenchido manualmente após conferir os tickets contra o resultado.
    // profit = prêmios ganhos - valorUtilizado (não conta o valor guardado, que é reciclado).
    profit: {
      premiosGanhos: null,
      lucro: null
    }
  }
];

// Sorteio ativo/mais recente — é o que a página principal exibe.
window.POWERBALL_DATA = window.POWERBALL_DRAWS[window.POWERBALL_DRAWS.length - 1];
