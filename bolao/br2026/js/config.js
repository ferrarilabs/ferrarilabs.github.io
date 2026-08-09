window.BR2026_CONFIG = {
  siteVersion: "v1.106",
  appName: "Bolão Brasileirão 2026",
  storeKey: "bolao_br2026_state",
  entryFee: 5,
  // SHA-256 hash of admin password. Never store plaintext here.
  adminPasswordHash: "2132e264513230629493ac29b4192dbf5c99a203bcbb2b7a01020666fa32156c",
  adminMaxAttempts: 5,
  adminLockMinutes: 15,
  adminSessionMinutes: 30,
  // Cutoff é calculado automaticamente (1h antes do primeiro jogo real do calendário, ver
  // freezeSeasonCutoff()/nextUpcomingGame() em app.js) e congelado em s.cutoffAt assim que o
  // calendário da ESPN carrega -- este valor aqui é só o fallback usado antes desse primeiro
  // congelamento. Corrigido em 2026-07-14 (Eduardo, comparando com o card "Próximo jogo"): o
  // valor antigo (19/jul 23h59, "2 dias antes do reinício do BR") tinha ficado defasado -- o
  // primeiro jogo real já era Botafogo x Santos, qui. 16/jul às 19h30 BRT. Fallback atualizado
  // para bater com isso (1h antes: 18h30). Estendido em 2026-07-16 (Eduardo pediu +45min depois
  // do prazo já ter passado) -- s.cutoffAt em produção (Supabase) foi atualizado diretamente
  // para 19h15 -03:00; este fallback também atualizado para bater, embora só afete quem nunca
  // carregou o app (já congelado pra todo mundo que já visitou hoje).
  cutoffIso: "2026-07-16T19:15:00-03:00",
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
  // Mesmo grupo da Copa do Mundo (bolao/js/config.js) — reaproveitado, não é um grupo novo.
  whatsappGroup: {
    name: "Bolão do Ferrari",
    link: "https://chat.whatsapp.com/JF7lLG6HNjLIvC8p3Z8EVi?mode=gi_t",
    qrImage: "assets/whatsapp-group-qr.png"
  },
  zelle: {
    qrImage: "assets/zelle-qr.png"
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
    // REQUIRES the RLS policies on bolao_state to allow id='br2026' (they only allowed
    // id='main' until 2026-07-13) — see docs/bolao/DATABASE_SETUP_SUPABASE.md "Múltiplos apps
    // na mesma tabela". Until that SQL is run in Supabase, every read/write here silently no-ops
    // (RLS rejects it, the local-first fallback swallows the error) — enabled:true alone is not
    // enough to actually sync.
    enabled: true,
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
    // Snapshots NORMALIZADOS gerados server-side (bolao/shared/scripts/espn_provider.py +
    // scripts/sync_espn.py) e versionados no repo. Mesma origem da página: o navegador nunca chama
    // a ESPN direto — era este `standingsUrl` que a produção não conseguia buscar por CORS, e por
    // isso as barras de probabilidade desapareciam. As URLs reais da ESPN vivem agora só no
    // sync_espn.py deste app.
    //
    // scoreboardUrl e scheduleUrl apontam para o MESMO arquivo de propósito: o snapshot já cobre a
    // temporada inteira, que é o que a antiga scheduleUrl (dates=...&limit=500) buscava.
    standingsUrl: "data/espn-standings-normalized.json",
    scoreboardUrl: "data/espn-normalized.json",
    scheduleUrl: "data/espn-normalized.json",
    pollIntervalMs: 60000,
  },
  transparency: {
    disclaimer: "Bolão informal entre amigos. Comprovantes individuais e backups servem como evidência. Sem responsabilidade por dados externos, APIs ou falhas de terceiros."
  }
};
