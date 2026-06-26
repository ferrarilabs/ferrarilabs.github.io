window.BOLAO_CONFIG = {
  appName: "Bolão do Ferrari",
  subtitle: "Copa do Mundo 2026",
  siteVersion: "v1.3-test",
  entryFee: 5,

  // Admin: static-site protection only.
  // Password for the test: bolao2026
  adminPasswordHash: "a6b9c87326e39cd10daad4de218019396d46e3ab2d89822b926274613138dee6",
  adminMaxAttempts: 5,
  adminLockMinutes: 15,

  paymentMethods: {
    CashApp: "$EduardoFerrari",
    Zelle: "914-406-5027",
    PayPal: "emferrari@gmail.com",
    Venmo: "Eduardo-Ferrari"
  },

  paymentLinks: {
    CashApp: "https://cash.app/$EduardoFerrari",
    Venmo: "https://venmo.com/u/Eduardo-Ferrari",
    PayPal: "",
    Zelle: ""
  },

  whatsappGroup: {
    name: "Bolão do Ferrari",
    link: "https://chat.whatsapp.com/JF7lLG6HNjLIvC8p3Z8EVi?mode=gi_t",
    qrImage: "assets/whatsapp-group-qr.png"
  },

  zelle: {
    qrImage: "assets/zelle-qr.png",
    recipientName: "Eduardo",
    recipientPhone: "914-406-5027"
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

  cutoffIso: "2026-06-28T14:00:00-04:00",
  cutoffLabel: "Domingo, 28/jun/2026 às 2:00 PM ET",

  adminEmail: "emferrari@gmail.com",
  emailMode: "emailjs",
  emailjs: {
    enabled: true,
    publicKey: "GBZFujsJBET6modve",
    serviceId: "service_o4hyzxr",
    participantTemplateId: "template_xq7yzzb",
    adminTemplateId: "template_4sgp5r9"
  },

  simulationSource: "Modelo local com pesos estimados inspirado em força histórica/mercado. Integração Polymarket preparada para versão futura.",
  simulationDisclaimer: "Simulação automática é apenas entretenimento. Não é recomendação de aposta, não garante resultado e pode usar dados incompletos, desatualizados ou incorretos. O organizador não se responsabiliza por palpites gerados automaticamente.",

  predictionMarkets: {
    enabled: true,
    preferPolymarket: true,
    minConfidenceToUseMarket: 0.05,
    cacheMinutes: 10,
    note: "O simulador tenta usar probabilidades por jogo quando encontra mercado compatível no Polymarket. Se não encontrar, usa força estimada local."
  },

  polymarket: {
    enabled: false,
    gammaApiBase: "https://gamma-api.polymarket.com",
    note: "Integração futura: mapear mercados e odds da Copa com segurança antes de usar."
  },

  security: {
    staticSiteWarning: "Admin password in a static site can be bypassed by a technical user. Use Firebase/Supabase Auth for real security.",
    sanitizeUserContent: true,
    exportBackupsOften: true
  },

  transparency: {
    publishMasterListAfterCutoff: true,
    includeReceiptCodes: true,
    legalDisclaimer: "Bolão informal entre amigos. Comprovantes individuais, master list e backups exportados pelo administrador servem como evidência operacional em caso de dúvidas, erro técnico ou contestação."
  },

  diagnostics: {
    captureDeviceInfo: true,
    capturePublicIp: true,
    ipLookupUrl: "https://api.ipify.org?format=json",
    privacyNotice: "Para diagnóstico e auditoria básica, o site pode registrar IP público, tipo de dispositivo, navegador, sistema, timezone e horário de envio junto com o comprovante."
  },

  externalData: {
    predictionMarkets: {
    enabled: true,
    preferPolymarket: true,
    minConfidenceToUseMarket: 0.05,
    cacheMinutes: 10,
    note: "O simulador tenta usar probabilidades por jogo quando encontra mercado compatível no Polymarket. Se não encontrar, usa força estimada local."
  },

  polymarket: {
      enabled: true,
      eventsUrl: "https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100",
      note: "Conexão pública sem autenticação. O mapeamento de mercados da Copa precisa ser validado antes de usar odds como fonte oficial."
    },
    results: {
      mode: "manual",
      provider: "manual",
      // Não existe endpoint público oficial da FIFA garantido para browser/GitHub Pages.
      // Para automatizar, usar API-FOOTBALL/BallDontLie/Sportmonks com proxy/Firebase Function para não expor API key.
      endpoint: "",
      note: "Resultados oficiais ainda devem ser lançados manualmente nesta versão. API externa deve ser configurada via backend/proxy."
    }
  },

  storageMode: "localStorage"
};
