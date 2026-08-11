(function () {
  "use strict";
  var DRAWS = window.POWERBALL_DRAWS;
  var GAME_TYPES = window.LOTTERY_GAME_TYPES;
  var LOCAL_KEY = "powerball_local_results_v1";
  var currentIdx = DRAWS.length - 1;
  var countdownTimer = null;

  // Escape de HTML. Não existia neste arquivo; necessário porque buildDrawCombo() monta as opções
  // via innerHTML. Os labels vêm de data.js (conteúdo nosso), mas escapar é a regra da casa —
  // ver docs/bolao/SECURITY.md "XSS prevention" — e não depende de a origem ser confiável hoje.
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // BATCH 5 (2026-08-07): formato USD canônico `US$ X.XX`, decidido pelo Eduardo. Antes daqui era
  // `"US$" + toLocaleString` — sem casas decimais e sem espaço (`US$5`), enquanto o EMAIL deste mesmo
  // bolão mandava `$5.00`. Mesmo valor, dois formatos, dependendo de onde o participante olhasse.
  // A regra agora vive em bolao/shared/js/money.js (uma implementação por runtime, mantidas em
  // sincronia por test_money_interop.mjs).
  function fmtUsd(n) {
    return window.BOLAO_MONEY.usd(n);
  }

  // Valores grandes (prêmios) em formato compacto: K/M/B, arredondado a 1 casa
  // decimal (sem casas quando o resultado é inteiro). Valores pequenos (< $1.000,
  // ex.: contribuição de cada participante) ficam por extenso, sem abreviar.
  function fmtUsdCompact(n) {
    return window.BOLAO_MONEY.usdCompact(n);
  }

  // JACKPOT AINDA NAO ANUNCIADO (2026-08-11).
  //
  // Um sorteio recem-aberto existe ANTES de a loteria anunciar o premio: o bolao abre, as
  // pessoas entram, os bilhetes vem depois. O jackpot e dado publicado por terceiro -- inventar
  // um numero aqui seria afirmar valor de dinheiro que ninguem divulgou.
  //
  // Sem isto, `fmtUsdCompact(null)` e `null * 0.505` renderizavam "$NaN" na tela inicial.
  var JACKPOT_A_ANUNCIAR = "a anunciar";
  function temJackpot(draw) {
    return typeof draw.drawing.jackpot === "number" && isFinite(draw.drawing.jackpot);
  }
  function fmtJackpot(draw) {
    return temJackpot(draw) ? fmtUsdCompact(draw.drawing.jackpot) : JACKPOT_A_ANUNCIAR;
  }

  function loadLocalOverrides() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveLocalOverride(drawId, data) {
    var all = loadLocalOverrides();
    all[drawId] = data;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
  }

  function getEffectiveDraw(draw) {
    var overrides = loadLocalOverrides()[draw.id];
    if (!overrides) return draw;
    var merged = JSON.parse(JSON.stringify(draw));
    if (overrides.result) merged.result = overrides.result;
    if (overrides.profit) merged.profit = overrides.profit;
    return merged;
  }

  // Dropdown label per draw: planning draws (no result yet, status
  // "planejamento") get "Próximo sorteio — <data> — Em planejamento";
  // completed draws get "<data> — Resultado: N N N N N | PB N". Each draw's
  // own `id` is the option's value, so there is never a duplicate/ambiguous
  // selection even if two draws share a display date format.
  // Rótulo COMPACTO do seletor — restaurado ao desenho original (2026-08-09).
  //
  // Era assim antes do dropdown customizado: `icone + label + " — " + data`. Depois o rótulo
  // passou a embutir o resultado inteiro ("— Resultado: 5 9 35 54 63 | PB 7"), o que transformou
  // cada opção num cartão de resultado de várias linhas. O Eduardo pediu o compacto de volta: o
  // seletor serve para ESCOLHER o sorteio, não para exibi-lo — o resultado já tem seção própria
  // logo abaixo.
  //
  // Sem marcador de seleção no texto: o antigo `"✓ "` indicava "tem resultado", não seleção, e
  // confundia com a marca de escolha. Seleção agora é só estilo (fundo + peso + aria-selected).
  function drawSelectorLabel(d, effectiveDraw) {
    var gt = GAME_TYPES[d.gameType] || GAME_TYPES.powerball;
    // Só a DATA: o horário é o mesmo (22:59 ET) em todo sorteio do Powerball, então repetir isso
    // em cada linha ocupa espaço sem distinguir nada.
    var date = String(d.drawing.drawDateLabel || "").split(" ")[0];
    var label = gt.icon + " " + gt.label + " — " + date;
    // Distinção sutil e única: qual ainda não foi sorteado. Sem isso não dá para saber, olhando a
    // lista, qual é o próximo — e essa é a informação operacional que importa aqui.
    var hasResult = effectiveDraw.result && effectiveDraw.result.numbers;
    return hasResult ? label : label + " · próximo";
  }

  // ─── BATCH 6: dropdown customizado de sorteio ───────────────────────────────
  // Pedido do Eduardo (repetido 3x, nunca implementado até 2026-08-07). O <select> nativo foi
  // REMOVIDO do index.html, não escondido: manter o nativo por baixo criaria duas fontes de
  // verdade para a seleção, que é justamente o modo de falha vetado no pedido.
  //
  // Fonte de verdade única: `currentIdx`. O componente nunca guarda seleção própria — ele
  // desenha `currentIdx` e chama `renderDraw(idx)`, exatamente como o listener de `change` fazia.
  //
  // Padrão ARIA combobox + listbox: o botão é `role="combobox"` com `aria-expanded` e
  // `aria-controls`; a lista é `role="listbox"` com `role="option"` e `aria-selected`. Enquanto
  // aberto, o foco PERMANECE no botão e a opção corrente é apontada por `aria-activedescendant`
  // (padrão APG) — é o que faz leitor de tela anunciar a navegação sem mover foco de verdade.
  var comboOpen = false;
  var comboActiveIdx = 0;
  var docClickWired = false;

  function comboEls() {
    return {
      root: document.getElementById("pbDrawCombo"),
      button: document.getElementById("pbDrawButton"),
      label: document.getElementById("pbDrawLabel"),
      listbox: document.getElementById("pbDrawListbox")
    };
  }

  function buildDrawCombo() {
    var root = document.getElementById("pbDrawCombo");
    if (!root) return;
    var options = DRAWS.map(function (d, i) {
      var label = drawSelectorLabel(d, getEffectiveDraw(d));
      return '<li role="option" id="pbDrawOpt-' + i + '" class="pb-select__option" data-idx="' + i + '"' +
        ' aria-selected="' + (i === currentIdx ? "true" : "false") + '">' + esc(label) + "</li>";
    }).join("");
    root.innerHTML =
      '<button type="button" class="pb-select__button" id="pbDrawButton" role="combobox"' +
      ' aria-haspopup="listbox" aria-expanded="false" aria-controls="pbDrawListbox"' +
      ' aria-label="Escolher sorteio">' +
        '<span class="pb-select__value" id="pbDrawLabel"></span>' +
        '<span class="pb-select__chevron" aria-hidden="true"></span>' +
      "</button>" +
      '<ul class="pb-select__listbox" id="pbDrawListbox" role="listbox" aria-label="Sorteios" hidden>' +
        options +
      "</ul>";
    syncDrawCombo();
    wireDrawCombo();
  }

  // Reconstrói apenas os RÓTULOS (texto) das opções + do botão, sem recriar nós: usado depois de
  // um render, quando um resultado novo pode ter mudado o texto de uma opção.
  function syncDrawComboLabels() {
    var e = comboEls();
    if (!e.listbox) return;
    var opts = e.listbox.querySelectorAll('[role="option"]');
    for (var i = 0; i < opts.length; i++) {
      var idx = Number(opts[i].getAttribute("data-idx"));
      var d = DRAWS[idx];
      if (d) opts[i].textContent = drawSelectorLabel(d, getEffectiveDraw(d));
    }
    syncDrawCombo();
  }

  // Reflete `currentIdx` na UI. Chamado no build e sempre que o sorteio muda.
  function syncDrawCombo() {
    var e = comboEls();
    if (!e.root || !e.label) return;
    var d = DRAWS[currentIdx];
    if (d) e.label.textContent = drawSelectorLabel(d, getEffectiveDraw(d));
    var opts = e.listbox ? e.listbox.querySelectorAll('[role="option"]') : [];
    for (var i = 0; i < opts.length; i++) {
      var selected = Number(opts[i].getAttribute("data-idx")) === currentIdx;
      opts[i].setAttribute("aria-selected", selected ? "true" : "false");
      opts[i].classList.toggle("is-selected", selected);
    }
  }

  function setComboActive(idx) {
    var e = comboEls();
    if (!e.listbox) return;
    var opts = e.listbox.querySelectorAll('[role="option"]');
    if (!opts.length) return;
    comboActiveIdx = Math.max(0, Math.min(idx, opts.length - 1));
    for (var i = 0; i < opts.length; i++) opts[i].classList.toggle("is-active", i === comboActiveIdx);
    var active = opts[comboActiveIdx];
    // O foco NÃO se move para a opção — o botão continua focado e aponta a opção ativa.
    if (e.button) e.button.setAttribute("aria-activedescendant", active.id);
    if (active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  }

  function openCombo() {
    var e = comboEls();
    if (!e.listbox || comboOpen) return;
    comboOpen = true;
    e.listbox.hidden = false;
    e.root.classList.add("is-open");
    e.button.setAttribute("aria-expanded", "true");
    setComboActive(currentIdx); // abre já sobre a opção selecionada
  }

  function closeCombo(refocus) {
    var e = comboEls();
    if (!e.listbox) return;
    comboOpen = false;
    e.listbox.hidden = true;
    e.root.classList.remove("is-open");
    e.button.setAttribute("aria-expanded", "false");
    e.button.removeAttribute("aria-activedescendant");
    if (refocus && e.button) e.button.focus();
  }

  // Seleciona e fecha. Único caminho de mudança de sorteio — mesma chamada que o `change` fazia.
  function chooseDraw(idx) {
    closeCombo(false);                                  // fecha sem focar ainda
    if (idx !== currentIdx) renderDraw(idx); else syncDrawCombo();
    var btn = document.getElementById("pbDrawButton");  // foco DEPOIS do render
    if (btn) btn.focus();
  }

  function wireDrawCombo() {
    var e = comboEls();
    if (!e.button || !e.listbox) return;

    e.button.addEventListener("click", function () {
      if (comboOpen) closeCombo(true); else openCombo();
    });

    // Clique numa opção (também cobre toque no mobile).
    e.listbox.addEventListener("click", function (ev) {
      var li = ev.target.closest ? ev.target.closest('[role="option"]') : null;
      if (li) chooseDraw(Number(li.getAttribute("data-idx")));
    });
    // Hover não seleciona — só move a opção ativa, como um <select> nativo.
    e.listbox.addEventListener("mousemove", function (ev) {
      var li = ev.target.closest ? ev.target.closest('[role="option"]') : null;
      if (li) setComboActive(Number(li.getAttribute("data-idx")));
    });

    e.button.addEventListener("keydown", function (ev) {
      var k = ev.key;
      if (!comboOpen) {
        // Fechado: setas/Enter/Espaço/Home/End abrem. Alt+Down também (convenção de combobox).
        if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " " || k === "Home" || k === "End") {
          ev.preventDefault(); openCombo();
          if (k === "Home") setComboActive(0);
          else if (k === "End") setComboActive(DRAWS.length - 1);
          return;
        }
        return;
      }
      // Aberto:
      if (k === "ArrowDown")      { ev.preventDefault(); setComboActive(comboActiveIdx + 1); }
      else if (k === "ArrowUp")   { ev.preventDefault(); setComboActive(comboActiveIdx - 1); }
      else if (k === "Home")      { ev.preventDefault(); setComboActive(0); }
      else if (k === "End")       { ev.preventDefault(); setComboActive(DRAWS.length - 1); }
      else if (k === "Enter" || k === " ") { ev.preventDefault(); chooseDraw(comboActiveIdx); }
      else if (k === "Escape")    { ev.preventDefault(); closeCombo(true); }   // fecha SEM mudar
      else if (k === "Tab")       { closeCombo(false); }                        // deixa o Tab seguir
    });

    // Clique fora fecha. Registrado UMA vez (guarda abaixo) — buildDrawCombo() pode, em teoria,
    // ser chamado de novo no futuro, e um listener de `document` por chamada seria vazamento.
    if (docClickWired) return;
    docClickWired = true;
    document.addEventListener("click", function (ev) {
      if (!comboOpen) return;
      var root = document.getElementById("pbDrawCombo");
      if (root && !root.contains(ev.target)) closeCombo(false);
    });
  }

  // Mantido com o nome antigo: é o que o bootstrap já chamava.
  function renderDrawSelector() {
    buildDrawCombo();
  }

  function applyTheme(gameType) {
    var gt = GAME_TYPES[gameType] || GAME_TYPES.powerball;
    document.documentElement.style.setProperty("--lot-accent", gt.accent);
    document.documentElement.style.setProperty("--lot-accent2", gt.accent2);
    document.getElementById("pbLogo").textContent = gt.icon;
    document.getElementById("pbPreviousResultsLink").href = gt.previousResultsUrl;
    // Padrão dos outros três bolões: "Bolão do Ferrari — <competição>". Antes daqui esta linha
    // era "Bolão " + gt.label + " — Ferrari", que sobrescrevia EM RUNTIME o <title> corrigido no
    // index.html -- a correção estática sozinha não aparecia no navegador.
    document.title = "Bolão do Ferrari — " + gt.label;
    return gt;
  }

  function renderSummary(draw) {
    var totalCotas = draw.participants.reduce(function (s, p) { return s + p.cotas; }, 0);
    var el = document.getElementById("pbSummary");
    var rows = [
      [fmtUsd(draw.finance.totalArrecadado), "Total arrecadado"],
      // Prose, não valor calculado: segue o padrão do i18n dos outros apps ("US$ N", sem centavos).
      // Antes era "US$10" sem espaço — inconsistente com "US$ 5 por entrada" dos três bolões.
      [totalCotas, "Cotas (US$ 10 cada)"],
      [draw.participants.length, "Participantes"]
    ];
    if (draw.finance.creditoSorteioAnterior) {
      rows.push([fmtUsd(draw.finance.creditoSorteioAnterior), "Crédito do sorteio anterior"]);
      // 2026-08-09, pedido do Eduardo: "tem que considerar os $24 que ganhamos do sorteio
      // anterior para jogar no próximo". O crédito já estava GRAVADO e exibido, mas só como
      // linha solta — nada dizia que ele podia ser gasto em ticket, e "Total arrecadado $0"
      // ao lado dava a impressão de que não havia com que comprar nada.
      //
      // Esta linha é DERIVADA na hora de exibir; não altera nenhum valor guardado. Os montantes
      // canônicos (arrecadado, crédito, utilizado) continuam sendo os únicos que existem no
      // data.js — o que muda é a soma ficar visível em vez de ter que ser feita de cabeça.
      var disponivel = draw.finance.totalArrecadado +
                       draw.finance.creditoSorteioAnterior -
                       draw.finance.valorUtilizado;
      rows.push([fmtUsd(disponivel), "Disponível para tickets"]);
    }
    rows.push(
      [fmtUsd(draw.finance.valorUtilizado), "Valor utilizado (tickets)"],
      [fmtUsd(draw.finance.valorGuardadoProximoSorteio), "Guardado p/ próximo sorteio"],
      [fmtJackpot(draw), "Jackpot"]
    );
    el.innerHTML = rows.map(function (row) {
      return '<div class="pb-summary-item"><div class="v">' + row[0] + '</div><div class="l">' + row[1] + "</div></div>";
    }).join("");
  }

  // "31/07/2026" + "4:52:51 PM" -> timestamp, para ordenar a tabela por entrada
  // (quem pagou primeiro aparece no topo). Hora "—" (não registrada) usa 23:59:59,
  // não 00:00:00 — meia-noite faria alguém sem hora registrada parecer o PRIMEIRO
  // do dia, na frente de quem tem hora real e pagou de manhã, o que é o oposto do
  // que sabemos (a hora só não foi registrada, o pagamento não foi à meia-noite).
  // Fim do dia é a suposição mais segura: só ultrapassa quem pagou depois nesse
  // mesmo dia, nunca quem pagou antes com hora conhecida.
  function parseEntryTimestamp(p) {
    var dm = p.data.split("/"); // DD/MM/YYYY
    var iso = dm[2] + "-" + dm[1] + "-" + dm[0];
    var hora = p.hora === "—" ? "23:59:59" : p.hora;
    var t = new Date(iso + " " + hora).getTime();
    return isNaN(t) ? 0 : t;
  }

  // Imposto estadual sobre prêmios de loteria, por estado (taxa fixa sobre o valor
  // bruto). null = estado não cadastrado ainda (ver PARTICIPANT_FRAMEWORK.md).
  // Fontes: NC Dept. of Revenue (3,99% flat); FL não tributa renda pessoa física.
  var STATE_TAX_RATES = {
    FL: 0,      // Florida — sem imposto de renda estadual
    NC: 0.0399  // North Carolina — 3,99% flat sobre a renda (inclui prêmios de loteria)
  };
  var FEDERAL_TAX_RATE = 0.37; // Faixa federal mais alta, aplicável a prêmios deste porte

  // Duas opções de recebimento, INDEPENDENTES entre si — o ganhador escolhe UMA delas,
  // nunca as duas:
  //   1) LUMP SUM (à vista): recebe o Cash Value de uma vez, com imposto retido sobre
  //      esse valor à vista.
  //   2) ANUIDADE (parcelado): recebe o valor CHEIO do jackpot (não o Cash Value) em
  //      30 parcelas anuais crescentes ao longo de 29 anos, com imposto retido sobre
  //      cada parcela conforme ela é paga.
  // As duas partem de bases diferentes (Cash Value vs. jackpot total) e não devem ser
  // combinadas ou confundidas — por isso os campos abaixo são mantidos e exibidos
  // separadamente.
  function calculatePrizePerParticipant(draw, participant) {
    var totalCotas = draw.participants.reduce(function (s, p) { return s + p.cotas; }, 0);
    var stateRate = STATE_TAX_RATES.hasOwnProperty(participant.state) ? STATE_TAX_RATES[participant.state] : null;

    // --- Opção 1: LUMP SUM (à vista) — base: Cash Value oficial (ou estimativa de
    // 50,5% do jackpot só quando o Cash Value oficial ainda não foi divulgado). ---
    var lumpSumPool = draw.drawing.cashValue != null ? draw.drawing.cashValue : draw.drawing.jackpot * 0.505;
    var lumpSumBruto = (lumpSumPool / totalCotas) * participant.cotas;

    if (stateRate === null) {
      // Estado não cadastrado: não estimamos impostos para não mostrar número errado.
      return {
        lumpSumBruto: lumpSumBruto, lumpSumTax: null, lumpSumNet: null,
        annuityTotalBruto: null, annuityTotalNet: null, annuityMonthlyNet: null,
        stateKnown: false
      };
    }
    var lumpSumTax = lumpSumBruto * (FEDERAL_TAX_RATE + stateRate);
    var lumpSumNet = lumpSumBruto - lumpSumTax;

    // --- Opção 2: ANUIDADE (parcelado, 30 anos) — base: valor CHEIO do jackpot,
    // nunca o Cash Value do lump sum. 30 pagamentos anuais crescentes (~5%/ano); aqui
    // mostramos a MÉDIA (total ÷ 30 anos), não o valor real da primeira parcela
    // (que é menor que a média por ser a primeira de uma série crescente). Mensal é
    // só uma divisão didática da média anual por 12 — o Powerball paga anualmente,
    // não mensalmente. ---
    var annuityTotalBruto = (draw.drawing.jackpot / totalCotas) * participant.cotas;
    var annuityTotalNet = annuityTotalBruto * (1 - FEDERAL_TAX_RATE - stateRate);
    var annuityMonthlyNet = annuityTotalNet / 30 / 12;

    return {
      lumpSumBruto: lumpSumBruto,
      lumpSumTax: lumpSumTax,
      lumpSumNet: lumpSumNet,
      annuityTotalBruto: annuityTotalBruto,
      annuityTotalNet: annuityTotalNet,
      annuityMonthlyNet: annuityMonthlyNet,
      stateKnown: true
    };
  }

  // Exposto para reuso fora do IIFE (ex.: fluxo de e-mail de confirmação de
  // participante em scripts/email/). Mesma função usada pela tabela pública —
  // nunca reimplementar lump sum/anuidade/imposto em outro lugar.
  window.POWERBALL_PRIZE_CALC = { calculatePrizePerParticipant: calculatePrizePerParticipant };

  function renderTable(draw) {
    var tbody = document.getElementById("pbParticipantsBody");
    var sorted = draw.participants.slice().sort(function (a, b) {
      return parseEntryTimestamp(a) - parseEntryTimestamp(b);
    });
    tbody.innerHTML = sorted.map(function (p) {
      // "pendente" é um status próprio: participação registrada, pagamento ainda não confirmado.
      // Sem ele, qualquer participante novo cairia em "✓ Verificado" — afirmação falsa sobre dinheiro.
      var statusClass = p.status === "organizador" ? "organizador"
        : p.status === "pendente" ? "pendente" : "verificado";
      var statusLabel = p.status === "organizador" ? "Organizador"
        : p.status === "pendente" ? "Pagamento pendente" : "✓ Verificado";
      var prize = calculatePrizePerParticipant(draw, p);
      var stateLabel = p.state ? " (" + p.state + ")" : "";
      return "<tr>" +
        '<td data-label="Nome">' + p.name + stateLabel + "</td>" +
        // Participação registrada COM PAGAMENTO PENDENTE: `valor`/`metodo` nulos são um estado
        // legítimo — alguém entrou no sorteio e a contribuição ainda não foi definida/confirmada.
        // Antes disto o modelo obrigava os dois campos, então registrar participação sem pagamento
        // exigiria inventar um valor. Renderizar "—/Pendente" é honesto; "$NaN" ou "undefined" não.
        '<td data-label="Valor">' + (p.valor == null ? "—" : fmtUsd(p.valor)) + "</td>" +
        '<td data-label="Método" class="pb-td-mobile-hide">' + (p.metodo == null ? "Pendente" : p.metodo) + "</td>" +
        '<td data-label="Data / Hora">' + p.data + (p.hora !== "—" ? " " + p.hora : "") + "</td>" +
        '<td data-label="Status"><span class="pb-status-pill ' + statusClass + '">' + statusLabel + "</span></td>" +
        '<td data-label="Lump Sum Bruto" class="pb-td-mobile-hide">' + fmtUsdCompact(prize.lumpSumBruto) + "</td>" +
        '<td data-label="Lump Sum Impostos" class="pb-td-mobile-hide">' + (prize.stateKnown ? fmtUsdCompact(prize.lumpSumTax) : "—") + "</td>" +
        '<td data-label="Lump Sum Líquido"><strong>' + (prize.stateKnown ? fmtUsdCompact(prize.lumpSumNet) : "—") + "</strong></td>" +
        '<td data-label="Anuidade Total Bruto" class="pb-td-mobile-hide">' + (prize.stateKnown ? fmtUsdCompact(prize.annuityTotalBruto) : "—") + "</td>" +
        '<td data-label="Anuidade Total Líquido"><strong>' + (prize.stateKnown ? fmtUsdCompact(prize.annuityTotalNet) : "—") + "</strong></td>" +
        '<td data-label="Anuidade Média Mensal Líquida">' + (prize.stateKnown ? fmtUsdCompact(prize.annuityMonthlyNet) : "—") + "</td>" +
        "</tr>";
    }).join("");
  }

  // Destaque de acerto no bilhete. Pedido do Eduardo (2026-08-09, depois do sorteio de 08/08):
  // "não marcou os bilhetes venceram em negrito". Antes disto os números do bilhete eram texto
  // corrido — não havia nenhuma marcação de acerto, nem sequer CSS para isso.
  //
  // Só destaca quando o sorteio JÁ TEM resultado oficial gravado. Sem resultado não há acerto a
  // mostrar, e inventar destaque antes do sorteio seria pior que não ter.
  function highlightTicketNumbers(numeroStr, result, gt) {
    if (!result || !result.numbers || !result.numbers.length) return esc(numeroStr);
    var parsed = parseTicketNumeros(numeroStr);
    if (!parsed) return esc(numeroStr);
    var mainHits = parsed.numbers.filter(function (n) { return result.numbers.indexOf(n) !== -1; }).length;
    var pbHit = parsed.special === result.special;
    // Reconstrói a string marcando cada bola individualmente, preservando o formato original
    // ("01-14-27-63-64 — PB 25") em vez de reescrevê-lo.
    var m = numeroStr.match(/^([\d\s-]+?)\s*—\s*(PB|MB)\s*(\d+)$/);
    if (!m) return esc(numeroStr);
    var balls = m[1].trim().split(/[\s-]+/).map(function (b) {
      var hit = result.numbers.indexOf(Number(b)) !== -1;
      return hit ? '<b class="pb-hit">' + esc(b) + "</b>" : esc(b);
    }).join("-");
    var pbTxt = pbHit ? '<b class="pb-hit pb-hit--special">' + esc(m[3]) + "</b>" : esc(m[3]);
    var prize = gt && gt.prizeTable ? gt.prizeTable(mainHits, pbHit, result.multiplier || 1) : null;
    var tag = prize && prize.amount
      ? ' <span class="pb-ticket-prize">' + esc(prize.label) + " · " + fmtUsd(prize.amount) + "</span>"
      : "";
    return balls + " — " + esc(m[2]) + " " + pbTxt + tag;
  }

  function renderSharedTickets(draw, gt) {
    var t = draw.sharedTickets;
    // Planning-stage draw: no tickets purchased yet (empty series, no
    // compradoPor/dataComprovante) — show a clear pending message instead of
    // "Comprado por null · null ...".
    if (!t || !t.series || t.series.length === 0) {
      document.getElementById("pbTicketsMeta").textContent = "Nenhum ticket comprado ainda para este sorteio.";
      document.getElementById("pbTicketsBody").innerHTML = '<div class="pb-pending">Os tickets serão publicados assim que forem comprados para este sorteio.</div>';
      return;
    }
    document.getElementById("pbTicketsMeta").textContent =
      "Comprado por " + t.compradoPor + " · " + t.dataComprovante + " · US$" + t.valorPorTicket + "/ticket (Power Play)";

    document.getElementById("pbTicketsBody").innerHTML = t.series.map(function (s) {
      var numsHtml = s.numeros && s.numeros.length
        ? "<ul>" + s.numeros.map(function (n, i) {
            var body = highlightTicketNumbers(n, draw.result, gt);
            var won = body.indexOf("pb-ticket-prize") !== -1;
            return '<li' + (won ? ' class="pb-ticket-won"' : "") + ">Jogo " + (i + 1) + ": " + body + "</li>";
          }).join("") +
          (s.qtd > s.numeros.length ? '<li class="pb-pending">+ ' + (s.qtd - s.numeros.length) + " ticket(s) desse serial ainda não cadastrado(s)</li>" : "") +
          "</ul>"
        : '<div class="pb-pending">Números individuais deste serial ainda não cadastrados.</div>';
      var total = s.valorTotal || (s.qtd * t.valorPorTicket);
      var precoUnit = total / s.qtd;
      return '<div class="pb-ticket-block">' +
        '<div class="serial">Serial: ' + s.serial + (s.jogos ? " · Jogos " + s.jogos : "") + (s.compradoEm ? " · " + s.compradoEm : "") + '</div>' +
        '<div class="qtd">' + s.qtd + " ticket(s) · " + fmtUsd(precoUnit) + "/ticket · total " + fmtUsd(total) + "</div>" +
        numsHtml +
        "</div>";
    }).join("");
  }

  // "01-14-27-63-64 — PB 25" -> { numbers:[1,14,27,63,64], special:25 }
  function parseTicketNumeros(str) {
    var m = str.match(/^([\d\s-]+?)\s*—\s*PB\s*(\d+)$/);
    if (!m) return null;
    return { numbers: m[1].split("-").map(Number), special: Number(m[2]) };
  }

  function allTickets(draw) {
    var out = [];
    draw.sharedTickets.series.forEach(function (s) {
      s.numeros.forEach(function (n) {
        var parsed = parseTicketNumeros(n);
        if (parsed) out.push(parsed);
      });
    });
    return out;
  }

  function computePrize(draw, gt, official) {
    var tickets = allTickets(draw);
    var total = 0;
    var jackpotHit = false;
    var breakdown = [];

    tickets.forEach(function (t) {
      var mainMatches = t.numbers.filter(function (n) { return official.numbers.indexOf(n) !== -1; }).length;
      var specialMatch = t.special === official.special;
      var prize = gt.prizeTable(mainMatches, specialMatch, official.multiplier);
      if (!prize) return;
      if (prize.amount === null) { jackpotHit = true; return; }
      if (prize.amount > 0) {
        total += prize.amount;
        breakdown.push(prize.label + " (" + fmtUsd(prize.amount) + ")");
      }
    });

    return { total: total, jackpotHit: jackpotHit, breakdown: breakdown, ticketsChecked: tickets.length };
  }


  // ── "Números que mais acertamos" (sugestão do Alan Rech, aprovada) ─────────────────────────
  // Informativo. NÃO toca prêmio, investimento, lucro, participação nem email.
  //
  // Reusa `allTickets()` e o mesmo resultado canônico que o destaque de acerto e o cálculo de
  // prêmio já consomem — nenhuma segunda lógica de conferência. Duas implementações da mesma
  // pergunta divergiriam, e este repositório já pagou caro por isso mais de uma vez.
  //
  // Denominador = bilhetes VÁLIDOS deste sorteio (não participantes, não histórico). Se alguém tem
  // vários bilhetes, cada bilhete conta separado — a pergunta é sobre bilhetes, não sobre pessoas.
  function computeHitStats(draw, gt) {
    var r = draw && draw.result;
    if (!r || !r.numbers || !r.numbers.length) return null;
    var tickets = allTickets(draw);
    if (!tickets.length) return { total: 0, whites: [], special: null };

    var whites = r.numbers.map(function (n) {
      var count = tickets.filter(function (t) { return t.numbers.indexOf(n) !== -1; }).length;
      return { n: n, count: count, pct: (count / tickets.length) * 100 };
    });
    // Ordem: mais acertados primeiro; empate pelo próprio número, para ser determinístico.
    whites.sort(function (a, b) { return (b.count - a.count) || (a.n - b.n); });

    var spCount = tickets.filter(function (t) { return t.special === r.special; }).length;
    return {
      total: tickets.length,
      whites: whites,
      special: { n: r.special, count: spCount, pct: (spCount / tickets.length) * 100 }
    };
  }

  // Sem casas decimais quando o número é redondo — "50%" e não "50.0%".
  function fmtPct(v) {
    var r = Math.round(v * 10) / 10;
    return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)) + "%";
  }

  function renderHitStats(draw, gt) {
    var box = document.getElementById("pbHitStats");
    var body = document.getElementById("pbHitStatsBody");
    if (!box || !body) return;
    var stats = computeHitStats(draw, gt);
    // Sorteio sem resultado ou sem bilhete: esconde. Mostrar "0 de 0 · 0%" seria estatística
    // fabricada sobre um sorteio que ainda não aconteceu.
    if (!stats || !stats.total) { box.style.display = "none"; body.innerHTML = ""; return; }
    box.style.display = "";

    var rows = stats.whites.map(function (w) {
      return '<tr><td data-label="Número"><span class="pb-hit-ball">' + w.n + "</span></td>" +
        '<td data-label="Bilhetes">' + w.count + " de " + stats.total + "</td>" +
        '<td data-label="Frequência">' + fmtPct(w.pct) + "</td></tr>";
    }).join("");
    // O Powerball é campo DIFERENTE das cinco brancas — não entra na mesma ordenação, e usa a
    // linguagem visual própria dele.
    var sp = stats.special;
    rows += '<tr class="pb-hit-stats__special"><td data-label="Número">' +
      '<span class="pb-hit-ball pb-hit-ball--special">' + sp.n + "</span> " +
      (gt && gt.specialBallLabel ? gt.specialBallLabel : "Powerball") + "</td>" +
      '<td data-label="Bilhetes">' + sp.count + " de " + stats.total + "</td>" +
      '<td data-label="Frequência">' + fmtPct(sp.pct) + "</td></tr>";
    body.innerHTML = rows;
  }

  function fetchOfficialResult(draw, gt) {
    var dateStr = draw.drawing.drawDateIso.slice(0, 10); // YYYY-MM-DD
    var url = gt.resultsApi + "?$order=draw_date DESC&$limit=20";
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function (rows) {
      var row = rows.find(function (r) { return (r.draw_date || "").slice(0, 10) === dateStr; });
      if (!row) throw new Error("Sorteio de " + dateStr + " ainda não publicado");
      return gt.parseResult(row);
    });
  }

  function renderResultPending(state, message) {
    document.getElementById("pbResultDisplay").style.display = "none";
    var hs = document.getElementById("pbHitStats");
    if (hs) hs.style.display = "none";   // sem resultado não há estatística honesta a mostrar
    var pending = document.getElementById("pbResultPending");
    pending.style.display = "";
    document.getElementById("pbResultPendingMsg").textContent = message;
    document.getElementById("pbResultRetryBtn").style.display = state === "error" ? "" : "none";
  }

  function renderResult(draw, gt) {
    var display = document.getElementById("pbResultDisplay");
    var pending = document.getElementById("pbResultPending");
    var r = draw.result;

    if (r && r.numbers && r.numbers.length) {
      pending.style.display = "none";
      display.style.display = "";
      var sortedNums = r.numbers.slice().sort(function (a, b) { return a - b; });
      document.getElementById("pbResultNumbers").textContent =
        sortedNums.join("-") + "  ·  " + gt.specialBallLabel + " " + r.special +
        (r.multiplier ? "  ·  Power Play " + r.multiplier + "x" : "");
      document.getElementById("pbResultChecked").textContent = "Conferido automaticamente em " + r.checkedAt;

      renderHitStats(draw, gt);

      var profitEl = document.getElementById("pbResultProfit");
      if (r.jackpotHit) {
        profitEl.innerHTML = "🎉 <strong>JACKPOT!</strong> Ligue para o organizador imediatamente.";
      } else if (r.premiosGanhos > 0) {
        profitEl.innerHTML = "Prêmios ganhos: <strong>" + fmtUsd(r.premiosGanhos) + "</strong>" +
          (r.breakdown && r.breakdown.length ? " (" + r.breakdown.join(", ") + ")" : "") +
          " · Lucro: <strong>" + fmtUsd(r.premiosGanhos - draw.finance.valorUtilizado) + "</strong>";
      } else {
        profitEl.innerHTML = "Nenhum prêmio nesse sorteio · Lucro: <strong>" + fmtUsd(-draw.finance.valorUtilizado) + "</strong>";
      }
      return;
    }

    // Sem resultado salvo ainda: se o sorteio já passou, busca automaticamente.
    var drawPassed = new Date(draw.drawing.drawDateIso).getTime() <= Date.now();
    if (!drawPassed) {
      renderResultPending("waiting", "O resultado é buscado automaticamente na fonte oficial (NY Open Data) assim que o sorteio acontecer.");
      return;
    }

    renderResultPending("loading", "Buscando resultado oficial…");
    fetchOfficialResult(draw, gt).then(function (official) {
      var computed = computePrize(draw, gt, official);
      var override = {
        result: {
          numbers: official.numbers,
          special: official.special,
          multiplier: official.multiplier,
          checkedAt: new Date().toLocaleString("pt-BR"),
          premiosGanhos: computed.total,
          jackpotHit: computed.jackpotHit,
          breakdown: computed.breakdown
        }
      };
      saveLocalOverride(draw.id, override);
      if (DRAWS[currentIdx].id === draw.id) renderDraw(currentIdx);
    }).catch(function (err) {
      renderResultPending("error", "Não foi possível confirmar o resultado ainda (" + err.message + "). Ele é publicado pela loteria após o sorteio — tente novamente em instantes.");
    });
  }

  function wireResultRetry() {
    document.getElementById("pbResultRetryBtn").onclick = function () {
      renderDraw(currentIdx);
    };
  }

  function tick(draw, gt) {
    clearInterval(countdownTimer);
    function step() {
      var target = new Date(draw.drawing.drawDateIso).getTime();
      var diff = target - Date.now();
      var box = document.getElementById("pbCountdownNums");
      var statusBadge = document.getElementById("pbStatusBadge");

      if (diff <= 0) {
        box.innerHTML = '<div class="n">Sorteio realizado</div>';
        statusBadge.textContent = gt.icon + " " + gt.label.toUpperCase() + " — SORTEIO ENCERRADO";
        clearInterval(countdownTimer);
        return;
      }

      var d = Math.floor(diff / 86400000);
      var h = Math.floor((diff % 86400000) / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);

      box.innerHTML =
        '<div><div class="n">' + d + '</div><div class="u">dias</div></div>' +
        '<div><div class="n">' + h + '</div><div class="u">horas</div></div>' +
        '<div><div class="n">' + m + '</div><div class="u">min</div></div>' +
        '<div><div class="n">' + s + '</div><div class="u">seg</div></div>';

      var etaText = d > 0 ? (d + "d " + h + "h " + m + "min") : (h + "h " + m + "min");
      statusBadge.textContent = gt.icon + " " + gt.label.toUpperCase() + " · ATIVO — Sorteio em " + etaText;
    }
    step();
    countdownTimer = setInterval(step, 1000);
  }

  function shareText(draw, gt) {
    return "🎟️ Bolão " + gt.label + " — Jackpot " + fmtJackpot(draw) +
      "\nSorteio: " + draw.drawing.drawDateLabel +
      "\nParticipantes: " + draw.participants.length +
      "\nTotal arrecadado: " + fmtUsd(draw.finance.totalArrecadado) +
      "\nGuardado p/ próximo sorteio: " + fmtUsd(draw.finance.valorGuardadoProximoSorteio) +
      "\n\nBoa sorte a todos! 🍀";
  }

  function wireShareButtons(draw, gt) {
    var url = "https://wa.me/?text=" + encodeURIComponent(shareText(draw, gt));
    document.querySelectorAll(".js-share-whatsapp").forEach(function (btn) {
      btn.href = url;
    });
  }

  function renderDraw(idx) {
    currentIdx = idx;
    syncDrawCombo(); // o botão do combo mostra o sorteio corrente -- fonte de verdade é currentIdx
    var draw = getEffectiveDraw(DRAWS[idx]);
    var gt = applyTheme(draw.gameType);

    document.getElementById("pbJackpot").textContent = fmtJackpot(draw);
    document.getElementById("pbDrawDate").textContent = draw.drawing.drawDateLabel;

    if (!temJackpot(draw)) {
      // Anuidade e lump sum sao DERIVADOS do jackpot. Sem ele nao ha o que comparar, e mostrar
      // "$NaN" ou "$0" seria pior que nao mostrar.
      document.getElementById("pbJackpotOptions").textContent =
        "Prêmio ainda não divulgado pela loteria.";
    } else {
      var cashValueLabel = draw.drawing.cashValue != null
        ? fmtUsdCompact(draw.drawing.cashValue)
        : fmtUsdCompact(draw.drawing.jackpot * 0.505) + " (estimado)";
      document.getElementById("pbJackpotOptions").innerHTML =
        '<span class="pb-jackpot-opt"><strong>Anuidade</strong> (30 anos): $' + (draw.drawing.jackpot / 1e6).toFixed(0) + "M</span>" +
        '<span class="pb-jackpot-opt"><strong>Lump Sum</strong> (à vista): ' + cashValueLabel + "</span>";
    }

    renderSummary(draw);
    renderTable(draw);
    renderSharedTickets(draw, gt);
    renderResult(draw, gt);
    wireResultRetry();
    tick(draw, gt);
    // NÃO reconstruir o combo aqui. buildDrawCombo() faz innerHTML, o que (a) destrói o botão que
    // acabou de receber o foco depois de Enter/clique e (b) re-registra os listeners a cada render,
    // inclusive o de `document` (vazamento). Refrescar os rótulos é suficiente: as opções só mudam
    // de TEXTO quando um resultado entra, nunca de quantidade.
    syncDrawComboLabels();
    wireShareButtons(draw, gt);
  }

  function indexForDrawId(id) {
    for (var i = 0; i < DRAWS.length; i++) if (DRAWS[i].id === id) return i;
    return -1;
  }

  // Deep-link: ?draw=<id> (or #<id>) selects that draw on load, falling back
  // to the default (last/most relevant draw) when absent or unrecognized.
  function deepLinkedIndex() {
    var params = new URLSearchParams(window.location.search);
    var fromQuery = params.get("draw");
    var fromHash = window.location.hash ? window.location.hash.slice(1) : null;
    var id = fromQuery || fromHash;
    if (!id) return -1;
    return indexForDrawId(id);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var deepLinked = deepLinkedIndex();
    if (deepLinked !== -1) currentIdx = deepLinked;
    renderDrawSelector();
    renderDraw(currentIdx);

    // O <select> nativo não existe mais (Batch 6). O combo customizado registra os próprios
    // handlers em wireDrawCombo(), chamado uma única vez por buildDrawCombo().
  });
})();
