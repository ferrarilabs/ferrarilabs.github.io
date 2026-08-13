window.BOLAO_CONFIG = {
  siteVersion: "v4.187",
  // Tournament fully decided (2026-07-19, Spain champion) -- Eduardo: "Copa do mundo finalizada!
  // ... Desabilitar os botões todos, deixar só o vencedor, auditoria e os palpites." When true,
  // hides the entry/games/probs/rules nav buttons and the Admin nav button (still reachable —
  // see renderFooterBar's small "Admin" link — admin itself stays password-gated regardless), and
  // the Ranking tab (already the only default landing section since cutoff) becomes the sole
  // reachable section. One flag, trivially reversible — flip back to false to reopen the site.
  archived: true,
  appName: "Bolão do Ferrari",
  subtitle: "Copa do Mundo 2026",
  storeKey: "bolao_copa_2026_state",
  entryFee: 5,
  // SHA-256 hash of admin password. Never store plaintext here.
  adminPasswordHash: "2132e264513230629493ac29b4192dbf5c99a203bcbb2b7a01020666fa32156c",
  adminMaxAttempts: 5,
  adminLockMinutes: 15,
  adminSessionMinutes: 30,
  r32CutoffIso: "2026-07-03T23:00:00-04:00",
  cutoffIso: "2026-07-04T12:00:00-04:00",
  cutoffLabel: "Oitavas de Final — prazo: 4 jul, 12h ET (meio-dia)",
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
    // LEITURA: projecao sanitizada. Remove participantEmail, payerName, paymentMethod e
    // paymentTo — os quatro campos que a chave anon publica expunha a qualquer visitante.
    // READ_CUTOVER (2026-08-13). A leitura sai de `bolao_state_public` (projecao por SUBTRACAO
    // sobre o documento legado) e passa para `bolao_state_normalized_public`, montada a partir de
    // bolao.* campo a campo. O documento e equivalente folha a folha — 0 BUG, 0 UNKNOWN nos tres
    // produtos — e a superficie nova NAO publica `auditLog` nem `entries[].diagnostics`, que hoje
    // vazam ip/userAgent para qualquer um com a anon key.
    //
    // A ESCRITA NAO MUDOU. `table` continua sendo o documento legado e continua sendo a
    // autoridade; o modelo normalizado recebe espelhos atomicos na mesma transacao. Reverter e
    // trocar esta linha de volta.
    readTable: "bolao_state_normalized_public",
    // ESCRITA: nao existe mais. O navegador nao grava no banco (COPA-APP-ROUTING). `table`
    // permanece porque a diferenca entre ele e `readTable` e o que arma o interlock
    // `__sanitized`; toda mutacao privilegiada passa por bolao/copa2026/scripts/operator_cli.py.
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
