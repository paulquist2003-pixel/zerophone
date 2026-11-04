// Zerophone filterlaag. Wordt bij documentStart in elke pagina geïnjecteerd,
// direct na `window.__SV_CONFIG = {...}` (de regels van het platform) en
// `window.__SV_ENV = {...}` (instellingen uit de app).
//
// Onderdelen:
//  1. CSS: verbergt navigatie-items en haalt "browsergevoel" weg
//  2. Tekstregels: verbergt bijv. "Voorgesteld voor jou"-posts (alleen nieuwe DOM-knopen)
//  3. Volgpoort: op profielen/posts van accounts die je niet volgt geen content
//  4. Videobewaking: in een reelviewer mag één video, doorswipen niet
//  5. Routes en klikken op geblokkeerde links doorgeven aan Swift
(function () {
  'use strict';
  var cfg = window.__SV_CONFIG;
  var env = window.__SV_ENV || {};
  if (!cfg || window.__SV_ACTIVE) return;
  window.__SV_ACTIVE = true;

  var THROTTLE_MS = 150;       // hooguit zo vaak nieuwe DOM verwerken
  var MAX_QUEUE = 300;         // daarboven één volledige ronde i.p.v. losse knopen
  var GATE_PENDING_MS = 2500;  // zo lang content verbergen zolang de volgstatus onbekend is
  var RECENT_MS = 400;         // "net nog in beeld" voor de videobewaking
  var POST_THROTTLE_MS = 1500;

  // ---------- hulpfuncties ----------

  function post(msg) {
    try { window.webkit.messageHandlers.sv.postMessage(msg); } catch (e) {}
  }

  function norm(path) {
    var p = (path || '/').toLowerCase();
    return p.charAt(p.length - 1) === '/' ? p : p + '/';
  }

  function startsWithAny(p, list) {
    if (!list) return false;
    for (var i = 0; i < list.length; i++) if (p.indexOf(list[i]) === 0) return true;
    return false;
  }

  function regexes(list) {
    return (list || []).map(function (s) { return new RegExp(s); });
  }

  function matchesAny(p, res) {
    for (var i = 0; i < res.length; i++) if (res[i].test(p)) return true;
    return false;
  }

  function toSet(list) {
    var s = {};
    (list || []).forEach(function (t) { s[t] = true; });
    return s;
  }

  // Zelfde volgorde als PlatformRules in Swift: redirect, uitzondering, blokkade.
  function classify(path) {
    var p = norm(path);
    if (cfg.redirects && cfg.redirects[p]) return { action: 'redirect', to: cfg.redirects[p] };
    if (startsWithAny(p, cfg.allowedPathPrefixes)) return { action: 'allow' };
    if (cfg.blockedExactPaths.indexOf(p) !== -1) return { action: 'block' };
    if (startsWithAny(p, cfg.blockedPathPrefixes)) return { action: 'block' };
    return { action: 'allow' };
  }
  window.__SV_classify = classify; // handig bij debuggen via Web Inspector

  // ---------- 1. CSS ----------

  var baseCss = [
    // Geen grijze flits bij tikken en geen iOS-menu of selectie bij lang drukken op links/knoppen.
    '*{-webkit-tap-highlight-color:transparent!important}',
    'a,img,video,button,[role="button"]{-webkit-touch-callout:none!important}',
    'a,img,button,[role="button"]{-webkit-user-select:none!important;user-select:none!important}'
  ];
  var staticCss = baseCss.concat(cfg.hideSelectors.map(function (s) {
    return s + '{display:none!important}';
  })).join('\n');

  function styleEl(id) {
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      (document.head || document.documentElement).appendChild(el);
    }
    return el;
  }

  function ensureStyle() {
    var el = styleEl('sv-style');
    if (el.textContent !== staticCss) el.textContent = staticCss;
  }

  // Geen pinch-zoom en geen automatisch inzoomen als je een DM typt.
  function lockZoom() {
    if (!env.lockZoom || !document.head) return;
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'viewport');
      document.head.appendChild(meta);
    }
    var current = meta.getAttribute('content') || '';
    var parts = {};
    var order = [];
    current.split(',').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i < 0) return;
      var k = kv.slice(0, i).trim().toLowerCase();
      if (!(k in parts)) order.push(k);
      parts[k] = kv.slice(i + 1).trim();
    });
    function set(k, v, onlyIfMissing) {
      if (onlyIfMissing && k in parts) return;
      if (!(k in parts)) order.push(k);
      parts[k] = v;
    }
    set('width', 'device-width', true);
    set('initial-scale', '1', true);
    set('maximum-scale', '1');
    set('user-scalable', 'no');
    var content = order.map(function (k) { return k + '=' + parts[k]; }).join(', ');
    if (content !== current) meta.setAttribute('content', content);
  }

  // ---------- 2. Tekstregels ----------

  var textIndex = {};
  cfg.textRules.forEach(function (rule) {
    rule.texts.forEach(function (t) {
      (textIndex[t] = textIndex[t] || []).push(rule.hideClosest);
    });
  });
  var hasTextRules = cfg.textRules.length > 0;

  function hideEl(el) {
    if (el && !el.hasAttribute('data-sv-hidden')) {
      el.setAttribute('data-sv-hidden', '1');
      el.style.setProperty('display', 'none', 'important');
    }
  }

  function checkText(node) {
    var value = node.nodeValue;
    if (!value || value.length > 80) return;
    var closest = textIndex[value.trim()];
    if (!closest || !node.parentElement) return;
    for (var i = 0; i < closest.length; i++) hideEl(node.parentElement.closest(closest[i]));
  }

  function applyTextRulesIn(root) {
    if (!hasTextRules || !root) return;
    if (root.nodeType === 3) { checkText(root); return; }
    if (root.nodeType !== 1) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) checkText(node);
  }

  // ---------- 3. Volgpoort ----------

  var fg = cfg.followGate || null;
  var fgRes = fg ? regexes(fg.pathPatterns) : [];
  var followSet = fg ? toSet(fg.followTexts) : {};
  var followedSet = fg ? toSet(fg.followedTexts) : {};
  var gate = { path: null, since: 0, lockKey: null, notified: null, timer: null };

  // 'stranger' (Volgen-knop), 'followed' (Volgend/Aangevraagd), 'self' (eigen profiel) of 'unknown'.
  function relationState() {
    if (fg.selfSelector && document.querySelector(fg.selfSelector)) return 'self';
    var buttons = document.querySelectorAll('button,[role="button"]');
    for (var i = 0; i < buttons.length; i++) {
      var t = (buttons[i].textContent || '').trim();
      if (!t || t.length > 30) continue;
      // De eerste relatieknop in de pagina hoort bij de kop van het profiel of de post;
      // "Volgen"-knoppen bij voorgestelde accounts staan daar altijd onder.
      if (followSet[t]) return 'stranger';
      if (followedSet[t]) return 'followed';
    }
    return 'unknown';
  }

  function lockCss(rawPath) {
    var m = rawPath.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
    var keep = m ? ':not([href*="/' + m[1] + '/"])' : '';
    var selectors = fg.hidePostLinks.map(function (s) { return s + keep; }).concat(fg.hideAlways);
    return selectors.join(',') + '{display:none!important}';
  }

  function setLock(rawPath) {
    var key = rawPath || null;
    if (key === gate.lockKey) return;
    gate.lockKey = key;
    styleEl('sv-lock').textContent = key ? lockCss(key) : '';
  }

  function updateFollowGate() {
    if (!fg) return;
    var raw = location.pathname;
    var p = norm(raw);
    if (startsWithAny(p, fg.exemptPathPrefixes) || !matchesAny(p, fgRes)) {
      gate.path = null;
      setLock(null);
      return;
    }
    if (gate.path !== raw) { gate.path = raw; gate.since = Date.now(); }

    var rel = relationState();
    if (rel === 'stranger') {
      setLock(raw);
      if (gate.notified !== raw) {
        gate.notified = raw;
        post({ type: 'notice', text: fg.message });
      }
    } else if (rel === 'followed' || rel === 'self') {
      setLock(null);
    } else if (Date.now() - gate.since < GATE_PENDING_MS) {
      // Kop nog niet geladen: content alvast verborgen houden, straks opnieuw kijken.
      setLock(raw);
      if (!gate.timer) {
        gate.timer = setTimeout(function () { gate.timer = null; updateFollowGate(); }, GATE_PENDING_MS + 50);
      }
    } else {
      setLock(null); // status blijft onbekend (andere taal?): niet alles dichtgooien
    }
  }

  // ---------- 4. Videobewaking ----------

  var vg = cfg.videoGuard || null;
  var vgPage = vg ? regexes(vg.pagePatterns) : [];
  var guard = { path: null, anchor: null, blocked: new WeakSet(), visible: new Set(), lastSeen: 0, lastPost: 0 };
  var observedVideos = new WeakSet();
  var io = null;

  // 'page': de hele pagina is een losse video (/reel/...): elke andere video is doorswipen.
  // 'overlay': in DM's opent een reel in een viewer; daar telt alleen doorswipen
  // vlak na de vorige video, niet de viewer sluiten en een andere reel openen.
  function guardMode() {
    var p = norm(location.pathname);
    if (startsWithAny(p, vg.exemptPathPrefixes)) return null;
    if (matchesAny(p, vgPage)) return 'page';
    if (startsWithAny(p, vg.overlayPathPrefixes)) return 'overlay';
    return null;
  }

  function resetGuardIfMoved() {
    if (guard.path === location.pathname) return;
    guard.path = location.pathname;
    guard.anchor = null;
    guard.blocked = new WeakSet();
    guard.visible = new Set();
    guard.lastSeen = 0;
  }

  // Alleen schermvullende video's tellen; voorvertoningen in een chat niet.
  function isTall(rect) {
    var h = window.innerHeight || document.documentElement.clientHeight || 0;
    return h > 0 && rect.height >= h * 0.5;
  }

  function guardedRecently() {
    var seen = false;
    guard.visible.forEach(function (v) {
      if (v.isConnected) seen = true; else guard.visible.delete(v);
    });
    return seen || Date.now() - guard.lastSeen < RECENT_MS;
  }

  function isHorizontalMove(rect) {
    var a = guard.anchor;
    if (!a || !a.isConnected) return false;
    var r = a.getBoundingClientRect();
    return Math.abs(rect.left - r.left) > Math.abs(rect.top - r.top);
  }

  function setAnchor(v) {
    guard.anchor = v;
    guard.blocked = new WeakSet();
    guard.visible = new Set([v]);
  }

  function stopVideo(v) {
    guard.blocked.add(v);
    guard.visible.add(v);
    try { v.pause(); } catch (e) {}
    v.muted = true;
    var a = guard.anchor;
    var leave = !(a && a.isConnected);
    if (!leave) {
      try { a.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
    }
    var now = Date.now();
    if (leave || now - guard.lastPost > POST_THROTTLE_MS) {
      guard.lastPost = now;
      post({ type: 'swipeBlocked', leave: leave });
    }
  }

  function consider(v, mode, rect) {
    if (v === guard.anchor) { guard.visible.add(v); return; }
    if (guard.blocked.has(v)) { stopVideo(v); return; }
    if (!guard.anchor) { setAnchor(v); return; }

    var swipe = mode === 'page' || (guard.anchor.isConnected && guardedRecently());
    if (swipe && isHorizontalMove(rect)) swipe = false; // opzij bladeren (carrousel) mag
    if (swipe) stopVideo(v); else setAnchor(v);
  }

  function onIntersect(entries) {
    var mode = guardMode();
    resetGuardIfMoved();
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var v = e.target;
      if (!e.isIntersecting || e.intersectionRatio === 0) {
        if (guard.visible.delete(v)) guard.lastSeen = Date.now();
        continue;
      }
      if (!mode || !isTall(e.boundingClientRect)) continue;
      if (e.intersectionRatio >= 0.6) consider(v, mode, e.boundingClientRect);
      else if (v === guard.anchor || guard.blocked.has(v)) guard.visible.add(v);
    }
  }

  function observeVideosIn(root) {
    if (!io || !root || root.nodeType !== 1) return;
    var list = root.tagName === 'VIDEO' ? [root] : root.getElementsByTagName('video');
    for (var i = 0; i < list.length; i++) {
      if (!observedVideos.has(list[i])) {
        observedVideos.add(list[i]);
        io.observe(list[i]);
      }
    }
  }

  if (vg) {
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(onIntersect, { threshold: [0, 0.6] });
    }
    // Vangnet als de zichtbaarheid gemist is: afspelen van een andere video.
    document.addEventListener('play', function (e) {
      var v = e.target;
      if (!v || v.tagName !== 'VIDEO') return;
      var mode = guardMode();
      if (!mode) return;
      resetGuardIfMoved();
      var rect = v.getBoundingClientRect();
      if (isTall(rect)) consider(v, mode, rect);
    }, true);
  }

  window.__SV_state = function () {
    return {
      path: location.pathname,
      gateLocked: gate.lockKey,
      relation: fg ? relationState() : null,
      guardMode: vg ? guardMode() : null,
      hasAnchor: !!guard.anchor
    };
  };

  // ---------- verwerking van DOM-wijzigingen ----------

  var queue = [];
  var fullPass = true;
  var timer = null;
  var lastFlush = 0;

  function enqueue(node) {
    if (fullPass) return;
    if (queue.length >= MAX_QUEUE) { fullPass = true; queue = []; return; }
    queue.push(node);
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(flush, Math.max(0, THROTTLE_MS - (Date.now() - lastFlush)));
  }

  function flush() {
    timer = null;
    lastFlush = Date.now();
    ensureStyle();
    lockZoom();
    if (fullPass) {
      if (document.body) {
        fullPass = false;
        queue = [];
        applyTextRulesIn(document.body);
        observeVideosIn(document.body);
      }
    } else {
      var roots = queue;
      queue = [];
      for (var i = 0; i < roots.length; i++) {
        if (!roots[i].isConnected) continue;
        applyTextRulesIn(roots[i]);
        observeVideosIn(roots[i]);
      }
    }
    report();
    updateFollowGate();
  }

  // ---------- 5. Routes en klikken ----------

  var lastReported = null;
  function report() {
    if (location.pathname === lastReported) return;
    lastReported = location.pathname;
    post({ type: 'route', path: location.pathname });
  }

  function onRouteChange() {
    report();
    updateFollowGate();
  }

  ['pushState', 'replaceState'].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      var result = original.apply(this, arguments);
      setTimeout(onRouteChange, 0);
      return result;
    };
  });
  window.addEventListener('popstate', function () { setTimeout(onRouteChange, 0); });

  // Klikken op geblokkeerde links al tegenhouden voordat de pagina wisselt.
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
  new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'characterData') {
        if (hasTextRules) checkText(r.target);
        continue;
      }
      for (var j = 0; j < r.addedNodes.length; j++) {
        var n = r.addedNodes[j];
        if (n.nodeType === 3) { if (hasTextRules) checkText(n); } else if (n.nodeType === 1) enqueue(n);
      }
    }
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener('DOMContentLoaded', function () { schedule(); report(); });
  report();
})();
