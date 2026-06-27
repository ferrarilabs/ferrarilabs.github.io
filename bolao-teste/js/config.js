window.BOLAO_CONFIG = {
  appName: "Bolão do Ferrari",
  subtitle: "Copa do Mundo 2026",
  siteVersion: "v3.0-clean",
  storeKey: "bolao2026_v3_clean",
  entryFee: 5,
  adminPasswordHash: "a6b9c87326e39cd10daad4de218019396d46e3ab2d89822b926274613138dee6",
  adminMaxAttempts: 5,
  adminLockMinutes: 15,
  adminSessionMinutes: 30,
  cutoffIso: "2026-06-28T14:00:00-04:00",
  cutoffLabel: "Domingo, 28/jun/2026 às 2:00 PM ET",
  adminEmail: "emferrari@gmail.com",
  paymentMethods: {
    CashApp: "$EduardoFerrari",
    Zelle: "914-406-5027",
    PayPal: "emferrari@gmail.com",
    Venmo: "Eduardo-Ferrari"
  },
  paymentLinks: {
    CashApp: "https://cash.app/$EduardoFerrari",
    Zelle: "",
    PayPal: "",
    Venmo: "https://venmo.com/u/Eduardo-Ferrari"
  },
  whatsappGroup: {
    name: "Bolão do Ferrari",
    link: "https://chat.whatsapp.com/JF7lLG6HNjLIvC8p3Z8EVi?mode=gi_t",
    qrImage: "assets/whatsapp-group-qr.png"
  },
  zelle: {
    qrImage: "assets/zelle-qr.png",
    recipientPhone: "914-406-5027"
  },
  scoring: {
    exactScore: 10,
    advance: 5,
    oneTeamGoals: 1
  },
  bonus: {
    champion: 25,
    runnerUp: 15,
    third: 10,
    fourth: 5
  },
  prizes: { first: 0.70, second: 0.20, third: 0.10 },
  emailMode: "emailjs",
  emailjs: {
    enabled: true,
    publicKey: "GBZFujsJBET6modve",
    serviceId: "service_o4hyzxr",
    participantTemplateId: "template_xq7yzzb",
    adminTemplateId: "template_4sgp5r9",
    limitRateMs: 30000
  },
  diagnostics: {
    captureDeviceInfo: true,
    capturePublicIp: false,
    ipLookupUrl: "https://api.ipify.org?format=json"
  },
  externalData: {
    polymarket: {
      enabled: true,
      eventsUrl: "https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100"
    },
    results: {
      mode: "manual",
      endpoint: ""
    }
  },
  transparency: {
    legalDisclaimer: "Bolão informal entre amigos. Comprovantes, master list e backups exportados pelo administrador servem como evidência operacional em caso de dúvidas, erro técnico ou contestação."
  }
};
