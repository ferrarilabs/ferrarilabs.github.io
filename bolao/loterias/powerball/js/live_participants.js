// Participantes AO VIVO do sorteio aberto, lidos do banco (sistema de registro).
//
// Por que existe: o `data.js` so muda por PR, e cada deposito esperava tres rodadas de
// `npm run check` para aparecer no site. Agora o site le o banco pela RPC publica
// `lottery_public_open_draws` (migracao 20261118140000) e o `data.js` vira o FALLBACK: se a
// chamada falhar, demorar ou vier com forma inesperada, a pagina mostra o que o `data.js` tem.
//
// Puro e sem DOM: `mesclar` recebe os sorteios e as linhas e devolve quais sorteios mudaram.
// O teste test_live_participants.mjs carrega este arquivo num `vm` e exercita a mescla.
(function (root) {
  "use strict";

  var ORGANIZADOR = "Fundo próprio (organizador)";
  var TZ = "America/New_York";

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : NaN;
  }

  // O mesmo formato que o data.js usa: "18/11/2026" e "8:09:32 AM" (espaco comum, nao U+202F).
  function dataHora(iso) {
    if (!iso) return { data: "—", hora: "—" };
    var d = new Date(iso);
    if (isNaN(d.getTime())) return { data: "—", hora: "—" };
    var data = new Intl.DateTimeFormat("pt-BR", {
      timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric"
    }).format(d);
    var hora = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true
    }).format(d).replace(/[  ]/g, " ");
    return { data: data, hora: hora };
  }

  // Valida UMA linha da RPC. Qualquer campo fora de forma recusa a resposta INTEIRA: mostrar
  // metade do banco e metade do data.js seria pior que mostrar so o data.js.
  // Segunda tranca, a mesma de `assertSemPII` (public_projection.mjs): o caminho por PR passa o
  // artefato por ela e por revisao humana; este nao tem revisao, entao a pagina recusa a resposta
  // se um nome ou meio tiver cara de e-mail ou telefone (ex.: digitado errado no manifesto).
  var EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  var TELEFONE = /(?:\+?\d[\d\s().-]{8,}\d)/;
  function pareceContato(v) { return typeof v === "string" && (EMAIL.test(v) || TELEFONE.test(v)); }

  function linhaValida(r) {
    return r && typeof r === "object" &&
      !pareceContato(r.name) && !pareceContato(r.metodo) &&
      typeof r.contribuiu === "boolean" &&
      typeof r.draw_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.draw_date) &&
      typeof r.name === "string" && r.name.trim() !== "" &&
      num(r.cotas) > 0 && !isNaN(num(r.valor)) &&
      (r.metodo === null || typeof r.metodo === "string") &&
      (r.paid_at === null || typeof r.paid_at === "string");
  }

  // `state` (NC, FL...) nao existe no banco: herda o ultimo informado para o nome no data.js,
  // como sync_draw_participants.mjs faz no servidor.
  function estadosConhecidos(draws) {
    var m = {};
    for (var i = 0; i < draws.length; i++) {
      var ps = draws[i].participants || [];
      for (var j = 0; j < ps.length; j++) if (ps[j] && ps[j].name && ps[j].state) m[ps[j].name] = ps[j].state;
    }
    return m;
  }

  function participante(r, estados) {
    var quando = dataHora(r.paid_at);
    var status = r.metodo === ORGANIZADOR ? "organizador" : (r.contribuiu ? "verificado" : "pendente");
    var valor = num(r.valor);
    return {
      name: r.name,
      cotas: num(r.cotas),
      valor: Number.isInteger(valor) ? valor : Number(valor.toFixed(2)),
      metodo: r.metodo,
      data: quando.data,
      hora: quando.hora,
      status: status,
      state: estados[r.name] || null
    };
  }

  // Aplica as linhas do banco nos sorteios SEM resultado que existem no data.js.
  //   - sorteio com resultado: intocado (a lista ja foi fechada e sincronizada);
  //   - sorteio com bilhetes comprados: intocado (quem pagou depois da compra nao entrou nos
  //     jogos; somar a cota mudaria "Disponivel para tickets" e o premio de todo mundo);
  //   - sorteio que o banco nao devolveu: intocado (a RPC so cobre os ultimos 7 dias);
  //   - banco com MENOS participantes que o data.js: intocado (participacao nao some do banco;
  //     se sumiu, algo esta errado e o data.js revisado e a fonte mais segura).
  // Devolve { ok, alterados: [ids], motivo }.
  function mesclar(draws, linhas) {
    if (!Array.isArray(linhas)) return { ok: false, alterados: [], motivo: "resposta nao e lista" };
    for (var i = 0; i < linhas.length; i++) {
      if (!linhaValida(linhas[i])) return { ok: false, alterados: [], motivo: "linha fora de forma" };
    }
    var estados = estadosConhecidos(draws);
    var porSorteio = {};
    for (var k = 0; k < linhas.length; k++) {
      (porSorteio[linhas[k].draw_date] = porSorteio[linhas[k].draw_date] || []).push(linhas[k]);
    }
    var alterados = [];
    for (var d = 0; d < draws.length; d++) {
      var draw = draws[d];
      var rows = porSorteio[draw.id];
      if (!rows || (draw.result && draw.result.numbers && draw.result.numbers.length)) continue;
      if (draw.sharedTickets && draw.sharedTickets.series && draw.sharedTickets.series.length) continue;
      if (rows.length < (draw.participants || []).length) continue;
      var lista = rows.map(function (r) { return participante(r, estados); });
      draw.participants = lista;
      if (draw.finance) {
        draw.finance.totalArrecadado = lista.reduce(function (s, p) { return s + p.valor; }, 0);
      }
      draw.fonteParticipantes = "banco";
      alterados.push(draw.id);
    }
    return { ok: true, alterados: alterados, motivo: null };
  }

  // Busca as linhas. Timeout curto: a pagina ja esta desenhada com o data.js, isto so atualiza.
  function buscar(cfg, fetchImpl) {
    var f = fetchImpl || root.fetch;
    if (!cfg || !cfg.enabled || !cfg.url || !cfg.anonKey || !f) return Promise.resolve(null);
    var origem = root.location && root.location.origin;
    if (Array.isArray(cfg.origins) && cfg.origins.indexOf(origem) === -1) return Promise.resolve(null);
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, cfg.timeoutMs || 6000) : null;
    return f(cfg.url.replace(/\/$/, "") + "/rest/v1/rpc/lottery_public_open_draws", {
      method: "POST",
      headers: { apikey: cfg.anonKey, Authorization: "Bearer " + cfg.anonKey, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (v) { if (timer) clearTimeout(timer); return v; });
  }

  root.POWERBALL_LIVE = { mesclar: mesclar, buscar: buscar, dataHora: dataHora, ORGANIZADOR: ORGANIZADOR };
})(typeof window !== "undefined" ? window : globalThis);
