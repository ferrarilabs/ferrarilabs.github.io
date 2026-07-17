window.CDB2026_CONFIG = {
  siteVersion: "v3.41",
  appName: "Bolão Copa do Brasil 2026",
  storeKey: "bolao_cdb2026_state",
  entryFee: 5,
  // SHA-256 hash of admin password. Never store plaintext here.
  adminPasswordHash: "2132e264513230629493ac29b4192dbf5c99a203bcbb2b7a01020666fa32156c",
  adminMaxAttempts: 5,
  adminLockMinutes: 15,
  adminSessionMinutes: 30,
  // Cutoff não é mais um valor único global — cada fase tem seu próprio prazo, definido pelo
  // admin ao cadastrar os confrontos daquela fase (ver docs/bolao/CDB2026_RULES_AND_MODEL.md e
  // s.phases[id].cutoffAt no estado dinâmico em app.js).
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
  // Modelo de pontuação — ver docs/bolao/CDB2026_RULES_AND_MODEL.md (fonte oficial do modelo,
  // aprovada por Eduardo em 2026-07-13). Pontuação é POR PARTIDA (não por confronto agregado
  // digitado direto — isso era o modelo antigo, incorreto para a Copa do Brasil real).
  scoring: {
    // Por partida individual — mutuamente exclusivo (nunca soma exact+result+side na mesma
    // partida), mesmos valores da Copa do Mundo (bolao/js/config.js).
    match: {
      exact: 10,   // placar exato da partida
      result: 5,   // resultado certo (vitória/derrota/empate), placar não exato
      side: 1,     // gols de um dos dois times batem exatamente, mesmo com resultado errado
    },
    // Bônus por confronto — acertar quem se classifica, independente do placar de cada perna.
    tieBonus: 5,
    // Bônus de pódio final — sem disputa de 3º lugar (não existe na Copa do Brasil).
    bonus: {
      champion: 30,
      runnerUp: 20,
    },
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
    // REQUIRES the RLS policies on bolao_state to allow id='cdb2026' (they only allowed
    // id='main' until 2026-07-13) — see docs/bolao/DATABASE_SETUP_SUPABASE.md "Múltiplos apps
    // na mesma tabela". Until that SQL is run in Supabase, every read/write here silently no-ops
    // (RLS rejects it, the local-first fallback swallows the error) — enabled:true alone is not
    // enough to actually sync. Especially important here: this app now has real confrontos and
    // real picks riding on it (ESPN sync, v3.1).
    enabled: true,
    provider: "supabase",
    url: "https://cmhqkkfczotdnssupkni.supabase.co",
    anonKey: "sb_publishable_9eJsJzMcROuj9SFOMVUTvA_mWVz0fG5",
    table: "bolao_state",
    stateId: "cdb2026",
    localFallback: true
  },
  // Sincronização com a ESPN — só busca sob demanda (botão no admin), nunca grava nada sem
  // confirmação humana. Diferente do BR2026 (polling automático de uma tabela de liga), a Copa
  // do Brasil é mata-mata sem "ao vivo" contínuo — ver docs/bolao/CDB2026_RULES_AND_MODEL.md
  // "Sincronização com ESPN". Slug encontrado via busca pública, não verificado com uma chamada
  // direta (ambiente sem acesso de rede a hosts externos) — testar no primeiro uso real.
  espn: {
    leagueSlug: "bra.copa_do_brazil",
    scoreboardUrl: "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.copa_do_brazil/scoreboard?dates=20260101-20261231&limit=500",
  },
  transparency: {
    disclaimer: "Bolão informal entre amigos. Comprovantes individuais e backups servem como evidência. Sem responsabilidade por dados externos, APIs ou falhas de terceiros."
  }
};
