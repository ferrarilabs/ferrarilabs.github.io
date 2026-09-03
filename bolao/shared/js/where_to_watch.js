/**
 * where_to_watch.js — "📺 Onde assistir", enriquecimento OPCIONAL de apresentação.
 *
 * ─── O QUE ESTE MÓDULO NÃO FAZ ──────────────────────────────────────────────────────────────
 *
 * Ele NUNCA decide qual é a próxima partida, nunca toca no countdown, no calendário, no fuso, no
 * placar, no estado ao vivo ou no scoring. O fluxo é de mão única:
 *
 *     partida já decidida pelo app  →  UI existente  →  countdown existente  →  (opcional) esta linha
 *
 * Nunca o contrário. Apagar este arquivo e as chamadas a `lineHtml()` devolve os dois apps
 * exatamente ao comportamento anterior, sem nenhum outro efeito.
 *
 * ─── FAIL SAFE ──────────────────────────────────────────────────────────────────────────────
 *
 * `lineHtml()` devolve string vazia — nunca lança — quando não há transmissão confirmada, quando
 * o descritor vem incompleto ou quando qualquer coisa dá errado. Ausência de dado de TV tem de
 * ser indistinguível do site de antes: o jogo aparece, o countdown corre, o layout não muda.
 *
 * ─── SEM REDE ───────────────────────────────────────────────────────────────────────────────
 *
 * Os dados são estáticos e vivem aqui mesmo, o que torna a consulta SÍNCRONA. Isso é a razão de
 * não existir `fetch`, `MutationObserver` nem re-render: as funções de render existentes chamam
 * `lineHtml()` dentro do próprio template, na mesma passada em que já montam o card. Um arquivo
 * JSON separado exigiria carregamento assíncrono e, com ele, alguém para reinserir a linha depois
 * — que é exatamente onde nascem observadores duplicados e linhas repetidas.
 *
 * ─── POR QUE CURADORIA, E NÃO O PROVEDOR (medido em 2026-09-03) ─────────────────────────────
 *
 * A pergunta certa antes de curar dado à mão é se o provedor já não o entrega. A ESPN TEM o campo
 * — `competitions[0].broadcasts`, `geoBroadcasts` e `broadcast` existem no schema — mas para as
 * competições deste bolão ele vem VAZIO. Medido nos payloads crus, nos dois endpoints:
 *
 *     bra.copa_do_brazil 401909114 (Grêmio × Internacional)  broadcasts: []  geoBroadcasts: []  broadcast: ""
 *     bra.copa_do_brazil 401909110 / 401909111               broadcasts: []  geoBroadcasts: []  broadcast: ""
 *     bra.1              401913077 (Flamengo × Mirassol)     broadcasts: []  geoBroadcasts: []  broadcast: ""
 *     .../summary?event=401909114                            broadcasts: []  header...broadcasts: []
 *
 * E onde a ESPN PREENCHE, o valor é do mercado errado — é a grade dela, não a brasileira:
 *
 *     usa.1 761770   broadcasts: [{"market":"national","names":["Apple TV"]}]  geo: region "us", lang "en"
 *     eng.1 401879288 broadcasts: [{"market":"national","names":["USA Net"]}]  geo: region "us", lang "en"
 *
 * Ou seja: consumir esse campo hoje não daria cobertura nenhuma nos jogos que importam e, no dia
 * em que desse, escreveria "USA Net" para um participante que assiste no Brasil — pior que a
 * ausência. Por isso a prioridade "dado do provedor primeiro" resolve, com a medição na mão, em
 * CURADORIA. Não há pipeline de broadcast: um estágio que só produz `[]` é peso morto.
 *
 * PARA REVISITAR (a decisão é reversível e tem um ponto de entrada só): se a ESPN passar a
 * publicar `geoBroadcasts` com `region: "br"`, normalize esse campo em
 * `bolao/shared/scripts/espn_provider.py` junto com `venue`/`city`, carregue-o no descritor de
 * partida como os apps já fazem com o local, e faça `findBroadcast()` cair nele quando não houver
 * registro curado — nesta ordem: curadoria vence, provedor confiável entra em seguida, senão
 * nada. Só aceite entrada com região brasileira; qualquer outra é o mercado errado.
 *
 * ─── CONTRATO OPERACIONAL: BROADCAST_SOURCE_MODEL = CURATED_ONLY ────────────────────────────
 *
 * Isto NÃO é automático, e não deve ser descrito como se fosse:
 *
 *   - uma pessoa acrescenta um registro POR PARTIDA, com evidência específica daquela partida;
 *   - sem registro, não existe linha — nunca se adivinha, nunca se infere do contrato da
 *     competição, nunca se reaproveita o canal do outro jogo do mesmo confronto;
 *   - jogos futuros de BR2026/CDB2026 exigem manutenção: cada rodada nova entra à mão;
 *   - a ausência é o comportamento correto e seguro, não uma falha — o card fica idêntico ao de
 *     antes e nada mais na página muda.
 *
 * ─── CURADORIA ─────────────────────────────────────────────────────────────────────────────
 *
 * Transmissão só entra aqui com confirmação real, e o registro guarda `source`. Direito geral de
 * competição NÃO é confirmação: Flamengo × Mirassol (Brasileirão) é Premiere exclusivo, enquanto
 * jogos da Copa do Brasil na mesma semana abrem em Globo/sportv/Premiere/Prime Video. Na dúvida
 * ou com fontes divergentes, não publique — a linha some sozinha.
 *
 * TV aberta varia por praça. Quando a fonte diz que a Globo transmite só para alguns estados, o
 * texto diz "consulte sua região" em vez de fingir cobertura nacional.
 *
 * Ao editar a lista, lembre do `?v=`: este arquivo está registrado em `APP_SHARED_FILES` (br2026
 * e cdb2026) de `bolao/scripts/cachebust.mjs`, então o bot re-tagueia sozinho nos dois. Não
 * remova esse registro (é o achado F18: módulo compartilhado sem `?v=` fica preso no cache do
 * navegador) e não o mova para `SHARED_FILES` — copa2026 não carrega este arquivo, e forçar essa
 * lista a exigi-lo em TODO app foi exatamente o incidente 2026-09-03 (run 33786641021).
 */
(function (root) {
  "use strict";

  /**
   * Transmissões CONFIRMADAS. `espnId` é a chave forte, e desde 2026-09-03 os DOIS apps a usam: o
   * BR2026 sempre carregou o id do evento ESPN, e o CDB2026 passou a resolvê-lo a partir da
   * observação que já tem em memória (`withProviderSchedule()`, o mesmo caminho que preenche o
   * local). `kickoffUtc` + os dois times continua sendo o fallback para quando não há observação —
   * a associação nunca depende de uma coisa só.
   */
  var BROADCASTS = [
    {
      // Volta das quartas da Copa do Brasil 2026 (Gre-Nal). Ida 0-0 no Beira-Rio em 27/08; quem
      // vencer vai à semifinal, novo empate leva a decisão para os pênaltis.
      espnId: "401909114",
      kickoffUtc: "2026-09-03T23:00Z",
      home: "Grêmio", away: "Internacional",
      channels: ["Amazon Prime Video"],
      confirmedAt: "2026-09-03",
      // Três fontes independentes, todas específicas DESTA partida (nunca inferido do contrato de
      // competição): CNN Brasil — "O duelo terá transmissão do Prime Video"; Metrópoles — "A
      // partida terá transmissão exclusiva da Amazon Prime (streaming)"; Máquina do Esporte.
      // As três dizem exclusiva em streaming: sem TV aberta (Globo) e sem TV fechada
      // (sportv/Premiere) — por isso o registro tem um canal só, e não a lista de quatro que os
      // jogos de 02/09 tinham.
      source: "cnnbrasil.com.br/esportes/futebol/copa-do-brasil/gremio-x-internacional-horario-e-onde-assistir-a-copa-do-brasil/ + metropoles.com/esportes/saiba-onde-assistir-a-gremio-x-internacional-pela-copa-do-brasil + maquinadoesporte.com.br",
    },
    {
      espnId: "401913077",
      kickoffUtc: "2026-09-02T22:30Z",
      home: "Flamengo", away: "Mirassol",
      channels: ["Premiere"],
      confirmedAt: "2026-09-02",
      source: "infomoney.com.br/esportes/flamengo-mirassol-onde-assistir-brasileirao/ + maquinadoesporte.com.br",
    },
    {
      espnId: "401909110",
      kickoffUtc: "2026-09-03T00:30Z",
      home: "Santos", away: "Palmeiras",
      channels: ["Globo (TV aberta — consulte sua região)", "sportv", "Premiere", "Amazon Prime Video"],
      confirmedAt: "2026-09-02",
      source: "infomoney.com.br/esportes/santos-palmeiras-onde-assistir-copa-do-brasil/ + athlonsports.com",
    },
    {
      espnId: "401909111",
      kickoffUtc: "2026-09-03T00:30Z",
      home: "Vitória", away: "Vasco",
      channels: ["Globo (TV aberta — consulte sua região)", "sportv", "Premiere", "Amazon Prime Video"],
      confirmedAt: "2026-09-02",
      source: "maquinadoesporte.com.br + cnnbrasil.com.br + vavel.com (Globo regional: RJ, BA, ES, SE, RN, PB, MA, Santarém-PA, Juiz de Fora-MG)",
    },
  ];

  // Escape próprio: este módulo não pode depender do `esc()` de nenhum dos apps.
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // "Vasco da Gama" e "Vasco" precisam casar: os dois apps normalizam nomes de time de formas
  // diferentes, e um nome é a única coisa que o CDB2026 tem para oferecer.
  function norm(s) {
    return String(s == null ? "" : s)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function sameTeam(a, b) {
    var x = norm(a), y = norm(b);
    if (!x || !y) return false;
    if (x === y) return true;
    // Prefixo só com 4+ caracteres — abaixo disso "sao" casaria com qualquer coisa.
    return (x.length >= 4 && y.indexOf(x) === 0) || (y.length >= 4 && x.indexOf(y) === 0);
  }

  // Minuto UTC, imune a "Z" vs "+00:00" vs offset local. Vazio quando a data é ilegível.
  function utcMinute(iso) {
    var t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    return new Date(t).toISOString().slice(0, 16);
  }

  /**
   * @param {{id?:string|number, kickoff?:string, home?:string, away?:string}} match
   * @returns {object|null} registro de transmissão, ou null quando não há confirmação
   */
  function findBroadcast(match) {
    if (!match) return null;
    var id = match.id != null ? String(match.id) : "";
    var minute = utcMinute(match.kickoff);
    for (var i = 0; i < BROADCASTS.length; i++) {
      var b = BROADCASTS[i];
      if (id && b.espnId === id) return b;
      // Sem id: exige o MESMO minuto de início e os dois times. Dois confrontos distintos no
      // mesmo minuto com nomes confundíveis não existem na prática.
      if (!id && minute && utcMinute(b.kickoffUtc) === minute &&
          sameTeam(b.home, match.home) && sameTeam(b.away, match.away)) return b;
    }
    return null;
  }

  /** HTML da linha, ou "" quando não há transmissão confirmada. Nunca lança. */
  function lineHtml(match) {
    try {
      var b = findBroadcast(match);
      if (!b || !b.channels || !b.channels.length) return "";
      var canais = b.channels.map(esc).join(" · ");
      return '<div class="where-to-watch">📺 Onde assistir: <span class="where-to-watch__channels">' +
        canais + "</span></div>";
    } catch (_) {
      return "";
    }
  }

  root.BOLAO_WHERE_TO_WATCH = {
    findBroadcast: findBroadcast,
    lineHtml: lineHtml,
    BROADCASTS: BROADCASTS,
  };
})(typeof window !== "undefined" ? window : globalThis);
