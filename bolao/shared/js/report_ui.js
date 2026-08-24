/**
 * report_ui.js — modal "Reportar problema" (Issue #321), compartilhado pelos apps ativos.
 *
 * ─── NAO EXISTE ATE ALGUEM LIGAR ────────────────────────────────────────────────────────────
 *
 * `montar()` desiste em silencio quando `config.reportProblem.enabled` nao e exatamente `true`.
 * Nenhum botao entra no DOM, nenhum listener e registrado, nenhuma requisicao acontece. Um botao
 * visivel sem backend aceito seria um botao morto -- pior que a ausencia dele, porque ensina o
 * participante que reportar nao funciona.
 *
 * O flag do cliente NAO e a fronteira de seguranca. Ele roda no navegador do participante, que o
 * edita a vontade. A fronteira e `REPORT_INTAKE_ENABLED` no servidor. Este flag existe para a UI
 * nao aparecer e como defesa em profundidade -- ver §4-B de docs/bolao/SECURE_USER_REPORTING.md.
 *
 * ─── IDIOMAS ────────────────────────────────────────────────────────────────────────────────
 *
 * As strings moram AQUI, nos quatro idiomas, e nao no `i18n.js` de cada app. Os apps carregam tres
 * idiomas cada um e um deles nao carrega japones; espalhar este componente por tres arquivos de
 * traducao criaria quatro copias divergentes de um texto de privacidade -- que e o unico texto
 * desta plataforma que NAO pode divergir entre idiomas.
 */
(function (root) {
  "use strict";

  var CTX = root.BOLAO_REPORT_CONTEXT;

  var T = {
    "pt-BR": {
      trigger: "Reportar problema",
      title: "Reportar um problema",
      intro: "Conte o que aconteceu. Isto vai para uma fila privada de triagem — não aparece para outros participantes.",
      descLabel: "O que aconteceu?",
      descHint: "Entre 10 e 1500 caracteres.",
      actionLabel: "O que você estava tentando fazer? (opcional)",
      privacy: "Não escreva dados pessoais. Não precisamos do seu nome, e-mail, telefone nem de qualquer referência de pagamento — já sabemos em que tela você estava e o que o sistema registrou.",
      disclosure: "Ver exatamente o que é enviado",
      send: "Enviar",
      sending: "Enviando…",
      cancel: "Cancelar",
      close: "Fechar",
      okTitle: "Recebido.",
      okBody: "Guarde este código. Ele identifica o seu relato sem identificar você — inclusive para pedir a remoção depois.",
      noReply: "Este canal não é suporte e não garante resposta. Se for urgente, fale direto com o organizador.",
      errGeneric: "Não foi possível enviar agora. Tente de novo mais tarde.",
      errRate: "Você já enviou relatos demais em pouco tempo. Tente novamente mais tarde.",
      errShort: "Escreva um pouco mais — pelo menos 10 caracteres.",
      errLong: "Texto longo demais. O limite é 1500 caracteres.",
      offline: "Você parece estar sem conexão. O relato não foi enviado.",
    },
    "en-US": {
      trigger: "Report a problem",
      title: "Report a problem",
      intro: "Tell us what happened. This goes to a private triage queue — other participants never see it.",
      descLabel: "What happened?",
      descHint: "Between 10 and 1500 characters.",
      actionLabel: "What were you trying to do? (optional)",
      privacy: "Please don't write personal data. We don't need your name, email, phone or any payment reference — we already know which screen you were on and what the system recorded.",
      disclosure: "See exactly what gets sent",
      send: "Send",
      sending: "Sending…",
      cancel: "Cancel",
      close: "Close",
      okTitle: "Received.",
      okBody: "Keep this code. It identifies your report without identifying you — including if you later ask us to delete it.",
      noReply: "This is not a support channel and a reply is not guaranteed. If it's urgent, contact the organiser directly.",
      errGeneric: "Couldn't send right now. Please try again later.",
      errRate: "You've sent too many reports in a short time. Please try again later.",
      errShort: "Please write a bit more — at least 10 characters.",
      errLong: "That's too long. The limit is 1500 characters.",
      offline: "You appear to be offline. The report was not sent.",
    },
    "es": {
      trigger: "Reportar un problema",
      title: "Reportar un problema",
      intro: "Cuéntanos qué pasó. Esto va a una cola privada de triaje — los demás participantes no lo ven.",
      descLabel: "¿Qué pasó?",
      descHint: "Entre 10 y 1500 caracteres.",
      actionLabel: "¿Qué estabas intentando hacer? (opcional)",
      privacy: "No escribas datos personales. No necesitamos tu nombre, correo, teléfono ni ninguna referencia de pago — ya sabemos en qué pantalla estabas y qué registró el sistema.",
      disclosure: "Ver exactamente qué se envía",
      send: "Enviar",
      sending: "Enviando…",
      cancel: "Cancelar",
      close: "Cerrar",
      okTitle: "Recibido.",
      okBody: "Guarda este código. Identifica tu reporte sin identificarte a ti — también si luego pides eliminarlo.",
      noReply: "Este canal no es soporte y no garantiza respuesta. Si es urgente, habla directamente con el organizador.",
      errGeneric: "No se pudo enviar ahora. Inténtalo más tarde.",
      errRate: "Has enviado demasiados reportes en poco tiempo. Inténtalo más tarde.",
      errShort: "Escribe un poco más — al menos 10 caracteres.",
      errLong: "Demasiado largo. El límite es 1500 caracteres.",
      offline: "Parece que no tienes conexión. El reporte no se envió.",
    },
    "ja": {
      trigger: "問題を報告",
      title: "問題を報告する",
      intro: "何が起きたか教えてください。内容は非公開のトリアージキューに送られ、他の参加者には表示されません。",
      descLabel: "何が起きましたか？",
      descHint: "10〜1500文字。",
      actionLabel: "何をしようとしていましたか？（任意）",
      privacy: "個人情報は書かないでください。氏名・メールアドレス・電話番号・支払い情報は不要です。どの画面にいたか、システムが何を記録したかは既に分かっています。",
      disclosure: "送信される内容を確認する",
      send: "送信",
      sending: "送信中…",
      cancel: "キャンセル",
      close: "閉じる",
      okTitle: "受け付けました。",
      okBody: "このコードを保管してください。あなたを特定せずに報告を識別します（後で削除を依頼する場合にも使えます）。",
      noReply: "これはサポート窓口ではなく、返信は保証されません。お急ぎの場合は主催者に直接ご連絡ください。",
      errGeneric: "現在送信できませんでした。しばらくしてからお試しください。",
      errRate: "短時間に報告を送信しすぎています。しばらくしてからお試しください。",
      errShort: "もう少し詳しく書いてください（10文字以上）。",
      errLong: "長すぎます。上限は1500文字です。",
      offline: "オフラインのようです。報告は送信されていません。",
    },
  };

  /** pt-BR e o fallback declarado da plataforma inteira. */
  function textos(lang) {
    if (T[lang]) return T[lang];
    var curto = String(lang || "").slice(0, 2).toLowerCase();
    if (curto === "en") return T["en-US"];
    if (curto === "es") return T["es"];
    if (curto === "ja") return T["ja"];
    return T["pt-BR"];
  }

  function idioma(cfg) {
    try {
      var salvo = root.localStorage && root.localStorage.getItem("bolao_lang");
      if (salvo) return salvo;
    } catch (e) {
      // Storage bloqueado (janela privativa, cookies desativados). Nao e erro: so nao ha preferencia
      // salva, e o fallback abaixo resolve.
    }
    if (cfg && cfg.defaultLang) return cfg.defaultLang;
    return (root.document && root.document.documentElement.lang) || "pt-BR";
  }

  function el(tag, props, filhos) {
    var n = root.document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "text") n.textContent = props[k];
      else if (k === "html") throw new Error("html cru nao e permitido aqui");
      else n.setAttribute(k, props[k]);
    });
    (filhos || []).forEach(function (f) { n.appendChild(f); });
    return n;
  }

  /** Elementos que podem receber foco dentro do modal, na ordem do DOM. */
  function focaveis(raiz) {
    var sel = 'button:not([disabled]), [href], input:not([type="hidden"]), select, textarea,' +
              ' summary, [tabindex]:not([tabindex="-1"])';
    return Array.prototype.slice.call(raiz.querySelectorAll(sel))
      .filter(function (n) { return n.offsetParent !== null || n.tagName === "SUMMARY"; });
  }

  function montar(opcoes) {
    var o = opcoes || {};
    var cfg = o.config || {};
    var rp = cfg.reportProblem || {};

    // Comparacao estrita: qualquer coisa que nao seja o booleano `true` mantem a UI ausente.
    if (rp.enabled !== true) return null;
    if (!CTX) return null;
    if (!rp.endpoint) return null;

    var doc = root.document;
    var t = textos(idioma(cfg));
    var lim = CTX.LIMITES;
    var aberto = false;
    var focoAnterior = null;
    var enviando = false;

    var backdrop, dialog, textarea, acao, contador, status, btnEnviar, honeypot, tituloId;

    function payloadAtual() {
      return CTX.montarPayload({
        app: o.app,
        siteVersion: cfg.siteVersion,
        sectionId: (typeof o.secaoAtual === "function" && o.secaoAtual()) || "unknown",
        locale: idioma(cfg),
        description: textarea ? textarea.value : "",
        attemptedAction: acao ? acao.value : "",
        honeypot: honeypot ? honeypot.value : "",
        window: root,
      });
    }

    function construir() {
      tituloId = "report-title-" + Math.random().toString(36).slice(2, 8);

      textarea = el("textarea", {
        class: "report-textarea", id: tituloId + "-desc",
        maxlength: String(lim.description.max),
        "aria-describedby": tituloId + "-hint",
      });
      acao = el("input", { class: "report-input", type: "text", id: tituloId + "-act",
                           maxlength: String(lim.attemptedAction.max) });
      contador = el("span", { class: "report-counter", id: tituloId + "-hint", text: t.descHint });
      honeypot = el("input", { class: "report-honeypot", type: "text", tabindex: "-1",
                               autocomplete: "off", "aria-hidden": "true", name: "website" });
      status = el("p", { class: "report-status", role: "status", "aria-live": "polite" });
      btnEnviar = el("button", { class: "report-btn report-btn--primary", type: "button", text: t.send });
      var btnCancelar = el("button", { class: "report-btn", type: "button", text: t.cancel });
      var btnFechar = el("button", { class: "report-close", type: "button",
                                     "aria-label": t.close, text: "×" });

      textarea.addEventListener("input", function () {
        var n = textarea.value.length;
        contador.textContent = n + " / " + lim.description.max;
        contador.setAttribute("data-estado", n > lim.description.max ? "excedido" : "ok");
      });

      var dl = el("dl", {});
      function linha(chave, valor) {
        dl.appendChild(el("dt", { text: chave }));
        dl.appendChild(el("dd", { text: valor }));
      }
      var disclosure = el("details", { class: "report-disclosure" }, [
        el("summary", { text: t.disclosure }), dl,
      ]);
      disclosure.addEventListener("toggle", function () {
        if (!disclosure.open) return;
        while (dl.firstChild) dl.removeChild(dl.firstChild);
        var p = payloadAtual();
        // Mostra o objeto REAL que sairia agora, campo a campo -- nao uma descricao dele. Se algum
        // dia um campo novo entrar no coletor, ele aparece aqui sozinho.
        Object.keys(p).forEach(function (k) {
          if (k === "honeypot") return;
          var v = p[k];
          linha(k, v === null || v === undefined || v === "" ? "—" : (typeof v === "object" ? JSON.stringify(v) : String(v)));
        });
      });

      dialog = el("div", {
        class: "report-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": tituloId,
      }, [
        el("div", { class: "report-head" }, [
          el("h2", { class: "report-title", id: tituloId, text: t.title }), btnFechar,
        ]),
        el("p", { class: "report-label", text: t.intro }),
        el("div", { class: "report-privacy" }, [el("strong", { text: t.privacy })]),
        el("div", { class: "report-field" }, [
          el("label", { class: "report-label", for: tituloId + "-desc", text: t.descLabel }),
          textarea, contador,
        ]),
        el("div", { class: "report-field" }, [
          el("label", { class: "report-label", for: tituloId + "-act", text: t.actionLabel }), acao,
        ]),
        honeypot,
        disclosure,
        el("p", { class: "report-label", text: t.noReply }),
        status,
        el("div", { class: "report-actions" }, [btnCancelar, btnEnviar]),
      ]);

      backdrop = el("div", { class: "report-backdrop", hidden: "hidden" }, [dialog]);

      btnFechar.addEventListener("click", fechar);
      btnCancelar.addEventListener("click", fechar);
      btnEnviar.addEventListener("click", enviar);
      backdrop.addEventListener("mousedown", function (e) { if (e.target === backdrop) fechar(); });
      backdrop.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { e.preventDefault(); fechar(); return; }
        if (e.key !== "Tab") return;
        var f = focaveis(dialog);
        if (!f.length) return;
        var primeiro = f[0], ultimo = f[f.length - 1];
        if (e.shiftKey && doc.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && doc.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
      });

      doc.body.appendChild(backdrop);
    }

    function abrir() {
      if (aberto) return;
      if (!backdrop) construir();
      focoAnterior = doc.activeElement;
      backdrop.removeAttribute("hidden");
      aberto = true;
      textarea.focus();
    }

    function fechar() {
      if (!aberto || enviando) return;
      backdrop.setAttribute("hidden", "hidden");
      aberto = false;
      if (focoAnterior && focoAnterior.focus) focoAnterior.focus();
    }

    function dizer(tipo, texto, id) {
      status.setAttribute("data-tipo", tipo);
      while (status.firstChild) status.removeChild(status.firstChild);
      status.appendChild(doc.createTextNode(texto));
      if (id) {
        status.appendChild(doc.createElement("br"));
        status.appendChild(el("span", { class: "report-id", text: id }));
      }
    }

    function enviar() {
      if (enviando) return;
      var texto = textarea.value.trim();
      if (texto.length < lim.description.min) { dizer("erro", t.errShort); textarea.focus(); return; }
      if (texto.length > lim.description.max) { dizer("erro", t.errLong); textarea.focus(); return; }
      if (root.navigator && root.navigator.onLine === false) { dizer("erro", t.offline); return; }

      enviando = true;
      btnEnviar.disabled = true;
      btnEnviar.textContent = t.sending;
      dizer("", "");

      var corpo = payloadAtual();
      root.fetch(rp.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      }).then(function (r) {
        if (r.status === 429) { dizer("erro", t.errRate); return; }
        if (!r.ok && r.status !== 202) { dizer("erro", t.errGeneric); return; }
        dizer("ok", t.okTitle + " " + t.okBody, CTX.idExibivel(corpo.reportId));
        textarea.value = "";
        acao.value = "";
        contador.textContent = t.descHint;
      }).catch(function () {
        // Erro de rede cru NUNCA vai para a tela: `Error.message` de fetch as vezes carrega a URL
        // completa, e a mensagem generica serve igualmente bem a quem esta lendo.
        dizer("erro", t.errGeneric);
      }).then(function () {
        enviando = false;
        btnEnviar.disabled = false;
        btnEnviar.textContent = t.send;
      });
    }

    var gatilho = el("button", { class: "report-trigger", type: "button", text: t.trigger });
    gatilho.addEventListener("click", abrir);
    if (o.destino) o.destino.appendChild(gatilho);

    return { gatilho: gatilho, abrir: abrir, fechar: fechar, textos: t };
  }

  /**
   * Auto-montagem declarativa: o app marca UM ponto no HTML e nao precisa tocar no `app.js`.
   *
   *   <span data-report-mount data-report-app="cdb2026" data-report-config="CDB2026_CONFIG"></span>
   *
   * Se a flag estiver desligada, `montar()` devolve null e o ponto de montagem fica exatamente como
   * estava: um `<span>` vazio. Nenhum botao, nenhum listener, nenhuma requisicao.
   */
  function autoMontar() {
    if (!root.document) return;
    var pontos = root.document.querySelectorAll("[data-report-mount]");
    for (var i = 0; i < pontos.length; i++) {
      var p = pontos[i];
      var nomeCfg = p.getAttribute("data-report-config");
      montar({
        app: p.getAttribute("data-report-app") || "platform",
        config: (nomeCfg && root[nomeCfg]) || {},
        destino: p,
      });
    }
  }

  if (root.document) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", autoMontar);
    } else {
      autoMontar();
    }
  }

  root.BOLAO_REPORT_UI = {
    montar: montar, textos: textos, autoMontar: autoMontar, IDIOMAS: Object.keys(T),
  };
})(typeof window !== "undefined" ? window : globalThis);
