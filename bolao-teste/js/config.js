window.BOLAO_CONFIG = {
  siteVersion: "v4.27",
  appName: "Bolão do Ferrari",
  subtitle: "Copa do Mundo 2026",
  storeKey: "bolao_copa_2026_state",
  entryFee: 5,
  // SHA-256 hash of admin password. Never store plaintext here.
  adminPasswordHash: "a6b9c87326e39cd10daad4de218019396d46e3ab2d89822b926274613138dee6",
  adminMaxAttempts: 5,
  adminLockMinutes: 15,
  adminSessionMinutes: 30,
  r32CutoffIso: "2026-07-04T01:00:00-04:00",
  cutoffIso: "2026-06-29T21:00:00-04:00",
  cutoffLabel: "Encerrado — reabre após o M88",
  adminEmail: "emferrari@gmail.com",
  paymentMethods: {
    CashApp: "$EduardoFerrari",
    Zelle: "914-406-5027",
    Venmo: "Eduardo-Ferrari"
  },
  paymentLinks: {
    CashApp: "https://cash.app/$EduardoFerrari",
    Zelle: "",
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
  prizes: { first: 0.70, second: 0.20, third: 0.10 },
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
  emailjs: {
    enabled: true,
    publicKey: "GBZFujsJBET6modve",
    serviceId: "service_o4hyzxr",
    participantTemplateId: "template_xq7yzzb",
    adminTemplateId: "template_4sgp5r9",
    limitRateMs: 30000
  },
  database: {
    enabled: true,
    provider: "supabase",
    url: "https://cmhqkkfczotdnssupkni.supabase.co",
    anonKey: "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5",
    table: "bolao_state",
    stateId: "main",
    localFallback: true
  },
  apiFootball: {
    enabled: false,
    apiKey: "",
    baseUrl: "https://v3.football.api-sports.io",
    league: 1,
    season: 2026,
    cacheMinutes: 60
  },
  externalData: {
    polymarket: {
      enabled: true,
      eventsUrl: "https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100"
    }
  },
  transparency: {
    disclaimer: "Bolão informal entre amigos. Comprovantes individuais, master list e backups exportados pelo administrador servem como evidência operacional em caso de dúvidas, erro técnico ou contestação. Probabilidades dos simuladores são informativas, podem estar erradas ou desatualizadas, e não constituem recomendação de apostas. Sem responsabilidade por dados externos, APIs ou falhas de terceiros."
  }
};
