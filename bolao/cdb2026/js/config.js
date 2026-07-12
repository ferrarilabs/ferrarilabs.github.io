window.CDB2026_CONFIG = {
  siteVersion: "v1.4",
  appName: "Bolão Copa do Brasil 2026",
  storeKey: "bolao_cdb2026_state",
  entryFee: 5,
  // SHA-256 hash of admin password. Never store plaintext here.
  adminPasswordHash: "a6b9c87326e39cd10daad4de218019396d46e3ab2d89822b926274613138dee6",
  adminMaxAttempts: 5,
  adminLockMinutes: 15,
  adminSessionMinutes: 30,
  // UPDATE before publishing: cutoff before quarterfinal second leg
  cutoffIso: "2026-08-01T12:00:00-03:00",
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
  prizes: { first: 0.70, second: 0.20, third: 0.10 },
  scoring: {
    // Campeão exato
    champion: 30,
    // Vice-campeão (finalista que perde) exato
    runnerUp: 20,
    // Cada semifinalista correto (qualquer um dos 2 que perderam nas semis)
    semifinalist: 10,
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
    // Set to true after adding row id='cdb2026' in Supabase bolao_state table
    enabled: false,
    provider: "supabase",
    url: "https://cmhqkkfczotdnssupkni.supabase.co",
    anonKey: "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5",
    table: "bolao_state",
    stateId: "cdb2026",
    localFallback: true
  },
  transparency: {
    disclaimer: "Bolão informal entre amigos. Comprovantes individuais e backups servem como evidência. Sem responsabilidade por dados externos, APIs ou falhas de terceiros."
  }
};
