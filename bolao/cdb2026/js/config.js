// Pipeline de cache-bust validado ponta a ponta em 2026-08-07: o deploy do Pages agora é
// disparado explicitamente pelo sync_version.yml (push com GITHUB_TOKEN nao acorda workflow).
window.CDB2026_CONFIG = {
  siteVersion: "v3.108",
  appName: "Bolão Copa do Brasil 2026",
  storeKey: "bolao_cdb2026_state",
  entryFee: 5,
  // ENTRY ROSTER FREEZE (2026-08-07, decisão do Eduardo): as inscrições do bolão da Copa do
  // Brasil estão encerradas EM DEFINITIVO. Nenhuma entrada nova é criada até a Final pelos
  // caminhos normais da aplicação: formulário público (saveEntry), admin e mutação de estado
  // (applyAdminMutation "upsert-entry").
  //
  // LIMITAÇÃO — leia antes de confiar nisto: este é um controle de CAMADA DE APLICAÇÃO, não uma
  // fronteira de segurança de banco. Ele NÃO impede um insert direto na tabela do Supabase via
  // API/anon key por fora da aplicação. Não afirmar "é impossível criar entradas por qualquer
  // meio técnico"; a afirmação correta é "os caminhos normais de criação da aplicação e do admin
  // estão congelados". Enforcement no banco (RLS/constraint) fica para a modernização, em
  // trabalho separado — deliberadamente NÃO implementado neste patch.
  //
  // Isto é INDEPENDENTE de `PICKS_OPEN`. Os palpites ainda abrem três vezes (quartas, semifinal,
  // final) e essa reabertura NUNCA reabre inscrição. Invariante:
  //
  //     PICKS_OPEN pode alternar por fase.  ENTRY_CREATION_ALLOWED permanece false.
  //
  // Por que uma flag explícita e não só o cutoff: até aqui o fechamento das inscrições era
  // derivado de `entryCutoffMs()`, que devolve o cutoff da FASE ATIVA (`espnSync.activePhaseId`).
  // Quando o sorteio das quartas for cadastrado, esse cutoff volta a ser um instante FUTURO e
  // `isPastEntryCutoff()` vira false — reabrindo o formulário, o botão "Nova entrada" e a seção
  // inicial de entrada. Ou seja: abrir os palpites das quartas reabriria a inscrição sozinho.
  // Esta flag corta esse acoplamento; o cutoff continua governando só os palpites.
  entryRosterFrozen: true,
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
    // partida). CORREÇÃO 2026-08-01 (revertendo uma remoção errada feita mais cedo no mesmo dia):
    // `result` (5 pts por acertar vitória/empate/derrota mesmo com placar diferente) É uma regra
    // real do CDB2026 -- confirmado por Eduardo diretamente, colando a tabela de regras completa
    // e pedindo auditoria: "Sistema de pontuação ... Resultado certo (vitória/derrota/empate),
    // placar não exato 5". A comparação com a Copa do Mundo (que só tem exact+side, sem esse
    // tier) NÃO se aplica aqui -- CDB2026_RULES_AND_MODEL.md sempre documentou os 3 tiers, e o
    // "mesmos valores da Copa do Mundo" no comentário original era sobre os VALORES em pontos
    // (10/5/1), não sobre quais categorias existem. Ver CHANGELOG.md para o histórico completo
    // (a remoção e a reversão, ambas registradas, nenhuma reescrita silenciosa).
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
  // Sincronização com a ESPN — ver docs/bolao/CDB2026_RULES_AND_MODEL.md "Sincronização com ESPN".
  //
  // ATENÇÃO: este comentário dizia "só busca sob demanda (botão no admin), nunca grava nada sem
  // confirmação humana" e isso NÃO é mais verdade desde a automação de sync (v3.16+). Corrigido
  // na auditoria de 2026-08: `autoSyncEspn()` cria confrontos e `autoSyncEspnResults()` preenche
  // placares e chega a TRAVAR a classificação de um confronto automaticamente
  // (`resultSource: "espn-auto"`, `lockedBy: "espn-auto"`), sem clique do admin. Também existe
  // poll de 60s do card ao vivo (`pollLiveTies()`), que é só exibição e nunca grava estado.
  // Slug verificado contra a API real em 2026-08 (142 jogos retornados).
  espn: {
    leagueSlug: "bra.copa_do_brazil",
    // Snapshot NORMALIZADO gerado server-side (bolao/shared/scripts/espn_provider.py +
    // scripts/sync_espn.py) e versionado no repo. Mesma origem da página: o navegador nunca chama
    // a ESPN direto. A URL original da ESPN vive agora só no sync_espn.py deste app.
    scoreboardUrl: "data/espn-normalized.json",
  },
  transparency: {
    disclaimer: "Bolão informal entre amigos. Comprovantes individuais e backups servem como evidência. Sem responsabilidade por dados externos, APIs ou falhas de terceiros."
  }
};
