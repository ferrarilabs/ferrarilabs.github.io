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

  // Cutoff: 1 hour before first Round of 32 match.
  cutoffIso: "2026-06-28T14:00:00-04:00",
  cutoffLabel: "Domingo, 28/jun/2026 às 2:00 PM ET",

  // Static GitHub Pages cannot send emails by itself.
  // This version uses mailto links. For automatic e-mail later, configure EmailJS/Formspree/Firebase.
  adminEmail: "emferrari@gmail.com",
  emailMode: "mailto", // options: "mailto" or "emailjs"
  emailjs: {
    enabled: false,
    publicKey: "",
    serviceId: "",
    participantTemplateId: "",
    adminTemplateId: ""
  },

  simulationSource: "Modelo local com pesos estimados; Polymarket Gamma API pode ser conectado futuramente.",
  simulationDisclaimer: "Simulação automática é apenas entretenimento. Não é recomendação de aposta, não garante resultado e pode usar dados incompletos, desatualizados ou incorretos. O organizador não se responsabiliza por palpites gerados automaticamente.",

  polymarket: {
    enabled: false,
    gammaApiBase: "https://gamma-api.polymarket.com",
    note: "Gamma API é pública para metadados/descoberta de mercados, mas a integração depende de mapear corretamente mercados e seleções da Copa."
  },

  transparency: {
    publishMasterListAfterCutoff: true,
    includeReceiptCodes: true,
    legalDisclaimer: "Bolão informal entre amigos. Comprovantes individuais, master list e backups exportados pelo administrador servem como evidência operacional em caso de dúvidas ou falha técnica."
  },

  storageMode: "localStorage"
};
