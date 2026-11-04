// Zerophone filterlaag. Wordt bij documentStart in elke pagina geïnjecteerd,
// direct na `window.__SV_CONFIG = {...}` (de regels van het platform).
(function () {
  'use strict';
  var cfg = window.__SV_CONFIG;
  if (!cfg || window.__SV_ACTIVE) return;
  window.__SV_ACTIVE = true;

  function post(msg) {
    try { window.webkit.messageHandlers.sv.postMessage(msg); } catch (e) {}
  }

  function norm(path) {
    var p = (path || '/').toLowerCase();
    return p.charAt(p.length - 1) === '/' ? p : p + '/';
  }

  // Zelfde volgorde als PlatformRules in Swift: redirect, uitzondering, blokkade.
  function classify(path) {
    var p = norm(path);
    if (cfg.redirects && cfg.redirects[p]) return { action: 'redirect', to: cfg.redirects[p] };
    var i;
    for (i = 0; i < cfg.allowedPathPrefixes.length; i++) {
      if (p.indexOf(cfg.allowedPathPrefixes[i]) === 0) return { action: 'allow' };
    }
    if (cfg.blockedExactPaths.indexOf(p) !== -1) return { action: 'block' };
    for (i = 0; i < cfg.blockedPathPrefixes.length; i++) {
      if (p.indexOf(cfg.blockedPathPrefixes[i]) === 0) return { action: 'block' };
    }
    return { action: 'allow' };
  }
  window.__SV_classify = classify; // handig bij debuggen via Web Inspector

  // 1. CSS: verberg navigatie-items en secties voordat ze getekend worden.
  var css = cfg.hideSelectors.map(function (s) {
    return s + '{display:none!important}';
  }).join('\n');

  function ensureStyle() {
    if (!css || document.getElementById('sv-style')) return;
    var el = document.createElement('style');
    el.id = 'sv-style';
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }

  // 2. Tekstregels: bijv. "Suggested for you" -> verberg het hele <article>.
  function applyTextRules() {
    if (!cfg.textRules.length || !document.body) return;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var text = (node.nodeValue || '').trim();
      if (!text || text.length > 60) continue;
      for (var i = 0; i < cfg.textRules.length; i++) {
        var rule = cfg.textRules[i];
        if (rule.texts.indexOf(text) === -1) continue;
        var parent = node.parentElement;
        var target = parent && parent.closest(rule.hideClosest);
        if (target && !target.hasAttribute('data-sv-hidden')) {
          target.setAttribute('data-sv-hidden', '1');
          target.style.setProperty('display', 'none', 'important');
        }
      }
    }
  }

  // De DOM verandert continu (oneindige feed); hooguit eens per 300 ms opnieuw toepassen.
  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(function () {
      pending = false;
      ensureStyle();
      applyTextRules();
    }, 300);
  }

  // 3. Routewissels in de single-page app doorgeven aan Swift.
  var lastReported = null;
  function report() {
    if (location.pathname === lastReported) return;
    lastReported = location.pathname;
    post({ type: 'route', path: location.pathname });
  }

  ['pushState', 'replaceState'].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      var result = original.apply(this, arguments);
      setTimeout(report, 0);
      return result;
    };
  });
  window.addEventListener('popstate', function () { setTimeout(report, 0); });

  // 4. Klikken op geblokkeerde links al tegenhouden voordat de pagina wisselt.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
    if (url.host !== location.host) return;
    var verdict = classify(url.pathname);
    if (verdict.action === 'allow') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (verdict.action === 'redirect') {
      location.assign(verdict.to);
    } else {
      post({ type: 'blockedClick', path: url.pathname });
    }
  }, true);

  ensureStyle();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', function () { schedule(); report(); });
  report();
})();
