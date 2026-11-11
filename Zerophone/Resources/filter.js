// Zerophone filterlaag. Wordt bij documentStart in elke pagina geïnjecteerd,
// direct na `window.__SV_CONFIG = {...}` (de regels van het platform) en
// `window.__SV_ENV = {...}` (instellingen uit de app).
//
// Onderdelen:
//  1. CSS: verbergt navigatie-items en haalt "browsergevoel" weg
//  2. Tekstregels: verbergt bijv. "Voorgesteld voor jou"-posts (alleen nieuwe DOM-knopen)
//  3. Volgpoort: op profielen/posts van accounts die je niet volgt geen content
//  4. Videobewaking: in een reelviewer mag één video, doorswipen niet
//     4b. Afscherming: scrollslot en maskeren, zodat de volgende video niet eens in beeld komt
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
  var LOCK_MIN_OVERLAY = 0.85; // in DM's alleen een (bijna) schermvullende viewer op slot zetten
  var MAX_DEPTH = 12;          // zo ver omhoog zoeken naar slides rond de geopende video
  var MIN_MOVE_PX = 4;         // kleinere vingerbewegingen zijn nog geen veeg

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

  // ---------- 2b. Feedfilter ----------
  // Op de hoofdfeed: verberg elke post met een Volgen-knop. Die post komt van een account
  // dat je niet volgt ("Aanbevolen voor jou" en dergelijke), ook als er geen label boven staat.

  var ff = cfg.feedFilter || null;
  var ffTexts = ff ? toSet(ff.followTexts) : {};
  var ffHidden = 0;
  var ffUnmatched = 0;

  function onFeed() {
    return !!ff && ff.feedPaths.indexOf(norm(location.pathname)) !== -1;
  }

  function checkFeedButton(btn) {
    var t = (btn.textContent || '').trim();
    if (!t || t.length > 30 || !ffTexts[t]) return;
    var post = btn.closest(ff.postSelector);
    // Geen post gevonden, of een container met meerdere posts erin: niets verbergen.
    if (!post || post.querySelector(ff.postSelector)) { ffUnmatched++; return; }
    if (!post.hasAttribute('data-sv-hidden')) { ffHidden++; hideEl(post); }
  }

  function applyFeedFilterIn(root) {
    if (!root || !onFeed()) return;
    if (root.nodeType === 3) root = root.parentElement;
    if (!root || root.nodeType !== 1) return;
    var sel = 'button,[role="button"]';
    if (root.matches && root.matches(sel)) checkFeedButton(root);
    var buttons = root.querySelectorAll(sel);
    for (var i = 0; i < buttons.length; i++) checkFeedButton(buttons[i]);
    if (root.closest) { var up = root.closest(sel); if (up && up !== root) checkFeedButton(up); }
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
    releaseProtection();
  }

  function viewportH() {
    return window.innerHeight || document.documentElement.clientHeight || 0;
  }

  // Alleen schermvullende video's tellen; voorvertoningen in een chat niet.
  function isTall(rect) {
    var h = viewportH();
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

  function setAnchor(v, mode) {
    guard.anchor = v;
    guard.blocked = new WeakSet();
    guard.visible = new Set([v]);
    applyProtection(mode);
  }

  function stopVideo(v) {
    guard.blocked.add(v);
    guard.visible.add(v);
    try { v.pause(); } catch (e) {}
    v.muted = true;
    var a = guard.anchor;
    var leave = !(a && a.isConnected);
    if (!leave) {
      if (prot.anchor === a) mask(slideOf(v));
      try { a.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
    }
    var now = Date.now();
    if (leave || now - guard.lastPost > POST_THROTTLE_MS) {
      guard.lastPost = now;
      post({ type: 'swipeBlocked', leave: leave });
    }
  }

  function consider(v, mode, rect) {
    if (v === guard.anchor) { guard.visible.add(v); applyProtection(mode); return; }
    if (guard.blocked.has(v)) { stopVideo(v); return; }
    if (!guard.anchor) { setAnchor(v, mode); return; }

    var swipe = mode === 'page' || (guard.anchor.isConnected && guardedRecently());
    if (swipe && isHorizontalMove(rect)) swipe = false; // opzij bladeren (carrousel) mag
    if (swipe) stopVideo(v); else setAnchor(v, mode);
  }

  function onIntersect(entries) {
    var mode = guardMode();
    resetGuardIfMoved();
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var v = e.target;
      if (!e.isIntersecting || e.intersectionRatio === 0) {
        if (guard.visible.delete(v)) guard.lastSeen = Date.now();
        // DM-viewer dicht of weggeveegd: afscherming na korte tijd opheffen.
        if (v === guard.anchor && mode === 'overlay') scheduleRelease();
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

  // ---------- 4b. Afscherming rond de geopende video ----------
  // Preventief, zodat de volgende video niet eens even in beeld komt:
  //  - scrollslot: de scrollcontainer van de geopende video kan niet verticaal scrollen
  //    (overflow dicht plus touchmove tegenhouden). In de DM-viewer mag de vinger omlaag
  //    (sluiten), alleen omhoog (volgende) is dicht. Een binnenvak dat zelf scrolt
  //    (bijv. reacties) blijft werken.
  //  - maskeren: andere video's en slides boven of onder de geopende video zijn onzichtbaar,
  //    niet aan te tikken en stil. Opzij (carrousel) blijft zichtbaar.
  // Het terugscrollen in stopVideo blijft het vangnet als dit toch lekt.

  var prot = { anchor: null, mode: null, lockEl: null, lockPrev: null, masked: [], releaseTimer: null };
  var touch = null;

  function canScrollY(el) {
    var cs;
    try { cs = window.getComputedStyle(el); } catch (e) { return false; }
    var o = cs && cs.overflowY;
    return (o === 'auto' || o === 'scroll' || o === 'overlay') && el.scrollHeight > el.clientHeight + 1;
  }

  function scrollContainerOf(v) {
    for (var el = v.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (canScrollY(el)) return el;
    }
    return null;
  }

  // Boven of onder de geopende video (niet ernaast) en niet op dezelfde plek.
  function verticallyApart(el, ar) {
    var r = el.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return false;
    var dy = Math.abs(r.top - ar.top);
    return dy > 1 && dy > Math.abs(r.left - ar.left);
  }

  // Binnen dit element blijft het maskeren: in DM's de viewer, op een reelpagina de hele pagina.
  function maskBound() {
    if (prot.lockEl && prot.lockEl !== document.documentElement && prot.lockEl !== document.body) return prot.lockEl;
    return prot.mode === 'page' ? document.body : null;
  }

  // Het grootste stuk rond v dat de geopende video niet bevat (de "slide" van v).
  function slideOf(v) {
    var a = prot.anchor;
    var bound = maskBound();
    if (!a || !bound || !bound.contains(v)) return v;
    var el = v;
    while (el.parentElement && el.parentElement !== bound && !el.parentElement.contains(a)) el = el.parentElement;
    return el;
  }

  function saveProp(el, name) {
    return { v: el.style.getPropertyValue(name), p: el.style.getPropertyPriority(name) };
  }

  function restoreProp(el, name, saved) {
    if (saved && saved.v) el.style.setProperty(name, saved.v, saved.p);
    else el.style.removeProperty(name);
  }

  function mask(el) {
    if (!el || el.nodeType !== 1 || el.hasAttribute('data-sv-masked')) return;
    if (prot.anchor && el.contains(prot.anchor)) return; // nooit de geopende video zelf
    el.setAttribute('data-sv-masked', '1');
    prot.masked.push({ el: el, vis: saveProp(el, 'visibility'), pe: saveProp(el, 'pointer-events') });
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
  }

  function unmaskAll() {
    prot.masked.forEach(function (m) {
      m.el.removeAttribute('data-sv-masked');
      restoreProp(m.el, 'visibility', m.vis);
      restoreProp(m.el, 'pointer-events', m.pe);
    });
    prot.masked = [];
  }

  function quiet(v) {
    try { if (!v.paused) v.pause(); } catch (e) {}
    v.muted = true;
    v.removeAttribute('autoplay');
    try { v.preload = 'none'; } catch (e) {}
  }

  // Slides zonder video (nog alleen een miniatuur): hoge broers boven of onder het anker.
  function maskSiblingSlides(ar) {
    var bound = maskBound();
    if (!bound) return;
    var h = viewportH();
    var el = prot.anchor;
    for (var d = 0; d < MAX_DEPTH && el && el !== bound; d++) {
      var parent = el.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;
      var sibs = parent.children;
      for (var i = 0; i < sibs.length; i++) {
        var s = sibs[i];
        if (s === el || s.contains(prot.anchor)) continue;
        if (s.getBoundingClientRect().height >= h * 0.5 && verticallyApart(s, ar)) mask(s);
      }
      if (parent === bound) break;
      el = parent;
    }
  }

  function refreshMasks() {
    var a = prot.anchor;
    if (!a || !a.isConnected) return;
    var ar = a.getBoundingClientRect();
    var vids = document.getElementsByTagName('video');
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      if (v === a) continue;
      if (prot.mode === 'overlay' && !isTall(v.getBoundingClientRect())) continue;
      if (!verticallyApart(v, ar)) continue;
      quiet(v);
      mask(slideOf(v));
    }
    maskSiblingSlides(ar);
  }

  function lockScroll(a, mode) {
    var c = scrollContainerOf(a);
    if (mode === 'overlay') {
      // Alleen een (bijna) schermvullende viewer; een hoge video in de chat zelf niet,
      // anders zou de chat niet meer scrollen.
      if (!c || a.getBoundingClientRect().height < viewportH() * LOCK_MIN_OVERLAY) return;
    } else if (!c) {
      c = document.scrollingElement || document.documentElement;
    }
    prot.lockEl = c;
    prot.lockPrev = { o: saveProp(c, 'overflow-y'), ob: saveProp(c, 'overscroll-behavior') };
    c.style.setProperty('overflow-y', 'hidden', 'important');
    c.style.setProperty('overscroll-behavior', 'none', 'important');
    listenTouches(true);
  }

  function applyProtection(mode) {
    var a = guard.anchor;
    if (!mode || !a || !a.isConnected) return;
    if (prot.releaseTimer) { clearTimeout(prot.releaseTimer); prot.releaseTimer = null; }
    if (prot.anchor !== a) {
      releaseProtection();
      prot.anchor = a;
      prot.mode = mode;
      lockScroll(a, mode);
    }
    refreshMasks();
  }

  function releaseProtection() {
    if (prot.releaseTimer) { clearTimeout(prot.releaseTimer); prot.releaseTimer = null; }
    if (prot.lockEl) {
      restoreProp(prot.lockEl, 'overflow-y', prot.lockPrev.o);
      restoreProp(prot.lockEl, 'overscroll-behavior', prot.lockPrev.ob);
      prot.lockEl = null;
      prot.lockPrev = null;
      listenTouches(false);
    }
    unmaskAll();
    prot.anchor = null;
    prot.mode = null;
    touch = null;
  }

  function scheduleRelease() {
    if (prot.releaseTimer || !prot.anchor) return;
    prot.releaseTimer = setTimeout(function () {
      prot.releaseTimer = null;
      if (guard.anchor && guard.visible.has(guard.anchor)) return;
      releaseProtection();
    }, RECENT_MS + 50);
  }

  // Na DOM-wijzigingen: nieuwe slides maskeren, of opheffen als de video weg is.
  function maintainProtection() {
    if (!prot.anchor) return;
    if (!prot.anchor.isConnected || !guardMode()) { releaseProtection(); return; }
    refreshMasks();
  }

  // Kan een binnenvak tussen el en stop zelf in deze richting scrollen (bijv. reacties)?
  function innerScrollable(el, stop, dy) {
    for (; el && el !== stop && el.nodeType === 1; el = el.parentElement) {
      if (!canScrollY(el)) continue;
      if (dy < 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
    }
    return false;
  }

  function onTouchStart(e) {
    var t = e.touches && e.touches[0];
    touch = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY, target: e.target } : null;
  }

  function onTouchMove(e) {
    var c = prot.lockEl;
    if (!c || !touch || !e.cancelable) return;
    if (!c.isConnected) { releaseProtection(); return; }
    var t = e.touches && e.touches[0];
    if (!t) return;
    var dx = t.clientX - touch.x;
    var dy = t.clientY - touch.y;
    if (Math.abs(dy) < MIN_MOVE_PX || Math.abs(dx) >= Math.abs(dy)) return; // horizontaal mag
    if (prot.mode === 'overlay' && dy > 0) return; // vinger omlaag: viewer sluiten mag
    var target = touch.target && touch.target.nodeType === 1 ? touch.target : (touch.target && touch.target.parentElement);
    if (!target || !c.contains(target)) return;
    if (innerScrollable(target, c, dy)) return;
    e.preventDefault();
  }

  // Alleen luisteren zolang er iets op slot zit: een niet-passieve touchmove maakt
  // scrollen elders (zoals de feed) anders trager.
  function listenTouches(on) {
    var f = on ? 'addEventListener' : 'removeEventListener';
    document[f]('touchstart', onTouchStart, { capture: true, passive: true });
    document[f]('touchmove', onTouchMove, { capture: true, passive: false });
  }

  window.__SV_state = function () {
    return {
      path: location.pathname,
      gateLocked: gate.lockKey,
      relation: fg ? relationState() : null,
      guardMode: vg ? guardMode() : null,
      hasAnchor: !!guard.anchor,
      scrollLocked: !!prot.lockEl,
      masked: prot.masked.length,
      feedFilter: ff ? { onFeed: onFeed(), hidden: ffHidden, unmatched: ffUnmatched } : null
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
        applyFeedFilterIn(document.body);
        observeVideosIn(document.body);
      }
    } else {
      var roots = queue;
      queue = [];
      for (var i = 0; i < roots.length; i++) {
        if (!roots[i].isConnected) continue;
        applyTextRulesIn(roots[i]);
        applyFeedFilterIn(roots[i]);
        observeVideosIn(roots[i]);
      }
    }
    report();
    updateFollowGate();
    maintainProtection();
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
    // Terug op de feed: bestaande posts opnieuw nalopen (Instagram hergebruikt soms de DOM).
    if (onFeed()) applyFeedFilterIn(document.body);
    // Andere pagina: slot en maskers direct eraf, anders blijft bijv. de feed op slot staan.
    if (vg) resetGuardIfMoved();
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
        if (ff) applyFeedFilterIn(r.target);
        continue;
      }
      for (var j = 0; j < r.addedNodes.length; j++) {
        var n = r.addedNodes[j];
        if (n.nodeType === 3) { if (hasTextRules) checkText(n); if (ff) applyFeedFilterIn(n); } else if (n.nodeType === 1) enqueue(n);
      }
    }
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener('DOMContentLoaded', function () { schedule(); report(); });
  report();
})();
