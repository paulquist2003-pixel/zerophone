'use strict';
// jsdom-test voor Zerophone/Resources/filter.js en rules.json.
// Gebruik: cd tests && npm ci && npm test
// (of: node filter.test.js [pad-naar-repo]; standaard de map boven tests/)
// Draait in GitHub Actions via .github/workflows/filtertest.yml.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const REPO = process.argv[2] || path.resolve(__dirname, '..');
const FILTER_JS = fs.readFileSync(path.join(REPO, 'Zerophone/Resources/filter.js'), 'utf8');
const RULES = JSON.parse(fs.readFileSync(path.join(REPO, 'Zerophone/Resources/rules.json'), 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

// ---------- omgeving ----------

function makeEnv({ platform = 'instagram', url, html = '', lockZoom = true, head = '' }) {
  const messages = [];
  const ios = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented/.test(String(e.message))) console.log('    jsdomError: ' + e.message); });
  const dom = new JSDOM(`<!doctype html><html><head>${head}</head><body>${html}</body></html>`, {
    url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
  });
  const w = dom.window;
  w.innerHeight = 800;
  w.webkit = { messageHandlers: { sv: { postMessage: (m) => messages.push(JSON.parse(JSON.stringify(m))) } } };
  w.IntersectionObserver = class {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.targets = new Set(); ios.push(this); }
    observe(el) { this.targets.add(el); }
    unobserve(el) { this.targets.delete(el); }
    disconnect() { this.targets.clear(); }
  };
  w.__SV_CONFIG = JSON.parse(JSON.stringify(RULES.platforms[platform]));
  w.__SV_ENV = { lockZoom };
  let walkers = 0;
  const origTW = w.document.createTreeWalker.bind(w.document);
  w.document.createTreeWalker = function () { walkers++; return origTW.apply(null, arguments); };
  w.eval(FILTER_JS);
  return {
    dom, w, d: w.document, messages, ios,
    walkers: () => walkers,
    byType: (t) => messages.filter((m) => m.type === t),
    // Eén IntersectionObserver-melding afvuren.
    fire(el, { visible = true, ratio = 1, rect } = {}) {
      const r = rect || el.getBoundingClientRect();
      ios[0].cb([{ target: el, isIntersecting: visible, intersectionRatio: visible ? ratio : 0, boundingClientRect: r }]);
    },
    go(p) { w.history.pushState({}, '', p); },
    close() { w.close(); },
  };
}

function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
}

function makeVideo(env, r) {
  const v = env.d.createElement('video');
  v.getBoundingClientRect = () => r;
  v.__paused = 0; v.__scrolled = 0;
  v.pause = () => { v.__paused++; };
  v.scrollIntoView = () => { v.__scrolled++; };
  return v;
}

function lockText(env) {
  const el = env.d.getElementById('sv-lock');
  return el ? el.textContent : '';
}

// ---------- tests ----------

async function testClassify() {
  console.log('\n[classify en klikken]');
  const env = makeEnv({ url: 'https://www.instagram.com/', html: '<a id="r" href="/reels/">Reels</a><a id="o" href="/alice/">x</a>' });
  await sleep(250);
  const c = env.w.__SV_classify;
  check('/reels/ geblokkeerd', c('/reels/').action === 'block');
  check('/explore/ -> redirect naar zoeken', c('/explore/').action === 'redirect' && c('/explore/').to === '/explore/search/');
  check('/explore/search/ toegestaan', c('/explore/search/').action === 'allow');
  check('/direct/inbox/ toegestaan', c('/direct/inbox/').action === 'allow');
  const ev = new env.w.MouseEvent('click', { bubbles: true, cancelable: true });
  env.d.getElementById('r').dispatchEvent(ev);
  check('klik op /reels/ tegengehouden', ev.defaultPrevented === true);
  check('blockedClick bericht', env.byType('blockedClick').length === 1 && env.byType('blockedClick')[0].path === '/reels/', env.messages);
  const ev2 = new env.w.MouseEvent('click', { bubbles: true, cancelable: true });
  env.d.getElementById('o').dispatchEvent(ev2);
  check('klik op gewoon profiel niet tegengehouden', ev2.defaultPrevented === false);
  check('route-bericht bij start', env.byType('route').some((m) => m.path === '/'), env.messages);
  env.close();
}

async function testTextRules() {
  console.log('\n[tekstregels op nieuwe knopen]');
  const env = makeEnv({
    url: 'https://www.instagram.com/',
    html: '<article id="a0"><span>Suggested for you</span></article><article id="keep"><span>Gewone post</span></article>',
  });
  await sleep(300);
  const d = env.d;
  check('bestaande "Suggested for you"-post verborgen bij eerste ronde', d.getElementById('a0').hasAttribute('data-sv-hidden'));
  check('gewone post blijft zichtbaar', !d.getElementById('keep').hasAttribute('data-sv-hidden'));

  const before = env.walkers();
  const art = d.createElement('article');
  art.id = 'a1';
  art.innerHTML = '<div><span>Voorgesteld voor jou</span></div><img>';
  d.body.appendChild(art);
  const art2 = d.createElement('article');
  art2.id = 'a2';
  art2.innerHTML = '<span>Gewoon bericht</span>';
  d.body.appendChild(art2);
  await sleep(300);
  check('nieuw toegevoegde NL-post verborgen', d.getElementById('a1').hasAttribute('data-sv-hidden') && d.getElementById('a1').style.display === 'none');
  check('nieuwe gewone post niet verborgen', !d.getElementById('a2').hasAttribute('data-sv-hidden'));
  const used = env.walkers() - before;
  check('alleen de nieuwe knopen doorlopen, niet de hele pagina (<= 2 walkers voor 2 knopen)', used >= 1 && used <= 2, used);

  // Tekst die later in een bestaande knoop verandert
  const span = d.createElement('span');
  const art3 = d.createElement('article');
  art3.id = 'a3';
  span.textContent = 'Laden';
  art3.appendChild(span);
  d.body.appendChild(art3);
  await sleep(300);
  span.firstChild.nodeValue = 'Suggested posts';
  await sleep(100);
  check('tekstwijziging (characterData) verbergt post', d.getElementById('a3').hasAttribute('data-sv-hidden'));

  // Een tekst die al verwerkt is, wordt niet bij elke flush opnieuw gescand
  const w0 = env.walkers();
  await sleep(500);
  check('geen periodieke volledige scan als er niets verandert', env.walkers() === w0, env.walkers() - w0);
  env.close();
}

async function testZoomLock() {
  console.log('\n[zoomlock]');
  let env = makeEnv({ url: 'https://www.instagram.com/', head: '<meta name="viewport" content="width=device-width, initial-scale=1">', lockZoom: true });
  await sleep(300);
  let content = env.d.querySelector('meta[name=viewport]').getAttribute('content');
  check('bestaande viewport: maximum-scale=1', /maximum-scale=1/.test(content), content);
  check('bestaande viewport: user-scalable=no', /user-scalable=no/.test(content), content);
  check('bestaande viewport: width en initial-scale blijven', /width=device-width/.test(content) && /initial-scale=1/.test(content), content);
  env.close();

  env = makeEnv({ url: 'https://www.instagram.com/', head: '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes">', lockZoom: true });
  await sleep(300);
  content = env.d.querySelector('meta[name=viewport]').getAttribute('content');
  check('maximum-scale=5 en user-scalable=yes worden overschreven', /maximum-scale=1/.test(content) && /user-scalable=no/.test(content) && !/maximum-scale=5/.test(content) && !/user-scalable=yes/.test(content), content);
  env.close();

  env = makeEnv({ url: 'https://www.instagram.com/', lockZoom: true });
  await sleep(300);
  const meta = env.d.querySelector('meta[name=viewport]');
  check('ontbrekende viewport wordt aangemaakt', !!meta && /user-scalable=no/.test(meta.getAttribute('content')), meta && meta.outerHTML);
  env.close();

  env = makeEnv({ url: 'https://www.instagram.com/', head: '<meta name="viewport" content="width=device-width, initial-scale=1">', lockZoom: false });
  await sleep(300);
  content = env.d.querySelector('meta[name=viewport]').getAttribute('content');
  check('lockZoom false: viewport ongemoeid', content === 'width=device-width, initial-scale=1', content);
  env.close();
}

function gateEnv(p, html) {
  return makeEnv({ url: 'https://www.instagram.com' + p, html });
}

async function testFollowGate() {
  console.log('\n[volgpoort]');
  const posts = '<a href="/p/AAA/"><img></a><a href="/reel/BBB/"><img></a><a href="/stories/x/">s</a>';

  // Volgen -> dicht
  let env = gateEnv('/alice/', '<header><h2>alice</h2><button>Volgen</button></header>' + posts);
  await sleep(350);
  let css = lockText(env);
  check('Volgen-knop: sv-lock gevuld', /display:none!important/.test(css) && /a\[href\*='\/p\/'\]/.test(css), css);
  check('Volgen-knop: notice met de melding', env.byType('notice').length === 1 && env.byType('notice')[0].code === 'followGate' && !('text' in env.byType('notice')[0]), env.messages);
  check('state: relation stranger en gateLocked gezet', env.w.__SV_state().relation === 'stranger' && env.w.__SV_state().gateLocked === '/alice/', env.w.__SV_state());
  await sleep(200);
  check('notice wordt niet herhaald voor dezelfde pagina', env.byType('notice').length === 1, env.byType('notice').length);
  // Echt effect: de selectors raken de postlinks
  const sel = css.slice(0, css.lastIndexOf('{'));
  check('verbergselectors raken postlinks en stories', env.d.querySelectorAll(sel).length === 3, env.d.querySelectorAll(sel).length);
  env.close();

  // Engelse tekst
  env = gateEnv('/bob/', '<button>Follow</button>' + posts);
  await sleep(350);
  check('Follow (EN): dicht', lockText(env) !== '');
  env.close();

  // Volgend -> open
  env = gateEnv('/carol/', '<header><button>Volgend</button></header>' + posts);
  await sleep(350);
  check('Volgend: sv-lock leeg', lockText(env) === '', lockText(env));
  check('Volgend: geen notice', env.byType('notice').length === 0);
  check('state: relation followed', env.w.__SV_state().relation === 'followed');
  env.close();

  for (const t of ['Aangevraagd', 'Following', 'Requested']) {
    env = gateEnv('/dave/', `<button>${t}</button>` + posts);
    await sleep(350);
    check(`${t}: sv-lock leeg`, lockText(env) === '', lockText(env));
    env.close();
  }

  // Eigen profiel
  env = gateEnv('/me/', '<a href="/accounts/edit/">Profiel bewerken</a>' + posts);
  await sleep(350);
  check('eigen profiel (selfSelector): sv-lock leeg', lockText(env) === '' && env.w.__SV_state().relation === 'self', env.w.__SV_state());
  env.close();
  env = gateEnv('/me/', '<div><button>Profiel bewerken</button></div>' + posts);
  await sleep(350);
  check('eigen profiel (knoptekst Profiel bewerken): sv-lock leeg', lockText(env) === '', lockText(env));
  env.close();

  // Eerste relatieknop wint: voorgestelde accounts onderaan hebben Volgen
  env = gateEnv('/erin/', '<header><button>Volgend</button></header><section><button>Volgen</button></section>' + posts);
  await sleep(350);
  check('eerste relatieknop wint (Volgend voor Volgen)', lockText(env) === '' && env.w.__SV_state().relation === 'followed', env.w.__SV_state());
  env.close();

  // Huidige shortcode op /p/X/ blijft zichtbaar
  env = gateEnv('/p/XYZ123/', '<header><button>Volgen</button></header><a id="cur" href="/p/XYZ123/"><img></a><a id="oth" href="/p/OTHER99/"><img></a><a id="oth2" href="/reel/QQQ/"><img></a>');
  await sleep(350);
  css = lockText(env);
  const sel2 = css.slice(0, css.lastIndexOf('{'));
  check('/p/X/: sv-lock gevuld', css !== '', css);
  check('/p/X/: huidige post blijft zichtbaar', !env.d.getElementById('cur').matches(sel2));
  check('/p/X/: andere post verborgen', env.d.getElementById('oth').matches(sel2));
  check('/p/X/: andere reel verborgen', env.d.getElementById('oth2').matches(sel2));
  env.close();

  // /user/p/X/ en /user/reel/X/
  env = gateEnv('/frank/reel/RRR1/', '<button>Volgen</button><a id="cur" href="/frank/reel/RRR1/">x</a><a id="oth" href="/frank/reel/RRR2/">y</a>');
  await sleep(350);
  css = lockText(env);
  const sel3 = css.slice(0, css.lastIndexOf('{'));
  check('/user/reel/X/: huidige blijft, andere verborgen', css !== '' && !env.d.getElementById('cur').matches(sel3) && env.d.getElementById('oth').matches(sel3), css);
  env.close();

  // Vrijgestelde paden
  for (const p of ['/direct/inbox/', '/explore/search/', '/stories/alice/123/', '/accounts/edit/']) {
    env = gateEnv(p, '<button>Volgen</button>' + posts);
    await sleep(300);
    check(`vrijgesteld ${p}: sv-lock leeg, geen notice`, lockText(env) === '' && env.byType('notice').length === 0, { css: lockText(env), msgs: env.messages });
    env.close();
  }

  // SPA-navigatie: van vreemd profiel naar DM's -> poort gaat open
  env = gateEnv('/alice/', '<button>Volgen</button>' + posts);
  await sleep(350);
  check('SPA: begint dicht', lockText(env) !== '');
  env.go('/direct/inbox/');
  await sleep(100);
  check('SPA: naar /direct/ -> poort open', lockText(env) === '', lockText(env));
  env.close();

  // Onbekende status: eerst dicht, daarna (na 2,5 s) open zodat niet alles dichtgaat
  env = gateEnv('/gina/', posts);
  await sleep(400);
  check('onbekend: tijdelijk dicht (kop nog niet geladen)', lockText(env) !== '' && env.w.__SV_state().relation === 'unknown', env.w.__SV_state());
  await sleep(2400);
  check('onbekend: na 2,5 s weer open', lockText(env) === '', lockText(env));
  env.close();

  // Kop laadt laat in: Volgend verschijnt tijdens de wachttijd -> open
  env = gateEnv('/hans/', posts);
  await sleep(300);
  check('late kop: eerst dicht', lockText(env) !== '');
  const b = env.d.createElement('button'); b.textContent = 'Volgend'; env.d.body.appendChild(b);
  await sleep(400);
  check('late kop: Volgend verschijnt -> open', lockText(env) === '', lockText(env));
  env.close();

  // Platformen zonder followGate (Snapchat) krijgen geen lock
  env = makeEnv({ platform: 'snapchat', url: 'https://www.snapchat.com/web', html: '<button>Volgen</button>', lockZoom: false });
  await sleep(300);
  check('Snapchat: geen followGate -> geen sv-lock', env.d.getElementById('sv-lock') === null);
  env.close();
}

async function testVideoGuard() {
  console.log('\n[videobewaking]');

  // --- pagina /reel/A/: tweede hoge video -> pause + swipeBlocked
  let env = makeEnv({ url: 'https://www.instagram.com/reel/A/', html: '' });
  const A = makeVideo(env, rect(0, 0, 400, 800));
  const B = makeVideo(env, rect(0, 800, 400, 800));
  env.d.body.appendChild(A); env.d.body.appendChild(B);
  await sleep(350);
  check('video\'s worden geobserveerd', env.ios[0] && env.ios[0].targets.has(A) && env.ios[0].targets.has(B));
  env.fire(A);
  check('eerste video wordt anker, geen bericht', env.byType('swipeBlocked').length === 0 && env.w.__SV_state().hasAnchor === true, env.messages);
  check('state: guardMode page', env.w.__SV_state().guardMode === 'page');
  env.fire(B);
  check('tweede hoge video: pause aangeroepen', B.__paused === 1, B.__paused);
  check('tweede hoge video: gedempt', B.muted === true);
  check('tweede hoge video: swipeBlocked leave:false', env.byType('swipeBlocked').length === 1 && env.byType('swipeBlocked')[0].leave === false, env.messages);
  check('terugscrollen naar anker', A.__scrolled === 1, A.__scrolled);
  env.fire(B);
  check('zelfde geblokkeerde video opnieuw: weer gepauzeerd, bericht gethrottled', B.__paused === 2 && env.byType('swipeBlocked').length === 1, { p: B.__paused, n: env.byType('swipeBlocked').length });
  env.close();

  // --- pagina: video op ratio < 0.6 telt niet
  env = makeEnv({ url: 'https://www.instagram.com/reel/A/', html: '' });
  const A2 = makeVideo(env, rect(0, 0, 400, 800));
  const B2 = makeVideo(env, rect(0, 700, 400, 800));
  env.d.body.appendChild(A2); env.d.body.appendChild(B2);
  await sleep(350);
  env.fire(A2);
  env.fire(B2, { ratio: 0.3 });
  check('video met ratio 0,3 wordt genegeerd', B2.__paused === 0 && env.byType('swipeBlocked').length === 0, env.messages);
  env.close();

  // --- pagina: horizontaal (carrousel) mag
  env = makeEnv({ url: 'https://www.instagram.com/reel/A/', html: '' });
  const A3 = makeVideo(env, rect(0, 0, 400, 800));
  const B3 = makeVideo(env, rect(400, 0, 400, 800));
  env.d.body.appendChild(A3); env.d.body.appendChild(B3);
  await sleep(350);
  env.fire(A3);
  env.fire(B3);
  check('horizontaal opzij: toegestaan', B3.__paused === 0 && env.byType('swipeBlocked').length === 0, env.messages);
  env.close();

  // --- pagina: lage voorvertoning (niet schermvullend) telt niet
  env = makeEnv({ url: 'https://www.instagram.com/reel/A/', html: '' });
  const A4 = makeVideo(env, rect(0, 0, 400, 800));
  const small = makeVideo(env, rect(0, 900, 300, 200));
  env.d.body.appendChild(A4); env.d.body.appendChild(small);
  await sleep(350);
  env.fire(A4);
  env.fire(small);
  check('lage voorvertoning (200px) genegeerd', small.__paused === 0 && env.byType('swipeBlocked').length === 0, env.messages);
  env.close();

  // --- pagina: anker verdwenen -> leave:true
  env = makeEnv({ url: 'https://www.instagram.com/reel/A/', html: '' });
  const A5 = makeVideo(env, rect(0, 0, 400, 800));
  const B5 = makeVideo(env, rect(0, 800, 400, 800));
  env.d.body.appendChild(A5); env.d.body.appendChild(B5);
  await sleep(350);
  env.fire(A5);
  A5.remove();
  env.fire(B5);
  check('anker weg + nieuwe video: swipeBlocked leave:true', env.byType('swipeBlocked').length === 1 && env.byType('swipeBlocked')[0].leave === true, env.messages);
  env.close();

  // --- play-vangnet
  env = makeEnv({ url: 'https://www.instagram.com/reel/A/', html: '' });
  const A6 = makeVideo(env, rect(0, 0, 400, 800));
  const B6 = makeVideo(env, rect(0, 800, 400, 800));
  env.d.body.appendChild(A6); env.d.body.appendChild(B6);
  await sleep(350);
  env.fire(A6);
  B6.dispatchEvent(new env.w.Event('play'));
  check('play-event van andere hoge video: pause + swipeBlocked', B6.__paused === 1 && env.byType('swipeBlocked').length === 1, { p: B6.__paused, m: env.messages });
  env.close();

  // --- /direct/: overlay
  // (a) andere reel openen na > 400 ms zonder zichtbaarheid -> toegestaan
  env = makeEnv({ url: 'https://www.instagram.com/direct/t/123/', html: '' });
  const V1 = makeVideo(env, rect(0, 0, 400, 800));
  const V2 = makeVideo(env, rect(0, 0, 400, 800));
  env.d.body.appendChild(V1); env.d.body.appendChild(V2);
  await sleep(350);
  check('/direct/: guardMode overlay', env.w.__SV_state().guardMode === 'overlay', env.w.__SV_state());
  env.fire(V1);
  check('/direct/: eerste reel wordt anker, geen bericht', env.byType('swipeBlocked').length === 0 && env.w.__SV_state().hasAnchor);
  env.fire(V1, { visible: false });   // viewer dicht
  await sleep(450);
  env.fire(V2);
  check('/direct/: andere reel openen na >400 ms -> toegestaan', V2.__paused === 0 && env.byType('swipeBlocked').length === 0, env.messages);
  env.close();

  // (b) direct doorswipen (vorige video net uit beeld, < 400 ms) -> geblokkeerd
  env = makeEnv({ url: 'https://www.instagram.com/direct/t/123/', html: '' });
  const W1 = makeVideo(env, rect(0, 0, 400, 800));
  const W2 = makeVideo(env, rect(0, 800, 400, 800));
  env.d.body.appendChild(W1); env.d.body.appendChild(W2);
  await sleep(350);
  env.fire(W1);
  env.fire(W1, { visible: false });
  await sleep(100);
  env.fire(W2);
  check('/direct/: doorswipen binnen 400 ms -> pause + swipeBlocked', W2.__paused === 1 && env.byType('swipeBlocked').length === 1, env.messages);
  env.close();

  // (c) tweede video terwijl de eerste nog in beeld is -> geblokkeerd
  env = makeEnv({ url: 'https://www.instagram.com/direct/t/123/', html: '' });
  const X1 = makeVideo(env, rect(0, 0, 400, 800));
  const X2 = makeVideo(env, rect(0, 800, 400, 800));
  env.d.body.appendChild(X1); env.d.body.appendChild(X2);
  await sleep(350);
  env.fire(X1);
  env.fire(X2);
  check('/direct/: tweede video naast zichtbare eerste -> geblokkeerd', X2.__paused === 1 && env.byType('swipeBlocked').length === 1, env.messages);
  env.close();

  // (d) horizontaal in /direct/ -> toegestaan
  env = makeEnv({ url: 'https://www.instagram.com/direct/t/123/', html: '' });
  const H1 = makeVideo(env, rect(0, 0, 400, 800));
  const H2 = makeVideo(env, rect(400, 0, 400, 800));
  env.d.body.appendChild(H1); env.d.body.appendChild(H2);
  await sleep(350);
  env.fire(H1);
  env.fire(H2);
  check('/direct/: horizontaal -> toegestaan', H2.__paused === 0 && env.byType('swipeBlocked').length === 0, env.messages);
  env.close();

  // --- vrijgesteld /stories/ en gewone feed
  for (const p of ['/stories/alice/123/', '/', '/alice/']) {
    env = makeEnv({ url: 'https://www.instagram.com' + p, html: '' });
    const S1 = makeVideo(env, rect(0, 0, 400, 800));
    const S2 = makeVideo(env, rect(0, 800, 400, 800));
    env.d.body.appendChild(S1); env.d.body.appendChild(S2);
    await sleep(350);
    env.fire(S1); env.fire(S2);
    check(`${p}: geen bewaking (guardMode null)`, env.w.__SV_state().guardMode === null && S2.__paused === 0 && env.byType('swipeBlocked').length === 0, { s: env.w.__SV_state(), m: env.messages });
    env.close();
  }

  // --- paginawissel reset anker (SPA): na pushState naar andere reel is de eerste video weer anker
  env = makeEnv({ url: 'https://www.instagram.com/reel/A/', html: '' });
  const P1 = makeVideo(env, rect(0, 0, 400, 800));
  env.d.body.appendChild(P1);
  await sleep(350);
  env.fire(P1);
  env.go('/reel/B/');
  const P2 = makeVideo(env, rect(0, 0, 400, 800));
  env.d.body.appendChild(P2);
  await sleep(300);
  env.fire(P2);
  check('SPA-navigatie naar andere reel: nieuwe pagina krijgt eigen anker (geen swipeBlocked)', env.byType('swipeBlocked').length === 0 && P2.__paused === 0, env.messages);
  env.close();

  // --- Snapchat: /spotlight/xyz/ is page-mode
  env = makeEnv({ platform: 'snapchat', url: 'https://www.snapchat.com/spotlight/abc123/', html: '', lockZoom: false });
  const Q1 = makeVideo(env, rect(0, 0, 400, 800));
  const Q2 = makeVideo(env, rect(0, 800, 400, 800));
  env.d.body.appendChild(Q1); env.d.body.appendChild(Q2);
  await sleep(350);
  env.fire(Q1); env.fire(Q2);
  check('Snapchat /spotlight/x/: doorswipen geblokkeerd', Q2.__paused === 1 && env.byType('swipeBlocked').length === 1, env.messages);
  env.close();
}

// ---------- afscherming: scrollslot en maskeren ----------

function withRect(el, r) {
  el.getBoundingClientRect = () => r;
  return el;
}

// Maakt een element dat zich als scrollcontainer gedraagt (jsdom rekent geen layout uit).
function scroller(env, id, { scrollHeight = 2400, clientHeight = 800, scrollTop = 0, r = rect(0, 0, 400, 800) } = {}) {
  const el = env.d.createElement('div');
  el.id = id;
  el.style.overflowY = 'auto';
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  el.scrollTop = scrollTop;
  return withRect(el, r);
}

function slide(env, id, r) {
  const el = env.d.createElement('div');
  el.id = id;
  return withRect(el, r);
}

function swipe(env, target, dx, dy) {
  const start = new env.w.Event('touchstart', { bubbles: true, cancelable: true });
  start.touches = [{ clientX: 200, clientY: 400 }];
  target.dispatchEvent(start);
  const move = new env.w.Event('touchmove', { bubbles: true, cancelable: true });
  move.touches = [{ clientX: 200 + dx, clientY: 400 + dy }];
  target.dispatchEvent(move);
  return move.defaultPrevented;
}

function isMasked(el) {
  return el.getAttribute('data-sv-masked') === '1' && el.style.getPropertyValue('visibility') === 'hidden' && el.style.getPropertyValue('pointer-events') === 'none';
}

// Reelpagina met een scrollcontainer en drie slides: anker, volgende video, miniatuur zonder video.
async function reelPage(url = 'https://www.instagram.com/reel/A/', platform = 'instagram') {
  const env = makeEnv({ platform, url, html: '', lockZoom: platform === 'instagram' });
  const sc = scroller(env, 'sc');
  const s1 = slide(env, 's1', rect(0, 0, 400, 800));
  const s2 = slide(env, 's2', rect(0, 800, 400, 800));
  const s3 = slide(env, 's3', rect(0, 1600, 400, 800));
  const A = makeVideo(env, rect(0, 0, 400, 800));
  const B = makeVideo(env, rect(0, 800, 400, 800));
  s1.appendChild(A); s2.appendChild(B); s3.appendChild(env.d.createElement('img'));
  sc.append(s1, s2, s3);
  env.d.body.appendChild(sc);
  await sleep(350);
  env.fire(A);
  return { env, sc, s1, s2, s3, A, B };
}

async function testProtection() {
  console.log('\n[afscherming: scrollslot en maskeren]');

  // --- reelpagina met scrollcontainer
  let { env, sc, s1, s2, s3, A, B } = await reelPage();
  check('reel: scrollcontainer op slot (overflow-y hidden !important)', sc.style.getPropertyValue('overflow-y') === 'hidden' && sc.style.getPropertyPriority('overflow-y') === 'important', sc.getAttribute('style'));
  check('reel: overscroll-behavior none', sc.style.getPropertyValue('overscroll-behavior') === 'none');
  check('reel: state scrollLocked', env.w.__SV_state().scrollLocked === true, env.w.__SV_state());
  check('reel: slide met volgende video gemaskeerd (onzichtbaar, niet aan te tikken)', isMasked(s2), s2.getAttribute('style'));
  check('reel: slide met alleen miniatuur ook gemaskeerd', isMasked(s3), s3.getAttribute('style'));
  check('reel: slide van de geopende video niet gemaskeerd', !s1.hasAttribute('data-sv-masked') && !A.hasAttribute('data-sv-masked'));
  check('reel: volgende video stil (gedempt, preload none, geen pause-aanroep nodig)', B.muted === true && B.preload === 'none' && B.__paused === 0, { m: B.muted, p: B.preload, n: B.__paused });
  check('reel: geopende video niet gedempt', A.muted === false);
  check('reel: geen swipeBlocked-bericht door alleen maskeren', env.byType('swipeBlocked').length === 0, env.messages);

  check('reel: veeg omhoog (volgende) tegengehouden', swipe(env, A, 0, -60) === true);
  check('reel: veeg omlaag ook tegengehouden', swipe(env, A, 0, 60) === true);
  check('reel: opzij vegen mag', swipe(env, A, -80, -10) === false);
  check('reel: heel kleine beweging (tik) niet tegengehouden', swipe(env, A, 0, -2) === false);

  // Binnenvak dat zelf scrolt (reacties) blijft werken
  const comments = scroller(env, 'comments', { scrollHeight: 1200, clientHeight: 300, r: rect(0, 500, 400, 300) });
  const line = env.d.createElement('p'); comments.appendChild(line);
  s1.appendChild(comments);
  check('reel: scrollend binnenvak (reacties) mag scrollen', swipe(env, line, 0, -60) === false);
  comments.scrollTop = 900; // onderaan
  check('reel: binnenvak onderaan -> veeg omhoog weer tegengehouden', swipe(env, line, 0, -60) === true);

  // Later toegevoegde slide wordt ook gemaskeerd
  const s4 = slide(env, 's4', rect(0, 2400, 400, 800));
  const C = makeVideo(env, rect(0, 2400, 400, 800));
  s4.appendChild(C); sc.appendChild(s4);
  await sleep(250);
  check('reel: later geladen slide gemaskeerd', isMasked(s4) && C.muted === true, s4.getAttribute('style'));

  // Vangnet blijft: als de volgende video toch in beeld komt
  env.fire(B);
  check('reel: vangnet blijft (pause + swipeBlocked + terugscrollen)', B.__paused === 1 && env.byType('swipeBlocked').length === 1 && A.__scrolled === 1, { p: B.__paused, m: env.messages, s: A.__scrolled });

  // Andere pagina: alles eraf
  env.go('/');
  await sleep(50);
  check('naar feed: slot eraf (eigen overflow-y auto terug)', sc.style.getPropertyValue('overflow-y') === 'auto' && sc.style.getPropertyPriority('overflow-y') === '' && sc.style.getPropertyValue('overscroll-behavior') === '', sc.getAttribute('style'));
  check('naar feed: maskers eraf', !s2.hasAttribute('data-sv-masked') && s2.style.getPropertyValue('visibility') === '' && s3.style.getPropertyValue('pointer-events') === '' && !s4.hasAttribute('data-sv-masked'));
  check('naar feed: state ontgrendeld', env.w.__SV_state().scrollLocked === false && env.w.__SV_state().masked === 0, env.w.__SV_state());
  check('naar feed: vegen niet meer tegengehouden (luisteraar weg)', swipe(env, A, 0, -60) === false);
  env.close();

  // --- bestaande inline stijl wordt hersteld
  ({ env, sc, s2 } = await (async () => {
    const env = makeEnv({ url: 'https://www.instagram.com/reel/A/', html: '' });
    const sc = scroller(env, 'sc');
    const s1 = slide(env, 's1', rect(0, 0, 400, 800));
    const s2 = slide(env, 's2', rect(0, 800, 400, 800));
    s2.style.setProperty('visibility', 'visible');
    const A = makeVideo(env, rect(0, 0, 400, 800));
    const B = makeVideo(env, rect(0, 800, 400, 800));
    s1.appendChild(A); s2.appendChild(B); sc.append(s1, s2);
    env.d.body.appendChild(sc);
    await sleep(350);
    env.fire(A);
    return { env, sc, s2 };
  })());
  check('eigen inline stijl: tijdens slot overschreven', s2.style.getPropertyValue('visibility') === 'hidden');
  env.go('/alice/');
  await sleep(50);
  check('eigen inline stijl: na vrijgeven terug naar visible', s2.style.getPropertyValue('visibility') === 'visible', s2.getAttribute('style'));
  env.close();

  // --- reelpagina zonder herkenbare scrollcontainer: hele pagina op slot
  env = makeEnv({ url: 'https://www.instagram.com/reel/A/', html: '' });
  A = makeVideo(env, rect(0, 0, 400, 800));
  B = makeVideo(env, rect(0, 800, 400, 800));
  env.d.body.append(A, B);
  await sleep(350);
  env.fire(A);
  const root = env.d.documentElement;
  check('geen container: documentElement op slot', root.style.getPropertyValue('overflow-y') === 'hidden', root.getAttribute('style'));
  check('geen container: volgende video zelf gemaskeerd', isMasked(B));
  check('geen container: body niet gemaskeerd', !env.d.body.hasAttribute('data-sv-masked'));
  env.go('/');
  await sleep(50);
  check('geen container: na verlaten weer los', root.style.getPropertyValue('overflow-y') === '', root.getAttribute('style'));
  env.close();

  // --- gedeelde wrapper: nooit iets maskeren dat de geopende video bevat
  env = makeEnv({ url: 'https://www.instagram.com/reel/A/', html: '' });
  sc = scroller(env, 'sc');
  const wrap = slide(env, 'wrap', rect(0, 0, 400, 1600));
  A = makeVideo(env, rect(0, 0, 400, 800));
  B = makeVideo(env, rect(0, 800, 400, 800));
  wrap.append(A, B); sc.appendChild(wrap); env.d.body.appendChild(sc);
  await sleep(350);
  env.fire(A);
  check('gedeelde wrapper: wrapper niet gemaskeerd, volgende video wel', !wrap.hasAttribute('data-sv-masked') && isMasked(B) && !A.hasAttribute('data-sv-masked'));
  env.close();

  // --- carrousel: video ernaast blijft zichtbaar
  env = makeEnv({ url: 'https://www.instagram.com/reel/A/', html: '' });
  A = makeVideo(env, rect(0, 0, 400, 800));
  B = makeVideo(env, rect(400, 0, 400, 800));
  env.d.body.append(A, B);
  await sleep(350);
  env.fire(A);
  check('carrousel: video ernaast niet gemaskeerd en niet gedempt', !B.hasAttribute('data-sv-masked') && B.muted === false);
  env.close();

  // --- DM-viewer (schermvullend, eigen scrollcontainer)
  env = makeEnv({ url: 'https://www.instagram.com/direct/t/123/', html: '' });
  const chat = scroller(env, 'chat', { r: rect(0, 0, 400, 800) });
  chat.appendChild(env.d.createElement('p'));
  const viewer = scroller(env, 'viewer');
  const v1 = slide(env, 'v1', rect(0, 0, 400, 800));
  const v2 = slide(env, 'v2', rect(0, 800, 400, 800));
  const W1 = makeVideo(env, rect(0, 0, 400, 800));
  const W2 = makeVideo(env, rect(0, 800, 400, 800));
  v1.appendChild(W1); v2.appendChild(W2); viewer.append(v1, v2);
  env.d.body.append(chat, viewer);
  await sleep(350);
  env.fire(W1);
  check('DM-viewer: viewer op slot', viewer.style.getPropertyValue('overflow-y') === 'hidden' && env.w.__SV_state().scrollLocked === true, env.w.__SV_state());
  check('DM-viewer: chat zelf niet op slot of gemaskeerd', chat.style.getPropertyValue('overflow-y') === 'auto' && !chat.hasAttribute('data-sv-masked'));
  check('DM-viewer: volgende reel gemaskeerd', isMasked(v2));
  check('DM-viewer: veeg omhoog (volgende) tegengehouden', swipe(env, W1, 0, -60) === true);
  check('DM-viewer: veeg omlaag (sluiten) mag', swipe(env, W1, 0, 60) === false);
  check('DM-viewer: vegen in de chat ernaast niet tegengehouden', swipe(env, chat.firstChild, 0, -60) === false);
  env.fire(W1, { visible: false }); // viewer dicht
  await sleep(150);
  check('DM-viewer: kort na sluiten nog afgeschermd', env.w.__SV_state().scrollLocked === true);
  await sleep(400);
  check('DM-viewer: na sluiten slot en maskers eraf', viewer.style.getPropertyValue('overflow-y') === 'auto' && !v2.hasAttribute('data-sv-masked') && env.w.__SV_state().masked === 0, env.w.__SV_state());
  env.close();

  // --- DM-viewer verdwijnt uit de pagina: direct vrijgeven
  env = makeEnv({ url: 'https://www.instagram.com/direct/t/123/', html: '' });
  const vw = scroller(env, 'viewer');
  const X1 = makeVideo(env, rect(0, 0, 400, 800));
  const X2 = makeVideo(env, rect(0, 800, 400, 800));
  vw.append(X1, X2); env.d.body.appendChild(vw);
  await sleep(350);
  env.fire(X1);
  check('viewer verwijderd: eerst op slot', env.w.__SV_state().scrollLocked === true);
  vw.remove();
  env.d.body.appendChild(env.d.createElement('div')); // DOM-wijziging
  await sleep(250);
  check('viewer verwijderd: slot en maskers eraf', env.w.__SV_state().scrollLocked === false && env.w.__SV_state().masked === 0, env.w.__SV_state());
  env.close();

  // --- hoge video in de chat zelf (geen schermvullende viewer): chat blijft scrollen
  env = makeEnv({ url: 'https://www.instagram.com/direct/t/123/', html: '' });
  const list = scroller(env, 'list');
  const Y1 = makeVideo(env, rect(0, 100, 400, 500));
  list.appendChild(Y1); env.d.body.appendChild(list);
  await sleep(350);
  env.fire(Y1);
  check('hoge video in chat (500 px): geen slot op de chat', list.style.getPropertyValue('overflow-y') === 'auto' && env.w.__SV_state().scrollLocked === false, env.w.__SV_state());
  check('hoge video in chat: vegen in chat mag', swipe(env, Y1, 0, -60) === false);
  env.close();

  // --- DM zonder scrollcontainer: geen slot, wel maskeren van de video eronder
  env = makeEnv({ url: 'https://www.instagram.com/direct/t/123/', html: '' });
  const Z1 = makeVideo(env, rect(0, 0, 400, 800));
  const Z2 = makeVideo(env, rect(0, 800, 400, 800));
  env.d.body.append(Z1, Z2);
  await sleep(350);
  env.fire(Z1);
  check('DM zonder container: geen slot', env.w.__SV_state().scrollLocked === false && env.d.documentElement.style.getPropertyValue('overflow-y') === '');
  check('DM zonder container: video eronder wel gemaskeerd', isMasked(Z2));
  env.close();

  // --- feed en profielen: nooit afscherming
  for (const p of ['/', '/alice/', '/stories/alice/1/']) {
    env = makeEnv({ url: 'https://www.instagram.com' + p, html: '' });
    const f = scroller(env, 'f');
    const F1 = makeVideo(env, rect(0, 0, 400, 800));
    const F2 = makeVideo(env, rect(0, 800, 400, 800));
    f.append(F1, F2); env.d.body.appendChild(f);
    await sleep(350);
    env.fire(F1); env.fire(F2);
    check(`${p}: geen slot en geen maskers`, f.style.getPropertyValue('overflow-y') === 'auto' && !F2.hasAttribute('data-sv-masked') && env.w.__SV_state().masked === 0 && swipe(env, F1, 0, -60) === false);
    env.close();
  }

  // --- Snapchat Spotlight-video krijgt dezelfde afscherming
  ({ env, sc, s2 } = await reelPage('https://www.snapchat.com/spotlight/abc123/', 'snapchat'));
  check('Snapchat /spotlight/x/: slot en masker', sc.style.getPropertyValue('overflow-y') === 'hidden' && isMasked(s2));
  // Geen volgpoort op Snapchat, dus geen DOM-wijziging na de routewissel: de routewissel zelf moet vrijgeven.
  env.go('/web/');
  await sleep(30);
  check('Snapchat: routewissel zonder DOM-wijziging geeft direct vrij', sc.style.getPropertyValue('overflow-y') === 'auto' && !s2.hasAttribute('data-sv-masked'), sc.getAttribute('style'));
  env.close();
}

async function testRulesContract() {
  console.log('\n[rules.json tegenover de Swift-structs]');
  // Verplichte sleutels (niet-optionele Codable-velden); ontbreekt er één, dan faalt het decoderen -> fatalError bij start.
  const platformRequired = ['allowedHostSuffixes', 'allowedPathPrefixes', 'redirects', 'blockedExactPaths', 'blockedPathPrefixes', 'hideSelectors', 'textRules'];
  const platformOptional = ['singleViewPathPattern', 'feedFilter', 'videoGuard', 'followGate', 'hostPathAllow'];
  const ffKeys = ['feedPaths', 'postSelector', 'followTexts'];
  const ffOptional = ['endAfterHidden', 'endText'];
  const vgKeys = ['pagePatterns', 'overlayPathPrefixes', 'exemptPathPrefixes'];
  const fgRequired = ['pathPatterns', 'exemptPathPrefixes', 'followTexts', 'followedTexts', 'hidePostLinks', 'hideAlways', 'message'];
  const fgOptional = ['selfSelector'];
  check('versie is 4', RULES.version === 4, RULES.version);
  for (const [name, p] of Object.entries(RULES.platforms)) {
    const missing = platformRequired.filter((k) => !(k in p));
    check(`${name}: alle verplichte sleutels aanwezig`, missing.length === 0, missing);
    const unknown = Object.keys(p).filter((k) => !platformRequired.concat(platformOptional).includes(k));
    check(`${name}: geen onbekende sleutels`, unknown.length === 0, unknown);
    for (const t of p.textRules) check(`${name}: textRule heeft texts en hideClosest`, Array.isArray(t.texts) && typeof t.hideClosest === 'string');
    if (p.videoGuard) {
      const m = vgKeys.filter((k) => !Array.isArray(p.videoGuard[k]));
      const u = Object.keys(p.videoGuard).filter((k) => !vgKeys.includes(k));
      check(`${name}: videoGuard komt overeen met struct`, m.length === 0 && u.length === 0, { m, u });
    }
    if (p.feedFilter) {
      const m = ffKeys.filter((k) => !(k in p.feedFilter));
      const u = Object.keys(p.feedFilter).filter((k) => !ffKeys.concat(ffOptional).includes(k));
      check(`${name}: feedFilter komt overeen met struct`, m.length === 0 && u.length === 0 && Array.isArray(p.feedFilter.feedPaths) && typeof p.feedFilter.postSelector === 'string' && Array.isArray(p.feedFilter.followTexts), { m, u });
    }
    if (p.hostPathAllow) {
      const okMap = Object.entries(p.hostPathAllow).every(([h, list]) => p.allowedHostSuffixes.includes(h) && Array.isArray(list) && list.every((x) => typeof x === 'string' && x.startsWith('/') && x === x.toLowerCase()));
      check(`${name}: hostPathAllow is host -> padvoorvoegsels (kleine letters) voor toegestane hosts`, okMap, p.hostPathAllow);
    }
    if (p.feedFilter && 'endAfterHidden' in p.feedFilter) {
      check(`${name}: endAfterHidden is een getal en endText een tekst`, Number.isInteger(p.feedFilter.endAfterHidden) && typeof p.feedFilter.endText === 'string');
    }
    if (p.followGate) {
      const m = fgRequired.filter((k) => !(k in p.followGate));
      const u = Object.keys(p.followGate).filter((k) => !fgRequired.concat(fgOptional).includes(k));
      check(`${name}: followGate komt overeen met struct`, m.length === 0 && u.length === 0, { m, u });
    }
    // Alle regexen compileren, ook in ICU-vorm (geen JS-only syntaxis zoals (?<name>) is hier niet nodig)
    const pats = [p.singleViewPathPattern].concat(p.videoGuard ? p.videoGuard.pagePatterns : [], p.followGate ? p.followGate.pathPatterns : []).filter(Boolean);
    let okRe = true;
    for (const s of pats) { try { new RegExp(s); } catch (e) { okRe = false; } }
    check(`${name}: alle regexen geldig`, okRe);
  }
}

async function testFeedFilter() {
  console.log('\n[feedfilter: posts met een Volgen-knop op de hoofdfeed]');
  const post = (id, label, btn, body = 'foto') =>
    `<article id="${id}"><header><a href="/x/">x</a>${label ? `<span>${label}</span>` : ''}${btn ? `<div role="button">${btn}</div>` : ''}</header><div>${body}</div></article>`;
  const env = makeEnv({
    url: 'https://www.instagram.com/',
    html: '<main id="feed">' + post('own', null, null) + post('rec', 'Aanbevolen voor jou', 'Volgen') + post('nolabel', null, 'Volgen') + post('en', null, 'Follow') + '</main>',
  });
  const { d } = env;
  await sleep(250);
  const hidden = (id) => d.getElementById(id).hasAttribute('data-sv-hidden');
  check('gevolgde post (geen Volgen-knop) blijft staan', !hidden('own'));
  check('"Aanbevolen voor jou" met Volgen verborgen (screenshot Paul)', hidden('rec'));
  check('post met Volgen-knop zonder label verborgen', hidden('nolabel'));
  check('Engelse Follow-knop verborgen', hidden('en'));

  // Later binnengeladen post
  d.getElementById('feed').insertAdjacentHTML('beforeend', post('late', null, 'Volgen') + post('late2', null, null));
  await sleep(300);
  check('nieuw geladen voorgestelde post verborgen', hidden('late'));
  check('nieuw geladen gewone post blijft', !hidden('late2'));

  // Knoptekst die pas later wordt ingevuld
  d.getElementById('feed').insertAdjacentHTML('beforeend', '<article id="slow"><div role="button" id="slowbtn">...</div></article>');
  await sleep(300);
  check('knop met tijdelijke tekst nog niet verborgen', !hidden('slow'));
  d.getElementById('slowbtn').firstChild.nodeValue = 'Volgen';
  await sleep(100);
  check('knoptekst wordt later "Volgen" -> verborgen', hidden('slow'));

  // Labeltekst alleen (tekstregel) werkt ook zonder knop
  d.getElementById('feed').insertAdjacentHTML('beforeend', post('lbl', 'Aanbevolen voor jou', null));
  await sleep(300);
  check('label "Aanbevolen voor jou" alleen is genoeg (tekstregel)', hidden('lbl'));

  // Veiligheid: een container met meerdere posts wordt nooit verborgen
  d.body.insertAdjacentHTML('beforeend', '<article id="outer"><div role="button">Volgen</div><article id="inner"><span>post</span></article></article>');
  await sleep(300);
  check('container met posts erin niet verborgen', !hidden('outer'));
  check('state telt verborgen en ongematchte knoppen', env.w.__SV_state().feedFilter.hidden >= 4 && env.w.__SV_state().feedFilter.unmatched >= 1, env.w.__SV_state().feedFilter);
  env.close();

  // Niet op een profiel (daar regelt de volgpoort het) en niet in DM's
  const env2 = makeEnv({ url: 'https://www.instagram.com/direct/inbox/', html: post('dm', null, 'Volgen') });
  await sleep(250);
  check('buiten de feed (DM) niets verborgen', !env2.d.getElementById('dm').hasAttribute('data-sv-hidden'));
  env2.go('/');
  await sleep(50);
  check('routewissel naar de feed loopt bestaande posts na', env2.d.getElementById('dm').hasAttribute('data-sv-hidden'));
  env2.close();

  // Schakelaar uit: Swift laat feedFilter weg
  const cfg = JSON.parse(JSON.stringify(RULES.platforms.instagram));
  delete cfg.feedFilter;
  const vc = new VirtualConsole();
  const dom = new JSDOM(`<!doctype html><html><body>${post('off', null, 'Volgen')}</body></html>`, { url: 'https://www.instagram.com/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  dom.window.webkit = { messageHandlers: { sv: { postMessage: () => {} } } };
  dom.window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  dom.window.__SV_CONFIG = cfg;
  dom.window.__SV_ENV = { lockZoom: false };
  dom.window.eval(FILTER_JS);
  await sleep(250);
  check('zonder feedFilter (schakelaar uit) blijft de post staan', !dom.window.document.getElementById('off').hasAttribute('data-sv-hidden'));
  dom.window.close();
}

async function testFeedEnd() {
  console.log('\n[einde van de feed]');
  const post = (id, btn) => `<article id="${id}"><header>${btn ? `<div role="button">${btn}</div>` : ''}</header><div>foto</div></article>`;
  const env = makeEnv({
    url: 'https://www.instagram.com/',
    html: '<main id="feed">' + post('f1') + post('f2') + post('s1', 'Volgen') + post('s2', 'Volgen') + post('s3', 'Volgen') + post('s4', 'Volgen') + '</main>',
  });
  const { d, w } = env;
  const feed = d.getElementById('feed');
  const card = () => d.getElementById('sv-feed-end');
  await sleep(300);
  check('4 verborgen posts onderaan: feed nog niet beëindigd', w.__SV_state().feedFilter.ended === false && !card());
  check('verborgen post is gewoon display:none', d.getElementById('s1').style.display === 'none');

  feed.insertAdjacentHTML('beforeend', post('s5', 'Volgen'));
  await sleep(350);
  const s1 = d.getElementById('s1');
  check('5 verborgen posts onderaan: feed beëindigd', w.__SV_state().feedFilter.ended === true && w.__SV_state().feedFilter.spacer === true, w.__SV_state().feedFilter);
  check('eerste van de rij is het hoge onzichtbare blok', s1.hasAttribute('data-sv-feed-end') && s1.style.display === 'block' && s1.style.visibility === 'hidden' && s1.style.height === '6000px' && s1.style.getPropertyPriority('height') === 'important', s1.getAttribute('style'));
  check('de rest van de rij blijft display:none', d.getElementById('s2').style.display === 'none' && d.getElementById('s5').style.display === 'none');
  check('eindkaart staat in de pagina met de tekst uit de regels', !!card() && card().textContent === RULES.platforms.instagram.feedFilter.endText && card().style.display === 'block', card() && card().outerHTML);
  check('eindkaart hangt buiten body (niet in de boom van de site)', card().parentElement === d.documentElement);
  check('precies één feedEnd-bericht', env.byType('feedEnd').length === 1, env.messages);
  check('css voor de eindkaart aanwezig', /#sv-feed-end\{position:fixed/.test(d.getElementById('sv-style').textContent));

  // Nog meer voorgestelde posts: blijft één blok, geen tweede bericht
  feed.insertAdjacentHTML('beforeend', post('s6', 'Volgen') + post('s7', 'Volgen'));
  await sleep(350);
  check('nieuwe voorgestelde posts: nog steeds één blok en één bericht', d.querySelectorAll('[data-sv-feed-end]').length === 1 && env.byType('feedEnd').length === 1 && d.getElementById('s7').style.display === 'none');

  // Scrollen voorbij het blok wordt teruggezet
  const se = d.scrollingElement || d.documentElement;
  let top = 300;                       // blok staat op 300 px van boven, scherm is 800 hoog
  s1.getBoundingClientRect = () => rect(0, top, 390, 6000);
  let st = 1000;
  Object.defineProperty(se, 'scrollTop', { configurable: true, get: () => st, set: (v) => { top += st - v; st = v; } });
  d.dispatchEvent(new w.Event('scroll'));
  await sleep(60);
  check('te ver gescrold: teruggezet tot het blok onderaan het scherm begint', top === 800 - 240 && st === 1000 - 260, { top, st });
  check('eindkaart staat net onder het begin van het blok', card().style.top === (800 - 240 + 12) + 'px', card().style.top);
  top = 900;
  d.dispatchEvent(new w.Event('scroll'));
  await sleep(60);
  check('blok nog onder het scherm: eindkaart verborgen', card().style.display === 'none');

  // Weg van de feed: kaart weg. Terug met dezelfde pagina: kaart terug, niet opnieuw geteld.
  top = 560;
  env.go('/direct/inbox/');
  await sleep(50);
  check('buiten de feed: eindkaart verborgen', card().style.display === 'none');
  env.go('/');
  await sleep(50);
  check('terug op de feed: eindkaart terug, geen tweede bericht', card().style.display === 'block' && env.byType('feedEnd').length === 1);

  // De site haalt het blok uit de pagina (lange feed): een andere verborgen post neemt het over
  s1.remove();
  await sleep(350);
  const s2 = d.getElementById('s2');
  check('blok verwijderd door de site: volgende verborgen post wordt het blok', s2.hasAttribute('data-sv-feed-end') && s2.style.height === '6000px' && d.querySelectorAll('[data-sv-feed-end]').length === 1, s2.getAttribute('style'));

  // Feed opnieuw opgebouwd na een routewissel: opnieuw tellen
  env.go('/direct/inbox/');
  await sleep(50);
  feed.innerHTML = post('n1') + post('n2', 'Volgen');
  env.go('/');
  await sleep(350);
  check('nieuwe feed met 1 verborgen post: niet beëindigd, geen kaart', w.__SV_state().feedFilter.ended === false && card().style.display === 'none' && d.getElementById('n2').style.display === 'none', w.__SV_state().feedFilter);
  env.close();

  // Een gevolgde post tussendoor breekt de rij
  const env2 = makeEnv({
    url: 'https://www.instagram.com/',
    html: '<main>' + post('a', 'Volgen') + post('b', 'Volgen') + post('c', 'Volgen') + post('d', 'Volgen') + post('e', 'Volgen') + post('own') + post('g', 'Volgen') + '</main>',
  });
  await sleep(300);
  check('5 verborgen posts maar daarna een gevolgde post: niet beëindigd', env2.w.__SV_state().feedFilter.ended === false && !env2.d.getElementById('sv-feed-end'));
  env2.close();

  // Zonder endAfterHidden (oude regels) gebeurt er niets
  const cfg = JSON.parse(JSON.stringify(RULES.platforms.instagram));
  delete cfg.feedFilter.endAfterHidden;
  const dom = new JSDOM(`<!doctype html><html><body>${[1, 2, 3, 4, 5, 6].map((i) => post('x' + i, 'Volgen')).join('')}</body></html>`, { url: 'https://www.instagram.com/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  dom.window.webkit = { messageHandlers: { sv: { postMessage: () => {} } } };
  dom.window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  dom.window.__SV_CONFIG = cfg;
  dom.window.__SV_ENV = { lockZoom: false };
  dom.window.eval(FILTER_JS);
  await sleep(300);
  check('zonder endAfterHidden: posts verborgen maar geen einde', dom.window.__SV_state().feedFilter.ended === false && !dom.window.document.getElementById('sv-feed-end') && dom.window.document.getElementById('x6').hasAttribute('data-sv-hidden'));
  dom.window.close();
}

async function testRestrictedHost() {
  console.log('\n[host met alleen toegestane paden (facebook.com)]');
  const env = makeEnv({ url: 'https://www.facebook.com/watch/', html: '<a id="r" href="/reels/">Reels</a><article><div role="button">Volgen</div></article>' });
  await sleep(300);
  check('filter doet niets op facebook.com (Swift bewaakt de paden)', env.w.__SV_state === undefined && env.messages.length === 0 && !env.d.getElementById('sv-style'), env.messages);
  env.close();
  const env2 = makeEnv({ url: 'https://m.facebook.com/login.php', html: '' });
  await sleep(100);
  check('ook op subdomeinen van facebook.com', env2.w.__SV_state === undefined);
  env2.close();
  const env3 = makeEnv({ url: 'https://www.instagram.com/', html: '' });
  await sleep(100);
  check('op instagram.com is het filter gewoon actief', typeof env3.w.__SV_state === 'function');
  check('trefwoordzoeken gaat terug naar het zoekscherm', env3.w.__SV_classify('/explore/search/keyword/').action === 'redirect' && env3.w.__SV_classify('/explore/search/keyword/').to === '/explore/search/');
  check('het zoekscherm zelf blijft toegestaan', env3.w.__SV_classify('/explore/search/').action === 'allow');
  env3.close();
}

(async () => {
  await testRulesContract();
  await testFeedEnd();
  await testRestrictedHost();
  await testClassify();
  await testTextRules();
  await testFeedFilter();
  await testZoomLock();
  await testFollowGate();
  await testVideoGuard();
  await testProtection();
  console.log(`\n${passed} geslaagd, ${failures.length} mislukt`);
  if (failures.length) { console.log('Mislukt:\n - ' + failures.join('\n - ')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
