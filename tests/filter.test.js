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
  check('Volgen-knop: notice met de melding', env.byType('notice').length === 1 && env.byType('notice')[0].text === 'Alleen content van accounts die je volgt', env.messages);
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

async function testRulesContract() {
  console.log('\n[rules.json tegenover de Swift-structs]');
  // Verplichte sleutels (niet-optionele Codable-velden); ontbreekt er één, dan faalt het decoderen -> fatalError bij start.
  const platformRequired = ['allowedHostSuffixes', 'allowedPathPrefixes', 'redirects', 'blockedExactPaths', 'blockedPathPrefixes', 'hideSelectors', 'textRules'];
  const platformOptional = ['singleViewPathPattern', 'videoGuard', 'followGate'];
  const vgKeys = ['pagePatterns', 'overlayPathPrefixes', 'exemptPathPrefixes'];
  const fgRequired = ['pathPatterns', 'exemptPathPrefixes', 'followTexts', 'followedTexts', 'hidePostLinks', 'hideAlways', 'message'];
  const fgOptional = ['selfSelector'];
  check('versie is 2', RULES.version === 2, RULES.version);
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

(async () => {
  await testRulesContract();
  await testClassify();
  await testTextRules();
  await testZoomLock();
  await testFollowGate();
  await testVideoGuard();
  console.log(`\n${passed} geslaagd, ${failures.length} mislukt`);
  if (failures.length) { console.log('Mislukt:\n - ' + failures.join('\n - ')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
