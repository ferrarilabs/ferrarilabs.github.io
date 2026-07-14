// Copa do Brasil 2026 — modelo de fases dinâmicas, ver docs/bolao/CDB2026_RULES_AND_MODEL.md
// (fonte oficial do modelo, aprovada por Eduardo em 2026-07-13).
//
// Diferença fundamental em relação ao bracket fixo da Copa do Mundo (bolao/js/data.js): aqui
// só a ESTRUTURA da fase (nome, formato, ordem) é conhecida em tempo de deploy — o regulamento
// da CBF define isso, não muda durante o torneio. QUAIS TIMES se enfrentam em cada fase só é
// conhecido depois de cada sorteio real, então confrontos/partidas NÃO ficam aqui: eles vivem
// no estado dinâmico (s.competition.phases[id].ties — ver app.js), cadastrados pelo admin
// conforme cada sorteio acontece. Isso evita "inventar" confrontos futuros no código-fonte.
window.CDB2026_DATA = {
  // 9 fases da Copa do Brasil 2026 — 1ª a 4ª e a Final em partida única, 5ª a 8ª (incluindo a
  // Semifinal) em ida e volta. Nomes descritivos das últimas fases (Oitavas/Quartas/Semifinal)
  // são só rótulo de exibição — o formato/ordem é o que importa para a lógica.
  phases: [
    { id: "fase-1",     name: "1ª Fase",             format: "SINGLE_MATCH", order: 1 },
    { id: "fase-2",     name: "2ª Fase",              format: "SINGLE_MATCH", order: 2 },
    { id: "fase-3",     name: "3ª Fase",              format: "SINGLE_MATCH", order: 3 },
    { id: "fase-4",     name: "4ª Fase",              format: "SINGLE_MATCH", order: 4 },
    { id: "fase-5",     name: "5ª Fase",              format: "TWO_LEG",      order: 5 },
    { id: "oitavas",    name: "Oitavas de Final",     format: "TWO_LEG",      order: 6 },
    { id: "quartas",    name: "Quartas de Final",     format: "TWO_LEG",      order: 7 },
    { id: "semifinal",  name: "Semifinal",            format: "TWO_LEG",      order: 8 },
    { id: "final",      name: "Final",                format: "SINGLE_MATCH", order: 9 },
  ],

  // Fases que a CBF já concluiu ANTES deste bolão existir (torneio de 126 times — 1ª a 4ª fase
  // somam 90+ partidas de clubes estaduais/regionais menores, com fontes bem mais esparsas que
  // a 5ª fase e as fases finais). Eduardo decidiu (2026-07-14) não popular resultado partida a
  // partida dessas quatro fases — risco de erro alto demais numa varredura de busca nesse volume
  // e nesses times, e essas fases nunca estiveram abertas para palpite (o bolão só foi ao ar
  // depois delas terem acabado). Usado só para trocar a mensagem de "aguardando sorteio" (que
  // seria enganosa — dá a entender que a fase ainda vai acontecer) por uma nota de "já
  // concluída" e para tirar essas fases do formulário de palpites. Ver seção 7.2 de
  // docs/bolao/CDB2026_RULES_AND_MODEL.md.
  phasesConcludedNoData: ["fase-1", "fase-2", "fase-3", "fase-4"],

  // Escudo real (ESPN CDN) por time — cobre os clubes de Série A/B mais prováveis de aparecer
  // nas fases finais (mesmo conjunto já usado antes desta reformulação). Times de divisões mais
  // baixas que o admin cadastrar sem entrada aqui simplesmente não mostram escudo (fallback
  // gracioso em teamLogoImg() — ver app.js) — não é erro, é esperado num torneio de 126 clubes.
  teamLogos: {
    "Athletico-PR": "https://a.espncdn.com/i/teamlogos/soccer/500/3458.png",
    "Atlético-MG": "https://a.espncdn.com/i/teamlogos/soccer/500/7632.png",
    "Chapecoense": "https://a.espncdn.com/i/teamlogos/soccer/500/9318.png",
    "Corinthians": "https://a.espncdn.com/i/teamlogos/soccer/500/874.png",
    "Cruzeiro": "https://a.espncdn.com/i/teamlogos/soccer/500/2022.png",
    "Fluminense": "https://a.espncdn.com/i/teamlogos/soccer/500/3445.png",
    "Fortaleza": "https://a.espncdn.com/i/teamlogos/soccer/500/6272.png",
    "Grêmio": "https://a.espncdn.com/i/teamlogos/soccer/500/6273.png",
    "Internacional": "https://a.espncdn.com/i/teamlogos/soccer/500/1936.png",
    "Juventude": "https://a.espncdn.com/i/teamlogos/soccer/500/6270.png",
    "Mirassol": "https://a.espncdn.com/i/teamlogos/soccer/500/9169.png",
    "Palmeiras": "https://a.espncdn.com/i/teamlogos/soccer/500/2029.png",
    "Remo": "https://a.espncdn.com/i/teamlogos/soccer/500/4936.png",
    "Santos": "https://a.espncdn.com/i/teamlogos/soccer/500/2674.png",
    "Vasco": "https://a.espncdn.com/i/teamlogos/soccer/500/3454.png",
    "Vitória": "https://a.espncdn.com/i/teamlogos/soccer/500/3457.png",
  },

  // Força aproximada (escala 0-100) só para a aba "Probabilidades" (estimativa, não fonte
  // oficial — ver disclaimer na própria aba). Time cadastrado pelo admin que não estiver aqui
  // usa um valor neutro padrão (ver DEFAULT_STRENGTH em app.js) em vez de quebrar a estimativa.
  strength: {
    "Palmeiras": 85, "Atlético-MG": 78, "Corinthians": 76, "Internacional": 76,
    "Grêmio": 75, "Cruzeiro": 75, "Fluminense": 73, "Fortaleza": 70,
    "Santos": 68, "Athletico-PR": 66, "Vasco": 66, "Vitória": 62,
    "Mirassol": 62, "Juventude": 60, "Chapecoense": 55, "Remo": 55,
  },

  // Confrontos JÁ SORTEADOS (fato conhecido, não invenção de chaveamento futuro) — sorteio da
  // CBF realizado em 26/05/2026. teamA = manda o jogo de ida; teamB = manda o jogo de volta
  // (decisivo) — mesma convenção de renderAdminResultsForTie() em app.js. Usado só como
  // POPULAÇÃO INICIAL uma única vez (ver seedKnownConfrontos() em app.js) — depois disso o admin
  // tem controle total (editar/remover via a UI existente); nunca é reaplicado. Isso não viola o
  // princípio "não fica confronto hardcoded" do modelo (ver topo deste arquivo) porque estes 8
  // confrontos NÃO são um chaveamento inventado com antecedência — já são resultado de um
  // sorteio real e público, só ainda não cadastrados manualmente.
  //
  // Fonte: busca pública (múltiplas matérias, incluindo corinthians.com.br oficial, cruzando
  // Fluminense×Vasco, Corinthians×Internacional, Grêmio×Mirassol, Vitória×Athletico-PR,
  // Juventude×Atlético-MG, Remo×Santos, Cruzeiro×Chapecoense, Fortaleza×Palmeiras — mando de
  // campo confirmado cruzando 3+ fontes independentes) — NÃO verificada contra uma chamada direta
  // à API da CBF/ESPN (ambiente de desenvolvimento sem acesso de rede externo, ver
  // docs/bolao/CDB2026_RULES_AND_MODEL.md seção 7). Datas: ida 1–2/ago/2026, volta 5–6/ago/2026
  // (data exata de cada jogo ainda não confirmada nas fontes — kickoff fica em aberto, o admin
  // preenche quando a CBF publicar a tabela detalhada). CONFERIR e corrigir via admin se algo
  // estiver errado — a UI de "Fases e confrontos" permite remover qualquer confronto sem
  // resultado lançado.
  knownConfrontos: {
    oitavas: [
      { teamA: "Vasco",         teamB: "Fluminense"   },
      { teamA: "Internacional", teamB: "Corinthians"  },
      { teamA: "Mirassol",      teamB: "Grêmio"       },
      { teamA: "Athletico-PR",  teamB: "Vitória"      },
      { teamA: "Atlético-MG",   teamB: "Juventude"    },
      { teamA: "Santos",        teamB: "Remo"         },
      { teamA: "Chapecoense",   teamB: "Cruzeiro"     },
      { teamA: "Palmeiras",     teamB: "Fortaleza"    },
    ],

    // 5ª Fase — JÁ CONCLUÍDA (ida 21–23/abr/2026, volta 12–14/maio/2026), diferente das Oitavas
    // acima: aqui teamA/teamB TÊM resultado (winner + legs), populados só para referência na aba
    // "Jogos" (não afeta pontuação — ver docs/bolao/CDB2026_RULES_AND_MODEL.md seção 7.2).
    // winner: "A" ou "B" corresponde a qual lado (teamA/teamB) avançou — setado direto a partir
    // do fato já conhecido, não derivado do placar abaixo (2 dos 16 confrontos foram decididos
    // nos pênaltis com agregado empatado; o placar continua o das duas pernas, sem gol de
    // pênalti, mesma convenção já usada pelo app para qualquer confronto decidido nos pênaltis —
    // ver rulesPenaltyText em i18n.js). legs.first = ida (teamA manda), legs.second = volta
    // (teamB manda) — mesma convenção da Oitavas. Os 16 vencedores batem exatamente com os 16
    // times já cadastrados nas Oitavas acima (nenhum de menos, nenhum a mais, nenhum duplicado) —
    // validação cruzada forte entre as duas fontes de dados independentes.
    //
    // Fonte: pesquisa cruzando 2+ fontes independentes por confronto (sites oficiais dos clubes,
    // ge.globo/CNN Brasil/ESPN, coberturas locais) para ida, volta e vencedor de todos os 16
    // confrontos — nenhum ficou sem confirmação. Dois resultados de busca inicialmente
    // contraditórios foram detectados e corrigidos durante a pesquisa antes de entrar aqui:
    // Atlético-MG×Ceará (um resumo automático errou o placar da volta como "2-2"; o real, cruzado
    // em 3+ fontes e vídeos, é Ceará 2×1 Atlético-MG, agregado 3-3, pênaltis 4-2 Atlético-MG) e
    // Flamengo×Vitória (um resumo alucinou "1-0" na ida; o real, cruzado em 4 fontes, é Flamengo
    // 2×1 Vitória na ida). Mesmo limite de rede das seções anteriores (sem chamada direta à
    // API oficial da CBF/ESPN neste ambiente) — CONFERIR contra a tabela oficial e corrigir via
    // admin (tela "Fases e confrontos") se algo estiver errado; sem risco a pontuação, já que esta
    // fase nunca esteve aberta para palpite. Diferente de fase-1/2/3/4 (sem dado nenhum, ver
    // DATA.phasesConcludedNoData), a 5ª Fase É populada com ties/resultado — mas fica de fora do
    // formulário de palpites do mesmo jeito, por já estar 100% decidida (ver phaseFullyResolved()
    // em app.js).
    "fase-5": [
      { teamA: "Atlético-MG",  teamB: "Ceará",         winner: "A", legs: { first: { goalsHome: 2, goalsAway: 1 }, second: { goalsHome: 2, goalsAway: 1 } } },
      { teamA: "Goiás",        teamB: "Cruzeiro",      winner: "B", legs: { first: { goalsHome: 2, goalsAway: 2 }, second: { goalsHome: 1, goalsAway: 0 } } },
      { teamA: "Athletico-PR", teamB: "Atlético-GO",   winner: "A", legs: { first: { goalsHome: 0, goalsAway: 0 }, second: { goalsHome: 0, goalsAway: 0 } } },
      { teamA: "Flamengo",     teamB: "Vitória",       winner: "B", legs: { first: { goalsHome: 2, goalsAway: 1 }, second: { goalsHome: 2, goalsAway: 0 } } },
      { teamA: "Grêmio",       teamB: "Confiança-SE",  winner: "A", legs: { first: { goalsHome: 2, goalsAway: 0 }, second: { goalsHome: 0, goalsAway: 3 } } },
      { teamA: "Paysandu",     teamB: "Vasco",         winner: "B", legs: { first: { goalsHome: 0, goalsAway: 2 }, second: { goalsHome: 2, goalsAway: 2 } } },
      { teamA: "Fortaleza",    teamB: "CRB-AL",        winner: "A", legs: { first: { goalsHome: 2, goalsAway: 1 }, second: { goalsHome: 0, goalsAway: 0 } } },
      { teamA: "Bahia",        teamB: "Remo",          winner: "B", legs: { first: { goalsHome: 1, goalsAway: 3 }, second: { goalsHome: 2, goalsAway: 1 } } },
      { teamA: "Botafogo",     teamB: "Chapecoense",   winner: "B", legs: { first: { goalsHome: 1, goalsAway: 0 }, second: { goalsHome: 2, goalsAway: 0 } } },
      { teamA: "Bragantino",   teamB: "Mirassol",      winner: "B", legs: { first: { goalsHome: 1, goalsAway: 1 }, second: { goalsHome: 2, goalsAway: 1 } } },
      { teamA: "Barra-SC",     teamB: "Corinthians",   winner: "B", legs: { first: { goalsHome: 0, goalsAway: 1 }, second: { goalsHome: 1, goalsAway: 0 } } },
      { teamA: "Operário-PR",  teamB: "Fluminense",    winner: "B", legs: { first: { goalsHome: 0, goalsAway: 0 }, second: { goalsHome: 2, goalsAway: 1 } } },
      { teamA: "Palmeiras",    teamB: "Jacuipense-BA", winner: "A", legs: { first: { goalsHome: 3, goalsAway: 0 }, second: { goalsHome: 1, goalsAway: 4 } } },
      { teamA: "Athletic-MG",  teamB: "Internacional", winner: "B", legs: { first: { goalsHome: 1, goalsAway: 2 }, second: { goalsHome: 3, goalsAway: 2 } } },
      { teamA: "Santos",       teamB: "Coritiba",      winner: "A", legs: { first: { goalsHome: 0, goalsAway: 0 }, second: { goalsHome: 0, goalsAway: 2 } } },
      { teamA: "São Paulo",    teamB: "Juventude",     winner: "B", legs: { first: { goalsHome: 1, goalsAway: 0 }, second: { goalsHome: 3, goalsAway: 1 } } },
    ],
  },
};
