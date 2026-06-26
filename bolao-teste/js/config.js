window.BOLAO_CONFIG = {
  appName: "Bolão do Ferrari",
  subtitle: "Copa do Mundo 2026",
  entryFee: 5,
  adminPassword: "bolao2026",

  paymentMethods: {
    CashApp: "$emferrari",
    Zelle: "914-406-5027",
    PayPal: "emferrari@gmail.com",
    Venmo: "Eduardo-Ferrari"
  },

  paymentLinks: {
    CashApp: "https://cash.app/$emferrari",
    Venmo: "https://venmo.com/u/Eduardo-Ferrari",
    PayPal: "",
    Zelle: ""
  },

  whatsappGroup: {
    name: "Bolão do Ferrari",
    link: "https://chat.whatsapp.com/JF7lLG6HNjLIvC8p3Z8EVi?mode=gi_t",
    qrImage: "assets/whatsapp-group-qr.png"
  },

  prizes: {
    first: 0.70,
    second: 0.20,
    third: 0.10
  },

  bonus: {
    champion: 25,
    runnerUp: 15,
    third: 10,
    fourth: 5
  },

  scoring: {
    exactScore: 10,
    advance: 5,
    oneTeamGoals: 1,
    maxPerMatch: 15
  },

  storageMode: "localStorage"
};
