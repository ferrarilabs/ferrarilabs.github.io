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
 * o descritor vem incompleto, quando os dados ainda não chegaram do arquivo, ou quando qualquer
 * coisa dá errado. Ausência de dado de TV tem de ser indistinguível do site de antes: o jogo
 * aparece, o countdown corre, o layout não muda.
 *
 * ─── CARREGAMENTO: UM FETCH, SEM RE-RENDER PRÓPRIO (Issue #425) ────────────────────────────
 *
 * Os dados agora vivem em `bolao/shared/data/broadcasts.json` (não mais um array embutido aqui),
 * para que a ferramenta operacional de detecção de lacunas (`check_broadcast_coverage.mjs`) e o
 * validador (`validate_broadcasts.mjs`) leiam exatamente o mesmo arquivo que o navegador — uma
 * fonte só, nunca duas cópias divergentes.
 *
 * Isso é buscado UMA VEZ, de forma assíncrona, com `{cache: "no-cache"}` — o MESMO padrão já
 * usado por `data/espn-normalized.json` em `br2026/js/app.js` (nunca passa pelo `?v=` do
 * cachebust; a rede sempre confere com o servidor). Antes do fetch resolver, `lineHtml()` devolve
 * "" (fail-safe, nunca "carregando..."). Isto NÃO precisa de `MutationObserver` nem de um
 * re-render dedicado: os dois apps já re-renderizam os cards que chamam `lineHtml()` no próprio
 * ciclo de poll ao vivo/countdown que já existe — quando o fetch resolve, a PRÓXIMA passada
 * (segundos depois, no pior caso) já enxerga os dados. Nenhuma lógica de countdown ou de seleção
 * de partida foi tocada para isto funcionar.
 *
 * ─── POR QUE CURADORIA, E NÃO O PROVEDOR (medido em 2026-09-03, reconfirmado em 2026-09-07) ──
 *
 * A pergunta certa antes de curar dado à mão é se o provedor já não o entrega. A ESPN TEM o campo
 * — `competitions[0].broadcasts`, `geoBroadcasts` e `broadcast` existem no schema — mas para as
 * competições deste bolão ele vem VAZIO. Medido nos payloads crus, em múltiplos endpoints e
 * variações de `lang`/`region`:
 *
 *     bra.copa_do_brazil 401909114 (Grêmio × Internacional)  broadcasts: []  geoBroadcasts: []
 *     bra.1              401913077 (Flamengo × Mirassol)     broadcasts: []  geoBroadcasts: []
 *     bra.1 (lang=pt&region=br, 5 eventos, 2026-09-07)       broadcasts: []  geoBroadcasts: []
 *     .../summary?event=401913077                            broadcasts: []  header...broadcasts: []
 *
 * E onde a ESPN PREENCHE, o valor é do mercado errado — é a grade dela, não a brasileira:
 *
 *     usa.1 761770   broadcasts: [{"market":"national","names":["Apple TV"]}]  geo: region "us"
 *     eng.1 401879288 broadcasts: [{"market":"national","names":["USA Net"]}]  geo: region "us"
 *
 * Outras fontes avaliadas na Issue #425 (API-Football, API oficial da CBF, scraping de emissora,
 * APIs não-oficiais tipo SofaScore) foram descartadas por falta de evidência de cobertura,
 * indisponibilidade de API pública, ou risco legal/de manutenção incompatível com "informação
 * errada é pior que ausência". A fonte que a #425 NÃO avaliou — a grade de TV brasileira (EPG
 * XMLTV) — é a que a Issue #431 adotou: ver "CONTRATO OPERACIONAL" abaixo.
 *
 * PARA REVISITAR (a decisão é reversível e tem um ponto de entrada só): se a ESPN passar a
 * publicar `geoBroadcasts` com `region: "br"`, normalize esse campo em
 * `bolao/shared/scripts/espn_provider.py` junto com `venue`/`city`, carregue-o no descritor de
 * partida como os apps já fazem com o local, e faça `findBroadcast()` cair nele quando não houver
 * registro curado — nesta ordem: curadoria vence, provedor confiável entra em seguida, senão
 * nada. Só aceite entrada com região brasileira; qualquer outra é o mercado errado. Nenhuma
 * mudança de UI é necessária para isso: `lineHtml()` já é o único ponto de saída.
 *
 * ─── CONTRATO OPERACIONAL: BROADCAST_SOURCE_MODEL = EPG_CORROBORATED_WITH_CURATED_OVERRIDE ──
 *
 * (Issue #431; substitui CURATED_ONLY da #425.) `broadcasts.json` tem dois tipos de registro, e
 * este módulo NÃO distingue os dois — ele só exibe `channels`, igual a antes:
 *
 *   - HUMANO (sem `origin`): uma pessoa cadastra com evidência específica da partida. Sempre vence
 *     e nunca é tocado pelo pipeline. É o único caminho para streaming sem grade (Prime Video).
 *   - AUTOMÁTICO (`origin: "epg"`): gerado FORA do navegador por
 *     `bolao/shared/scripts/sync_epg_broadcasts.mjs` (workflow agendado), a partir da grade
 *     EPGShare BR1/BR2, só quando um programa cita os DOIS clubes e está no horário do kickoff.
 *     Guarda a proveniência (fonte, título do programa, horário da grade, coleta).
 *   - sem registro, não existe linha — nunca se adivinha, nunca se infere do contrato da
 *     competição, nunca se reaproveita o canal do outro jogo ou do outro turno do mesmo confronto;
 *   - a ausência é o comportamento correto e seguro, não uma falha — o card fica idêntico ao de
 *     antes e nada mais na página muda.
 *
 * Nada de XMLTV passa por aqui: o navegador continua buscando só o JSON pequeno. Regras de
 * evidência e last-known-good: `bolao/shared/scripts/epg_broadcasts.mjs`.
 *
 * O que também é automático (Issue #425): a COMPLETUDE da cobertura. `check_broadcast_coverage.mjs`
 * roda em CI e lista, por rodada, quais partidas do BR2026 ainda não têm registro — ninguém
 * precisa lembrar de conferir a tabela à mão. `validate_broadcasts.mjs` reprova o arquivo se um
 * registro vier com identidade ambígua, canal vazio, duplicata/conflito de partida, ou dado velho
 * demais sem reconfirmação. Ver `docs/bolao/BROADCAST_OPERATIONS.md`.
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
 * ─── CACHE-BUST ─────────────────────────────────────────────────────────────────────────────
 *
 * Este ARQUIVO (`where_to_watch.js`, código) está registrado em `APP_SHARED_FILES` (br2026 e
 * cdb2026) de `bolao/scripts/cachebust.mjs` — o bot re-tagueia sozinho nos dois. Não remova esse
 * registro (achado F18) e não o mova para `SHARED_FILES` (copa2026 não carrega este módulo — foi
 * o incidente 2026-09-03, run 33786641021).
 *
 * `broadcasts.json` (DADO, não código) deliberadamente NÃO entra no cachebust: é buscado via
 * `fetch(..., {cache: "no-cache"})`, o mesmo mecanismo que já mantém `espn-normalized.json`
 * sempre fresco sem precisar de `?v=` — ver br2026/js/app.js. Um arquivo JSON com `?v=` exigiria
 * o navegador re-executar o cachebust a cada edição de dado (não de código), o que essa família
 * de arquivo nunca precisou.
 */
(function (root) {
  "use strict";

  var DATA_URL_FROM_APP_ROOT = "../shared/data/broadcasts.json";

  /** Transmissões CONFIRMADAS, carregadas de forma assíncrona. Vazio até o fetch resolver —
   * fail-safe: nenhuma linha aparece antes disso, nunca um placeholder. */
  var BROADCASTS = [];
  var _loadStarted = false;
  var _loadPromise = null;

  function _startLoad() {
    if (_loadStarted) return _loadPromise;
    _loadStarted = true;
    try {
      _loadPromise = fetch(DATA_URL_FROM_APP_ROOT, { cache: "no-cache" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (parsed) {
          if (parsed && Array.isArray(parsed.entries)) {
            // Muta em vez de reatribuir: `root.BOLAO_WHERE_TO_WATCH.BROADCASTS` guarda a
            // referência original do array, capturada na hora em que o módulo foi montado.
            // Reatribuir a variável local aqui deixaria essa propriedade exportada presa no
            // array vazio inicial para sempre — `findBroadcast()` continuaria correto (lê a
            // variável de closure), mas qualquer teste/consumidor que leia a propriedade
            // exportada diretamente veria sempre [].
            BROADCASTS.splice.apply(BROADCASTS, [0, BROADCASTS.length].concat(parsed.entries));
          }
        })
        .catch(function () { /* fail-safe: BROADCASTS fica [] — nunca lança */ });
    } catch (_) {
      _loadPromise = Promise.resolve();
    }
    return _loadPromise;
  }

  // Dispara o fetch assim que o script é avaliado — não espera nenhum evento do app. Os
  // consumidores (lineHtml/findBroadcast) continuam SÍNCRONOS; eles só enxergam o resultado a
  // partir da PRÓXIMA chamada depois que o fetch resolver (ver comentário de carregamento acima).
  if (typeof fetch === "function") {
    _startLoad();
  }

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
    // Exposto só para os testes de navegador (Playwright) poderem aguardar o fetch antes de
    // afirmar sobre `lineHtml()` — nunca usado pelos apps em produção.
    _ready: function () { return _loadPromise || Promise.resolve(); },
  };
})(typeof window !== "undefined" ? window : globalThis);
