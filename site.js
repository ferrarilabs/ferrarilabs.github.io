/* ============================================================
   Eduardo Ferrari — shared script for the professional pages
   (index*.html, insights.html, privacy.html, terms.html). Not used by /bolao/.

   Loaded synchronously in <head> on purpose: the pages have inline handlers that call
   gtag(...), and gtag must exist before any of them can fire.

   Google Analytics is opt-in (Issue #434): until the visitor chooses "Allow analytics",
   gtag() drops every call, the gtag.js library is never requested and no analytics
   cookie is set. Guarded by scripts/site/check_public_pages.mjs.
   ============================================================ */
(function () {
  'use strict';

  var GA_ID = 'G-KF98YDJNK7';
  var CONSENT_KEY = 'analytics_consent';

  var TEXT = {
    en: {
      banner: 'This site uses Google Analytics to understand visits — only if you allow it.',
      allow: 'Allow analytics', decline: 'Decline', privacy: 'Privacy policy',
      region: 'Analytics preference',
      granted: 'Current choice: analytics allowed.', denied: 'Current choice: analytics declined.',
      none: 'No choice saved yet — analytics is off.',
      sending: 'Sending…', sendingStatus: 'Sending your message…'
    },
    pt: {
      banner: 'Este site usa o Google Analytics para entender as visitas — somente se você permitir.',
      allow: 'Permitir analytics', decline: 'Recusar', privacy: 'Política de privacidade',
      region: 'Preferência de analytics',
      granted: 'Escolha atual: analytics permitido.', denied: 'Escolha atual: analytics recusado.',
      none: 'Nenhuma escolha salva — analytics desligado.',
      sending: 'Enviando…', sendingStatus: 'Enviando sua mensagem…'
    },
    es: {
      banner: 'Este sitio usa Google Analytics para entender las visitas, solo si usted lo permite.',
      allow: 'Permitir analytics', decline: 'Rechazar', privacy: 'Política de privacidad',
      region: 'Preferencia de analytics',
      granted: 'Elección actual: analytics permitido.', denied: 'Elección actual: analytics rechazado.',
      none: 'Sin elección guardada: analytics desactivado.',
      sending: 'Enviando…', sendingStatus: 'Enviando su mensaje…'
    },
    ja: {
      banner: 'このサイトでは、許可いただいた場合のみ Google アナリティクスで閲覧状況を把握します。',
      allow: '許可する', decline: '拒否する', privacy: 'プライバシーポリシー',
      region: 'アナリティクスの設定',
      granted: '現在の設定：アナリティクスを許可。', denied: '現在の設定：アナリティクスを拒否。',
      none: '未選択のため、アナリティクスは無効です。',
      sending: '送信中…', sendingStatus: 'メッセージを送信しています…'
    }
  };
  var lang = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
  var t = TEXT[lang] || TEXT.en;

  // ── analytics consent ─────────────────────────────────────────────────────────────────────
  window.dataLayer = window.dataLayer || [];
  var enabled = false;
  window.gtag = function () {
    if (enabled) window.dataLayer.push(arguments);
  };

  function readChoice() {
    try { return localStorage.getItem(CONSENT_KEY); }
    catch (e) { return null; } // storage blocked: behave as "no choice yet" (analytics stays off)
  }
  function saveChoice(value) {
    try { localStorage.setItem(CONSENT_KEY, value); }
    catch (e) { /* storage blocked: the choice still applies to this page view */ }
  }

  function enableAnalytics() {
    if (enabled) return;
    enabled = true;
    window['ga-disable-' + GA_ID] = false;
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
  }

  function disableAnalytics() {
    enabled = false;
    window['ga-disable-' + GA_ID] = true;
    // Remove the cookies GA may already have set, for every domain form it could have used.
    var host = location.hostname;
    var domains = ['', host, '.' + host, '.' + host.replace(/^www\./, '')];
    document.cookie.split(';').forEach(function (pair) {
      var name = pair.split('=')[0].trim();
      if (name.indexOf('_ga') !== 0) return;
      domains.forEach(function (d) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : '');
      });
    });
  }

  if (readChoice() === 'granted') enableAnalytics();

  function setChoice(value) {
    saveChoice(value);
    if (value === 'granted') enableAnalytics(); else disableAnalytics();
    removeBanner();
    updateControls();
  }

  var banner = null;
  function button(label, className, value) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'button ' + className;
    b.textContent = label;
    b.addEventListener('click', function () { setChoice(value); });
    return b;
  }
  function showBanner() {
    banner = document.createElement('div');
    banner.className = 'consent-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', t.region);
    var text = document.createElement('p');
    text.className = 'consent-text';
    text.appendChild(document.createTextNode(t.banner + ' '));
    var link = document.createElement('a');
    // Same language as the page: privacy.html / privacy.pt.html / privacy.es.html / privacy.jp.html.
    link.href = '/privacy' + ({ pt: '.pt', es: '.es', ja: '.jp' }[lang] || '') + '.html';
    link.textContent = t.privacy;
    text.appendChild(link);
    var actions = document.createElement('div');
    actions.className = 'consent-actions';
    actions.appendChild(button(t.allow, 'button-primary', 'granted'));
    actions.appendChild(button(t.decline, 'button-ghost', 'denied'));
    banner.appendChild(text);
    banner.appendChild(actions);
    document.body.appendChild(banner);
    // Keep the end of the page reachable while the banner is on screen.
    document.body.style.paddingBottom = (banner.offsetHeight + 32) + 'px';
  }
  function removeBanner() {
    if (!banner) return;
    banner.parentNode.removeChild(banner);
    banner = null;
    document.body.style.paddingBottom = '';
  }

  // Privacy page: <button data-consent-choice="granted|denied"> + <p data-consent-status>.
  function updateControls() {
    var choice = readChoice();
    var status = document.querySelector('[data-consent-status]');
    if (status) status.textContent = choice === 'granted' ? t.granted : choice === 'denied' ? t.denied : t.none;
    var controls = document.querySelectorAll('[data-consent-choice]');
    Array.prototype.forEach.call(controls, function (c) {
      c.setAttribute('aria-pressed', String(c.getAttribute('data-consent-choice') === choice));
    });
  }
  function wireControls() {
    var controls = document.querySelectorAll('[data-consent-choice]');
    Array.prototype.forEach.call(controls, function (c) {
      c.addEventListener('click', function () { setChoice(c.getAttribute('data-consent-choice')); });
    });
    updateControls();
  }

  // ── contact form: "sending" state ─────────────────────────────────────────────────────────
  // The form keeps its native POST to Formspree (no AJAX). This only prevents a double submit
  // and announces the sending state; validation errors stay native, and a server-side error
  // is shown by Formspree's own page, exactly as before.
  function wireForms() {
    var forms = document.querySelectorAll('form.contact-form');
    Array.prototype.forEach.call(forms, function (form) {
      var submit = form.querySelector('button[type="submit"]');
      if (!submit) return;
      var status = form.querySelector('[data-form-status]');
      var label = submit.textContent;
      var timer = null;
      function reset() {
        clearTimeout(timer);
        form.removeAttribute('data-sending');
        submit.disabled = false;
        submit.removeAttribute('aria-busy');
        submit.textContent = label;
        if (status) status.textContent = '';
      }
      form.addEventListener('submit', function (e) {
        if (form.hasAttribute('data-sending')) { e.preventDefault(); return; }
        form.setAttribute('data-sending', '');
        submit.disabled = true;
        submit.setAttribute('aria-busy', 'true');
        submit.textContent = t.sending;
        if (status) status.textContent = t.sendingStatus;
        // If the navigation never happens (blocked request, offline), give the form back.
        timer = setTimeout(reset, 15000);
      });
      // Back/forward cache restores the page as it was left: disabled. Undo that.
      window.addEventListener('pageshow', function (e) { if (e.persisted) reset(); });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var choice = readChoice();
    if (choice !== 'granted' && choice !== 'denied') showBanner();
    wireControls();
    wireForms();
  });
})();
