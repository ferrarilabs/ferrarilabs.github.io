window.BR2026_CONFIG = {
  siteVersion: "v1.2",
  appName: "Bolão Brasileirão 2026",
  storeKey: "bolao_br2026_state",
  entryFee: 5,
  // SHA-256 hash of admin password. Never store plaintext here.
  adminPasswordHash: "a6b9c87326e39cd10daad4de218019396d46e3ab2d89822b926274613138dee6",
  adminMaxAttempts: 5,
  adminLockMinutes: 15,
  adminSessionMinutes: 30,
  // UPDATE before publishing: cutoff before round that hasn't started yet
  cutoffIso: "2026-07-10T10:00:00-03:00",
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
    // G4 exact position points (index 0-3 = 1st to 4th)
    g4Exact: [30, 20, 15, 15],
    // Points for being in G4 but wrong position
    g4Group: 10,
    // Z4 exact position points (same for all 4)
    z4Exact: 12,
    // Points for being in Z4 but wrong position
    z4Group: 8,
    // Sul-Americana: points for any pick that lands in positions 7-12
    sa6Hit: 8,
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
    // Set to true after adding row id='br2026' in Supabase bolao_state table
    enabled: false,
    provider: "supabase",
    url: "https://cmhqkkfczotdnssupkni.supabase.co",
    anonKey: "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5",
    table: "bolao_state",
    stateId: "br2026",
    localFallback: true
  },
  espn: {
    leagueSlug: "bra.1",
    season: 2026,
    standingsUrl: "https://site.api.espn.com/apis/v2/sports/soccer/bra.1/standings",
    scoreboardUrl: "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard",
    scheduleUrl: "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard?dates=20260101-20261231&limit=500",
    pollIntervalMs: 60000,
  },
  transparency: {
    disclaimer: "Bolão informal entre amigos. Comprovantes individuais e backups servem como evidência. Sem responsabilidade por dados externos, APIs ou falhas de terceiros."
  }
};
