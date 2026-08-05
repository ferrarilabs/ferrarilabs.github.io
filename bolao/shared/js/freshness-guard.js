/**
 * freshness-guard.js — zero-stale-cache policy enforcement, shared by Copa2026, BR2026, and
 * CDB2026 (football-hardening checkpoint G — NOT Powerball, which is explicitly out of scope
 * for this branch; see CLAUDE.md and docs/bolao/FOOTBALL_HARDENING_INCIDENT_AUDIT.md).
 *
 * Note on history: an earlier attempt at this exact policy exists in git history as commit
 * d1e2130 ("wip(cache): freshness guard in progress") on the branch this repo's canonical
 * framework merge came from — it was deliberately left uncommitted-to-main because it also
 * touched Powerball (out of scope) and was incomplete (no build-version.json generator, no
 * index.html wiring, no tests). This file is written fresh, scoped only to the three in-scope
 * apps, reviewed against that draft for ideas but not copied from it.
 *
 * MUST be loaded with a plain synchronous <script> tag (no `defer`, no `type="module"`) as the
 * FIRST script in <head>, before any app CSS/JS — it needs to unregister a leftover service
 * worker and clear old caches before anything else touches the page, and each app's own
 * guardAdmin() calls window.FreshnessGuard.isConfirmedFreshForAdmin() before any admin write.
 *
 * How each app wires this in (index.html):
 *   <meta name="build-id" content="<hash from build-version.json, written by
 *        bolao/scripts/cachebust.mjs write>">
 *   <script src="../shared/js/freshness-guard.js"></script>
 *   ... (app CSS, then app JS) ...
 *
 * build-version.json is fetched RELATIVE TO THE CURRENT PAGE (same directory as index.html) —
 * each app has its own build-version.json in its own root, generated from that app's own
 * critical files' content hash (bolao/scripts/cachebust.mjs's existing computeAppTag() — this
 * checkpoint does not invent a second hash; it reuses the SAME tag already used for the `?v=`
 * cache-bust query string, so there is exactly one build-identity value per app, not two that
 * could drift from each other).
 */
(function () {
  "use strict";

  var SESSION_RELOAD_KEY = "__freshness_reload_done__";
  var REVALIDATE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  var BUILD_VERSION_PATH = "build-version.json";

  var state = {
    checked: false,       // has at least one real check completed (success or failure)?
    fresh: null,           // true = confirmed fresh, false = confirmed stale, null = unknown
    networkError: false,   // true = last check failed to reach the network at all
    embeddedBuildId: null,
    publishedBuildId: null,
  };

  function embeddedBuildId() {
    var meta = document.querySelector('meta[name="build-id"]');
    return meta ? meta.getAttribute("content") : null;
  }

  // ── 1. Legacy cache/service-worker cleanup — runs unconditionally, every load ────────────
  // Never registers a NEW service worker; only tears down whatever a returning visitor's
  // browser still has registered from before this policy existed (each app's own sw.js was
  // independently reduced to a self-unregistering kill switch as a second, redundant layer).
  function cleanupLegacyCaching() {
    try {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistrations().then(function (regs) {
          regs.forEach(function (r) { r.unregister().catch(function () {}); });
        }).catch(function () {});
      }
    } catch (e) { /* not fatal — best effort */ }

    try {
      if (window.caches && caches.keys) {
        caches.keys().then(function (keys) {
          keys.forEach(function (k) { caches.delete(k).catch(function () {}); });
        }).catch(function () {});
      }
    } catch (e) { /* not fatal — best effort */ }
  }

  // ── 2. Public-facing banner — self-contained, no dependency on each app's own toast system
  // (that CSS/JS hasn't loaded yet when this file runs). ────────────────────────────────────
  function showBanner(message, isError) {
    var id = "freshness-guard-banner";
    var existing = document.getElementById(id);
    if (existing) existing.remove();
    var el = document.createElement("div");
    el.id = id;
    el.setAttribute("role", "alert");
    el.style.cssText = [
      "position:fixed", "top:0", "left:0", "right:0", "z-index:2147483647",
      "padding:10px 16px", "font:600 13px/1.4 Inter,system-ui,-apple-system,sans-serif",
      "text-align:center",
      isError ? "background:#3d1520;color:#ffdbe1;" : "background:#2a1f00;color:#ffcc66;",
      "border-bottom:1px solid rgba(255,255,255,.15)",
    ].join(";");
    el.textContent = message;
    if (document.body) document.body.appendChild(el);
    else document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(el); });
  }

  // ── 3. Pure decision function — extracted so it's directly testable with synthetic inputs,
  // no DOM/fetch/sessionStorage needed (see test_zero_stale_cache.mjs). ────────────────────
  function decide(embeddedId, publishedId, alreadyReloadedForThisBuild) {
    if (!embeddedId || !publishedId) {
      return { fresh: null, action: "none" }; // can't compare — unknown, never treated as stale
    }
    if (embeddedId === publishedId) {
      return { fresh: true, action: "none" };
    }
    if (!alreadyReloadedForThisBuild) {
      return { fresh: false, action: "reload" };
    }
    return { fresh: false, action: "banner" }; // reloaded once already, still stale — stop looping
  }

  // ── 4. The actual freshness check (network + DOM + sessionStorage side effects) ──────────
  function checkFreshness() {
    var eid = embeddedBuildId();
    state.embeddedBuildId = eid;

    return fetch(BUILD_VERSION_PATH, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("build-version.json HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        state.checked = true;
        state.networkError = false;
        state.publishedBuildId = data && data.buildId ? data.buildId : null;

        var alreadyReloaded = sessionStorage.getItem(SESSION_RELOAD_KEY) === eid;
        var decision = decide(eid, state.publishedBuildId, alreadyReloaded);
        state.fresh = decision.fresh;

        if (decision.action === "reload") {
          cleanupLegacyCaching();
          try { sessionStorage.setItem(SESSION_RELOAD_KEY, eid); } catch (e) { /* ignore */ }
          var url = new URL(location.href);
          url.searchParams.set("_fresh", state.publishedBuildId);
          location.replace(url.toString());
        } else if (decision.action === "banner") {
          showBanner(
            "Uma nova versão desta página está disponível, mas não foi possível carregá-la automaticamente. Atualize a página manualmente (Cmd/Ctrl+Shift+R).",
            false
          );
        }
        return state;
      })
      .catch(function () {
        state.checked = true;
        state.networkError = true;
        state.fresh = null; // unknown, never treated as stale for the public site
        showBanner("Não foi possível confirmar a versão atual. Verifique sua conexão e tente novamente.", true);
        return state;
      });
  }

  // ── 5. Public API for each app's own guardAdmin() ─────────────────────────────────────────
  // Public pages treat "unknown" as NOT blocking (site must stay usable while the first check
  // is in flight, or briefly offline). Admin writes are stricter: never proceed unconfirmed.
  function isFreshOrUnknown() { return state.fresh !== false; }
  function isConfirmedFreshForAdmin() { return state.checked && state.fresh === true; }

  window.FreshnessGuard = {
    state: state,
    decide: decide, // exposed for tests — pure, no side effects
    checkNow: checkFreshness,
    isFreshOrUnknown: isFreshOrUnknown,
    isConfirmedFreshForAdmin: isConfirmedFreshForAdmin,
    showBanner: showBanner,
  };

  // ── 6. Wire up: load, focus regain, visibilitychange, every 5 min ────────────────────────
  cleanupLegacyCaching();
  checkFreshness();
  window.addEventListener("focus", checkFreshness);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) checkFreshness();
  });
  setInterval(checkFreshness, REVALIDATE_INTERVAL_MS);
})();
