import { evalLeg, settleBet } from './settle.js';

const LS = 'wettbude.v1', START = 500, MIN = 0.5;
const SPORTS = [['fussball', 'Fussball'], ['tennis', 'Tennis'], ['eishockey', 'Eishockey'], ['basketball', 'Basketball'], ['amfootball', 'American Football'], ['rugby', 'Rugby']];
const POINTS = new Set(['basketball', 'amfootball', 'rugby']);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const chf = (n) => n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const q = (o) => o.toFixed(2);
const r2 = (x) => Math.round(x * 100) / 100;

let S = load();
let D = { events: [], leagues: [], upd: 0 };
let byId = new Map();
let lgBy = new Map();
let prev = new Map(); // Auswahl -> letzte Quote
let flash = new Map(); // Auswahl -> { dir, bis }
const V = { tab: 'wetten', sport: 'fussball', lg: 'all', open: new Set(), filter: 'open', warn: '', q: '' };

function load() {
  const def = { bal: START, bets: [], slip: [], mode: 'kombi', stake: 10, seq: 1, fav: [], favL: [] };
  try { return { ...def, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return def; }
}
function saveLocal() { try { localStorage.setItem(LS, JSON.stringify(S)); } catch { /* voller Speicher: Spielstand bleibt nur in dieser Sitzung */ } }
function save() { saveLocal(); if (S.tok) pushSoon(); }

/* ---------- Profil auf dem Server (gleiches Konto auf Handy und PC) ---------- */

const stateOf = () => { const { tok, rev, pick, ...st } = S; return st; };
async function api(p, opt = {}) {
  const r = await fetch('/api/acc/' + p, { ...opt, headers: { 'content-type': 'application/json', ...(S.tok ? { 'x-token': S.tok } : {}), ...(opt.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Server nicht erreichbar'), { status: r.status });
  return j;
}
let pushT = null, pushing = false, dirty = false;
function pushSoon() { dirty = true; clearTimeout(pushT); pushT = setTimeout(push, 700); }
async function push() {
  if (!S.tok || pushing) return;
  pushing = true; dirty = false;
  try {
    const r = await api('profile', { method: 'PUT', body: JSON.stringify({ base: S.rev || 0, state: stateOf() }) });
    if (r.conflict) { adopt(r.rev, r.state); toast('Auf einem anderen Gerät wurde gewettet. Stand neu geladen.'); }
    else { S.rev = r.rev; saveLocal(); }
  } catch (e) { if (e.status === 401) logoutLocal('Bitte neu anmelden.'); else dirty = true; }
  pushing = false;
  if (dirty) pushSoon();
}
function adopt(rev, state) {
  S = { ...load(), ...state, tok: S.tok, rev, pick: false };
  saveLocal(); render();
}
// Beim Abruf schauen, ob ein anderes Gerät etwas geändert hat.
async function pull() {
  if (!S.tok || pushing || dirty) return;
  try {
    const r = await api('profile?rev=' + (S.rev || 0));
    if (r.state && r.rev !== S.rev && !dirty && !pushing) adopt(r.rev, r.state);
  } catch (e) { if (e.status === 401) logoutLocal('Bitte neu anmelden.'); }
}
function logoutLocal(msg) {
  S = { ...load(), bal: START, bets: [], slip: [], name: '', tok: '', rev: 0 };
  localStorage.removeItem(LS);
  intro.step = 0; intro.mode = 'login';
  if (msg) toast(msg);
  render();
}

const isFav = (e) => S.fav.includes(e.home.n) || S.fav.includes(e.away.n);
const isOpen = (e) => e && e.state === 'pre' && !e.void && e.start > Date.now();
const key = (id, m, p) => `${id}|${m}|${p}`;
const sg = (x) => (x > 0 ? '+' : '') + x;

function pickLabel(e, m, p, line) {
  const H = e.home.n, A = e.away.n;
  const team = p === '1' ? H : p === '2' ? A : 'Unentschieden';
  const ou = (p === 'O' ? 'über ' : 'unter ') + line;
  const Ou = ou[0].toUpperCase() + ou.slice(1);
  if (m === '1x2' || m === 'ml') return team;
  if (m === 'dc') return p === '1X' ? `${H} oder Unentschieden` : p === '12' ? `${H} oder ${A}` : `Unentschieden oder ${A}`;
  if (m === 'dnb') return team;
  if (m === 'h1') return `1. Halbzeit: ${team}`;
  if (m.startsWith('h1ou')) return `1. Halbzeit ${ou} Tore`;
  if (m.startsWith('ou')) return Ou + (POINTS.has(e.sport) ? ' Punkte' : ' Tore');
  if (m.startsWith('th')) return `${H} ${ou} Tore`;
  if (m.startsWith('ta')) return `${A} ${ou} Tore`;
  if (m === 'btts') return p === 'J' ? 'Beide Teams treffen' : 'Nicht beide Teams treffen';
  if (m === 'cs') return `Resultat ${p}`;
  if (m === 'gsa') return `${p} trifft`;
  if (m === 'gsf') return `${p} trifft zuerst`;
  if (m === 'hc') return p === '1' ? `${H} ${sg(line)}` : `${A} ${sg(-line)}`;
  return p;
}

function mName(m, sp) {
  if (m.startsWith('h1ou')) return '1. Halbzeit Über/Unter';
  if (m.startsWith('ou')) return 'Über/Unter';
  if (m.startsWith('th') || m.startsWith('ta')) return 'Tore pro Team';
  if (sp === 'eishockey' && m === '1x2') return 'Spielausgang nach 60 Minuten';
  return { '1x2': 'Spielausgang', ml: sp === 'eishockey' ? 'Sieger inkl. Verlängerung' : 'Sieger', dc: 'Doppelte Chance', dnb: 'Unentschieden: Geld zurück', h1: '1. Halbzeit', btts: 'Beide Teams treffen', cs: 'Genaues Resultat', gsa: 'Torschütze', gsf: 'Erster Torschütze', hc: 'Handicap' }[m] || m;
}

function dayLabel(t) {
  const d = new Date(t), n = new Date();
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  return d.toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit' });
}
const timeLabel = (t) => new Date(t).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });

/* ---------- Daten ---------- */

async function poll() {
  await pull();
  const need = [...new Set(S.bets.filter((b) => b.status === 'open').flatMap((b) => b.legs.filter((l) => !l.res).map((l) => `${l.ev}~${l.ls || ''}~${l.start}`)))];
  try {
    const r = await fetch('/api/events?need=' + encodeURIComponent(need.join(',')));
    if (!r.ok) throw new Error(r.status);
    D = await r.json();
  } catch { $('#upd').textContent = 'Keine Verbindung zum Server'; return; }
  byId = new Map(D.events.map((e) => [e.id, e]));
  lgBy = new Map(D.leagues.map((l) => [l.slug, l]));
  const now = Date.now(), next = new Map();
  for (const e of D.events) {
    if (!isOpen(e)) continue;
    for (const [m, mk] of Object.entries(e.m || {})) {
      for (const [p, s] of Object.entries(mk)) {
        if (p === 'line') continue;
        const k = key(e.id, m, p) + (mk.line != null ? '|' + mk.line : '');
        next.set(k, s.o);
        const old = prev.get(k);
        if (old && old !== s.o) flash.set(key(e.id, m, p), { dir: s.o > old ? 'up' : 'down', bis: now + 20000 });
      }
    }
  }
  prev = next;
  settle();
  render();
}

function settle() {
  let changed = false;
  for (const b of S.bets) {
    if (b.status !== 'open') continue;
    for (const l of b.legs) {
      if (l.res) continue;
      const e = byId.get(l.ev);
      if (!e) continue;
      const res = evalLeg(l, e);
      if (res) { l.res = res; l.score = e.void ? 'abgesagt' : `${e.sh}:${e.sa}`; changed = true; }
    }
    const out = settleBet(b);
    if (!out) continue;
    b.status = out.status; b.payout = out.payout; b.done = Date.now();
    S.bal = r2(S.bal + out.payout);
    changed = true;
    if (out.status === 'won') toast(`Gewonnen: + CHF ${chf(out.payout)}`, 'won');
    else if (out.status === 'void') toast(`Wette ungültig, Einsatz zurück: CHF ${chf(out.payout)}`);
    else toast(`Verloren: Einsatz CHF ${chf(b.stake)}`, 'lost');
  }
  if (changed) save();
}

/* ---------- Wettschein ---------- */

function slipItems() {
  return S.slip.map((s) => {
    const e = byId.get(s.ev);
    const mk = e?.m?.[s.m];
    const sel = mk?.[s.p];
    const ok = isOpen(e) && !!sel;
    return { ...s, e, sel, line: mk?.line, ok, why: !e || !sel ? 'Nicht mehr verfügbar' : !ok ? 'Spiel hat begonnen' : '' };
  });
}

function togglePick(k) {
  const [ev, m, p] = k.split('|');
  const i = S.slip.findIndex((s) => s.ev === ev && s.m === m && s.p === p);
  if (i >= 0) S.slip.splice(i, 1);
  else {
    // Pro Spiel nur ein Tipp: ein neuer ersetzt den alten.
    S.slip = S.slip.filter((s) => s.ev !== ev);
    S.slip.push({ ev, m, p });
  }
  V.warn = '';
  save(); render();
}

function totals() {
  const items = slipItems();
  const kombi = items.length > 1 && S.mode === 'kombi';
  const stake = Math.max(0, +S.stake || 0);
  const odds = items.reduce((x, i) => x * (i.sel?.o || 1), 1);
  const total = kombi ? stake : stake * items.length;
  const win = kombi ? stake * odds : items.reduce((x, i) => x + stake * (i.sel?.o || 0), 0);
  let err = '';
  if (!items.length) err = ' ';
  else if (items.some((i) => !i.ok)) err = 'Entferne die gesperrten Tipps.';
  else if (stake < MIN) err = `Mindesteinsatz CHF ${chf(MIN)}.`;
  else if (total > S.bal + 1e-9) err = 'Guthaben reicht nicht.';
  return { items, kombi, stake, odds, total, win, err };
}

function place() {
  const t = totals();
  if (t.err) { V.warn = t.err.trim(); renderSlip(); return; }
  const leg = (i) => ({
    ev: i.ev, m: i.m, p: i.p, line: i.line ?? null, o: i.sel.o, b: i.sel.b,
    pick: pickLabel(i.e, i.m, i.p, i.line), mk: mName(i.m, i.e.sport), sp: i.e.sport, ls: i.e.lg,
    match: `${i.e.home.n} – ${i.e.away.n}`, lg: lgBy.get(i.e.lg)?.name || '', start: i.e.start, res: null,
  });
  const mk = (legs, stake) => ({ id: S.seq++, t: Date.now(), stake: r2(stake), legs, status: 'open', payout: 0 });
  if (t.kombi) S.bets.push(mk(t.items.map(leg), t.stake));
  else for (const i of t.items) S.bets.push(mk([leg(i)], t.stake));
  S.bal = r2(S.bal - t.total);
  S.slip = []; V.warn = '';
  document.body.classList.remove('sheet');
  save(); render();
  toast(`Wette platziert: CHF ${chf(t.total)}`);
}

/* ---------- Darstellung ---------- */

function oddBtn(e, m, p, short) {
  const sel = e.m?.[m]?.[p];
  if (!sel) return '<span class="odd off"><span>&nbsp;</span><b>–</b></span>';
  const k = key(e.id, m, p);
  const on = S.slip.some((s) => s.ev === e.id && s.m === m && s.p === p);
  const f = flash.get(k);
  const cls = ['odd', on ? 'sel' : '', f && f.bis > Date.now() ? f.dir : ''].join(' ');
  return `<button class="${cls}" data-act="pick" data-k="${esc(k)}" title="${esc(sel.b)}" ${isOpen(e) ? '' : 'disabled'}><span>${esc(short)}</span><b>${q(sel.o)}</b></button>`;
}

function countdown(start) {
  const s = Math.max(0, Math.round((start - Date.now()) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
// Countdown jede Sekunde nachführen; bei Anpfiff verschwindet das Spiel aus der Liste.
setInterval(() => {
  let gone = false;
  document.querySelectorAll('[data-cd]').forEach((el) => { if (+el.dataset.cd <= Date.now()) gone = true; else el.textContent = countdown(+el.dataset.cd); });
  if (gone) render();
}, 1000);

function img(t) { return t.l ? `<img src="${esc(t.l)}" alt="" loading="lazy" onerror="this.remove()">` : ''; }

const mainOf = (e) => (e.sport === 'fussball' || (e.sport === 'eishockey' && (e.m?.['1x2'] || e.wait)) || (e.sport === 'rugby' && e.m?.['1x2']) ? '1x2' : 'ml');

function evRow(e) {
  const main = mainOf(e);
  const soon = e.start - Date.now() < 60 * 6e4;
  const star = (t) => `<button class="star ${S.fav.includes(t.n) ? 'on' : ''}" data-act="fav" data-t="${esc(t.n)}" title="${S.fav.includes(t.n) ? 'Nicht mehr folgen' : 'Team folgen'}">${S.fav.includes(t.n) ? '★' : '☆'}</button>`;
  const extras = Object.keys(e.m || {}).filter((m) => m !== main).length + (Object.keys(e.cmp || {}).length > 1 ? 1 : 0);
  const book = e.wait ? 'Quoten folgen, spätestens 24 Stunden vor dem Spiel' : e.book === 'Modell' ? 'Modellquote' : e.sport === 'eishockey' && e.m?.['1x2']?.['1']?.b === 'berechnet' ? `${e.book}, Unentschieden berechnet` : e.book;
  let h = `<div class="ev${e.wait ? ' wait' : ''}">
    <div class="when">${soon ? `<b class="cd" data-cd="${e.start}">${countdown(e.start)}</b>bis Anpfiff` : `<b>${timeLabel(e.start)}</b>${dayLabel(e.start)}`}</div>
    <div class="teams"><div>${img(e.home)}<span>${esc(e.home.n)}</span>${star(e.home)}</div><div>${img(e.away)}<span>${esc(e.away.n)}</span>${star(e.away)}</div><div class="sub">${esc([V.q ? lgBy.get(e.lg)?.name : '', e.tour, book].filter(Boolean).join(' · '))}</div></div>
    <div class="odds">${main === '1x2' ? oddBtn(e, main, '1', '1') + oddBtn(e, main, 'X', 'X') + oddBtn(e, main, '2', '2') : oddBtn(e, main, '1', '1') + oddBtn(e, main, '2', '2')}</div>
    ${extras ? `<button class="more" data-act="more" data-id="${esc(e.id)}">${V.open.has(e.id) ? '–' : '+' + extras}</button>` : '<span></span>'}
  </div>`;
  if (extras && V.open.has(e.id)) h += extraHtml(e);
  return h;
}

function extraHtml(e) {
  let h = '<div class="extra">';
  const M = e.m || {};
  const src = (b) => (e.book === 'Modell' || b === 'Modell' ? 'Modellquote' : b === 'berechnet' ? `berechnet aus der ${esc(e.book)}-Linie` : esc(b));
  const head = (title, b) => `<h5>${title} <i>${src(b)}</i></h5>`;
  // einfacher Markt: eine Reihe Knöpfe
  const mk = (m, picks, title = mName(m)) => {
    const x = M[m];
    if (!x) return;
    picks = picks || Object.keys(x).filter((p) => p !== 'line');
    h += `<div class="mk">${head(title, x[picks[0]]?.b)}<div class="odds">${picks.map((p) => oddBtn(e, m, p, m === 'cs' || m === 'gsa' || m === 'gsf' ? p : pickLabel(e, m, p, x.line))).join('')}</div></div>`;
  };
  // Über/Unter mit mehreren Linien: eine Zeile pro Linie
  const lines = (prefix, title, unit) => {
    const keys = Object.keys(M).filter((k) => k.startsWith(prefix) && /^[\d.]*$/.test(k.slice(prefix.length))).sort((a, b) => M[a].line - M[b].line);
    if (!keys.length) return;
    h += `<div class="mk">${head(title, keys.every((k) => M[k].O.b === M[keys[0]].O.b) ? M[keys[0]].O.b : (keys.map((k) => M[k].O.b).find((b) => b !== 'berechnet') || e.book) + ', übrige Linien berechnet')}<div class="lines">${keys.map((k) => `<div class="odds">${oddBtn(e, k, 'O', `Über ${M[k].line} ${unit}`)}${oddBtn(e, k, 'U', `Unter ${M[k].line} ${unit}`)}${M[k].O.b !== 'berechnet' && keys.length > 1 ? `<span class="chip">${esc(M[k].O.b)}</span>` : ''}</div>`).join('')}</div></div>`;
  };
  const unit = POINTS.has(e.sport) ? 'Punkte' : 'Tore';
  if (mainOf(e) === '1x2' && e.sport === 'eishockey') mk('ml', ['1', '2'], 'Sieger inkl. Verlängerung und Penaltyschiessen');
  mk('dc', ['1X', '12', 'X2']);
  mk('dnb', ['1', '2']);
  lines('ou', 'Über/Unter ' + unit, unit);
  mk('btts', ['J', 'N']);
  mk('hc', ['1', '2']);
  mk('h1', ['1', 'X', '2']);
  lines('h1ou', '1. Halbzeit Über/Unter', 'Tore');
  lines('th', 'Tore ' + esc(e.home.n), 'Tore');
  lines('ta', 'Tore ' + esc(e.away.n), 'Tore');
  mk('cs');
  mk('gsa', null, 'Torschütze (trifft irgendwann)');
  mk('gsf');
  const books = Object.entries(e.cmp || {});
  if (books.length > 1) {
    const ps = books.some(([, w]) => w.X) ? ['1', 'X', '2'] : ['1', '2'];
    const best = (p) => Math.max(...books.map(([, w]) => w[p] || 0));
    h += `<div class="mk"><h5>Quotenvergleich</h5><table class="cmp"><tr><th></th>${ps.map((p) => `<th>${p}</th>`).join('')}</tr>${books.map(([b, w]) => `<tr><td>${esc(b)}</td>${ps.map((p) => `<td class="${w[p] === best(p) ? 'best' : ''}">${w[p] ? q(w[p]) : '–'}</td>`).join('')}</tr>`).join('')}</table></div>`;
  }
  return h + '</div>';
}

// Nur Spiele vor dem Anpfiff: was läuft, ist gesperrt und nur noch unter «Meine Wetten» zu sehen.
const bettable = (e, now = Date.now()) => !e.void && !e.done && e.state === 'pre' && e.start > now && (e.wait || (e.m && Object.keys(e.m).length));
function visible() {
  return D.events.filter((e) => e.sport === V.sport && bettable(e));
}

// Suche über alle Sportarten: Teams, Liga oder Land.
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function searchHits() {
  const words = fold(V.q).split(/\s+/).filter(Boolean);
  return D.events.filter((e) => {
    if (!bettable(e)) return false;
    const l = lgBy.get(e.lg);
    const hay = fold([e.home.n, e.away.n, e.home.s, e.away.s, l?.name, l?.land, e.tour].join(' '));
    return words.every((w) => hay.includes(w));
  });
}

const isFavL = (slug) => (S.favL || []).includes(slug);

function renderSide() {
  const evs = visible();
  const count = new Map();
  for (const e of evs) count.set(e.lg, (count.get(e.lg) || 0) + 1);
  const lgs = D.leagues.filter((l) => l.sport === V.sport && count.get(l.slug));
  if (V.lg !== 'all' && V.lg !== 'fav' && !count.get(V.lg)) V.lg = 'all';
  const favN = evs.filter(isFav).length;
  const lgBtn = (l, withLand) => `<button data-act="lg" data-l="${esc(l.slug)}" class="${V.lg === l.slug ? 'on' : ''}"><span class="lstar ${isFavL(l.slug) ? 'on' : ''}" data-act="favL" data-l="${esc(l.slug)}" title="${isFavL(l.slug) ? 'Aus den Lieblingsligen entfernen' : 'Als Lieblingsliga oben anzeigen'}">${isFavL(l.slug) ? '★' : '☆'}</span>${esc(withLand ? `${l.name} (${l.land})` : l.name)}<i>${count.get(l.slug)}</i></button>`;
  let h = `<div class="sports">${SPORTS.map(([k, n]) => `<button data-act="sport" data-s="${k}" class="${V.sport === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  h += `<div class="lgs"><button data-act="lg" data-l="all" class="${V.lg === 'all' ? 'on' : ''}">Alle Ligen<i>${evs.length}</i></button><button data-act="lg" data-l="fav" class="${V.lg === 'fav' ? 'on' : ''}">★ Meine Teams<i>${favN}</i></button>`;
  const favs = lgs.filter((l) => isFavL(l.slug));
  if (favs.length) h += `<h4>★ Lieblingsligen</h4>${favs.map((l) => lgBtn(l, true)).join('')}`;
  let land = '';
  for (const l of lgs) {
    if (isFavL(l.slug)) continue;
    if (l.land !== land) { land = l.land; h += `<h4>${esc(land)}</h4>`; }
    h += lgBtn(l);
  }
  h += '</div>';
  h += `<select class="lgSel" data-act="lgSel"><option value="all">Alle Ligen (${evs.length})</option><option value="fav" ${V.lg === 'fav' ? 'selected' : ''}>★ Meine Teams (${favN})</option>${lgs.map((l) => `<option value="${esc(l.slug)}" ${V.lg === l.slug ? 'selected' : ''}>${esc(l.land)} · ${esc(l.name)} (${count.get(l.slug)})</option>`).join('')}</select>`;
  $('#side').innerHTML = h;
}

function renderList() {
  const searching = !!V.q.trim();
  let evs = searching ? searchHits() : visible();
  if (!searching && V.lg === 'fav') evs = evs.filter(isFav);
  else if (!searching && V.lg !== 'all') evs = evs.filter((e) => e.lg === V.lg);
  if (!evs.length) {
    $('#main').innerHTML = `<p class="empty">${searching ? `Nichts gefunden für «${esc(V.q.trim())}».` : !D.upd ? 'Quoten werden geladen …' : V.lg === 'fav' ? (S.fav.length ? 'Deine Teams haben in den nächsten Tagen kein Spiel in dieser Sportart.' : 'Du folgst noch keinem Team. Klick auf den Stern neben einem Teamnamen.') : 'Im Moment gibt es hier keine Spiele mit Quoten.'}</p>`;
    return;
  }
  // Lieblingsligen zuerst, danach die übliche Reihenfolge.
  const order = new Map(D.leagues.map((l, i) => [l.slug, i + (isFavL(l.slug) ? 0 : 10000)]));
  const groups = new Map();
  for (const e of evs) { if (!groups.has(e.lg)) groups.set(e.lg, []); groups.get(e.lg).push(e); }
  const sorted = [...groups.entries()].sort((a, b) => (order.get(a[0]) ?? 1e9) - (order.get(b[0]) ?? 1e9));
  let h = searching ? `<div class="lgHead"><h3>Suche: «${esc(V.q.trim())}»</h3><span>${evs.length} Spiele</span></div>` : '', n = 0;
  for (const [slug, list] of sorted) {
    if (n > 400) break;
    const l = lgBy.get(slug);
    list.sort((a, b) => a.start - b.start);
    n += list.length;
    h += `<div class="lgHead"><h3><span class="lstar ${isFavL(slug) ? 'on' : ''}" data-act="favL" data-l="${esc(slug)}">${isFavL(slug) ? '★' : '☆'}</span>${esc(l?.name || slug)}</h3><span>${esc(l?.land || '')}</span></div><div class="list">${list.map(evRow).join('')}</div>`;
  }
  h += '<p class="note">Quoten von Flashscore. Pro Spiel stammen alle Quoten von einem Anbieter: bet365, sonst Interwetten, sonst der nächste. Hat er einen Markt nicht, springt der nächste ein. Weitere Tormärkte sind aus seiner Linie berechnet und so beschriftet. Eishockey: 1X2, Tore und Handicap gelten nach 60 Minuten. «Modellquote» gibt es nur, wenn 24 Stunden vor dem Spiel kein Anbieter Quoten hat; sie ist aus allen Resultaten der Saison berechnet (Gegnerstärke, letzte Spiele zählen mehr). Wetten sind bis zum Anpfiff möglich. Spielgeld, kein echter Einsatz.</p>';
  $('#main').innerHTML = h;
}

// Stand eines offenen Tipps: vor Anpfiff die Zeit, danach «läuft» mit Zwischenstand.
function legState(l) {
  const e = byId.get(l.ev);
  if (l.start > Date.now()) return dayLabel(l.start) + ' ' + timeLabel(l.start);
  if (e && e.state === 'in') return `<b class="live">läuft</b> · ${e.sh ?? 0}:${e.sa ?? 0}${e.txt ? ' · ' + esc(e.txt) : ''}`;
  return 'gesperrt, Resultat folgt';
}

function betCard(b) {
  const odds = b.legs.reduce((x, l) => x * l.o, 1);
  const label = { open: 'Offen', won: 'Gewonnen', lost: 'Verloren', void: 'Ungültig' }[b.status];
  return `<div class="bet">
    <div class="betHead"><div><b>${b.legs.length > 1 ? `Kombi ${b.legs.length}-fach` : 'Einzelwette'}</b><small>${new Date(b.t).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></div><span class="badge ${b.status}">${label}</span></div>
    ${b.legs.map((l) => `<div class="leg"><i class="dot ${l.res || ''}"></i><div><b>${esc(l.pick)}</b><small>${esc(l.mk)} · ${esc(l.match)}${l.lg ? ' · ' + esc(l.lg) : ''}</small><small>${l.res ? 'Resultat ' + esc(l.score) + (l.res === 'void' ? ' · ungültig, Quote 1.00' : '') : legState(l)}</small></div><span class="q">${q(l.o)}</span></div>`).join('')}
    <div class="betFoot"><div><span>Einsatz</span><b>CHF ${chf(b.stake)}</b></div><div><span>Gesamtquote</span><b>${q(odds)}</b></div><div><span>${b.status === 'open' ? 'Möglicher Gewinn' : 'Auszahlung'}</span><b class="${b.status === 'won' ? 'pos' : ''}">CHF ${chf(b.status === 'open' ? b.stake * odds : b.payout)}</b></div></div>
  </div>`;
}

/* ---------- Andere Spieler: Rangliste und ihre Wetten der letzten 7 Tage ---------- */

const P = { list: null, at: 0, sel: null, detail: null, err: '' };
async function loadPlayers(force) {
  if (!S.tok || (!force && P.list && Date.now() - P.at < 60e3)) return;
  P.at = Date.now();
  try { const r = await api('players'); P.list = r.list; P.admin = !!r.admin; P.err = ''; } catch (e) { P.err = e.message; }
  if (V.tab === 'spieler') renderPlayers();
}
async function loadPlayer(name) {
  P.sel = name; P.detail = null; renderPlayers();
  try { P.detail = await api('player?n=' + encodeURIComponent(name)); } catch (e) { P.err = e.message; }
  if (V.tab === 'spieler') renderPlayers();
}
const signed = (x) => `<b class="${x > 0 ? 'pos' : x < 0 ? 'neg' : ''}">${x > 0 ? '+' : ''}${chf(x)}</b>`;

// Letzte 7 Tage: pro Tag Gewinn/Verlust der abgerechneten Wetten, als Balken nach oben (grün) oder unten (rot).
function dayBars(done) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    days.push({ from: +d, to: +d + 864e5, label: i === 0 ? 'Heute' : i === 1 ? 'Gestern' : d.toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit' }), net: 0, n: 0 });
  }
  for (const b of done) {
    const t = b.done || b.t, day = days.find((x) => t >= x.from && t < x.to);
    if (day) { day.net += (b.payout || 0) - b.stake; day.n++; }
  }
  const max = Math.max(1, ...days.map((x) => Math.abs(x.net)));
  return `<div class="days">${days.map((x) => {
    const h = Math.round(Math.abs(x.net) / max * 48);
    return `<div class="day"><div class="dbar"><div class="hi"><i class="up" style="height:${x.net > 0 ? h : 0}px"></i></div><div class="lo"><i class="down" style="height:${x.net < 0 ? h : 0}px"></i></div></div>${x.n ? signed(r2(x.net)) : '<b class="none">–</b>'}<small>${x.label}</small><small>${x.n ? x.n + (x.n === 1 ? ' Wette' : ' Wetten') : 'keine'}</small></div>`;
  }).join('')}</div>`;
}

function renderPlayers() {
  loadPlayers();
  if (P.sel) {
    const d = P.detail;
    if (!d) { $('#main').innerHTML = `<button class="back" data-act="plBack">← Alle Spieler</button><p class="empty">${P.err ? esc(P.err) : 'Wird geladen …'}</p>`; return; }
    const open = d.bets.filter((b) => b.status === 'open'), done = d.bets.filter((b) => b.status !== 'open');
    $('#main').innerHTML = `<button class="back" data-act="plBack">← Alle Spieler</button>
      <div class="lgHead"><h3>${esc(d.name)}</h3><span>Start mit CHF ${chf(d.start)}</span>${P.admin ? `<button class="gift" data-act="gift" data-n="${esc(d.name)}">Geld geben</button>` : ''}</div>
      <div class="stats">
        <div class="stat"><span>Gewinn gesamt</span>${signed(d.profit)}</div>
        <div class="stat"><span>Letzte 7 Tage</span>${signed(d.week)}</div>
        <div class="stat"><span>Guthaben</span><b>CHF ${chf(d.bal)}</b></div>
        <div class="stat"><span>Gewonnen / Verloren</span><b>${d.won} / ${d.lost}</b></div>
      </div>
      <h4 class="secHead">Plus und Minus pro Tag</h4>
      ${dayBars(done)}
      <h4 class="secHead">Abgerechnet in den letzten 7 Tagen (${done.length})</h4>
      <div class="bets">${done.map(betCard).join('') || '<p class="empty">Keine abgerechneten Wetten in den letzten 7 Tagen.</p>'}</div>
      ${open.length ? `<h4 class="secHead">Noch offen (${open.length})</h4><div class="bets">${open.map(betCard).join('')}</div>` : ''}`;
    return;
  }
  if (!P.list) { $('#main').innerHTML = `<p class="empty">${P.err ? esc(P.err) : 'Spieler werden geladen …'}</p>`; return; }
  $('#main').innerHTML = `<div class="lgHead"><h3>Spieler</h3><span>${P.list.length} Profile · Rangliste nach Guthaben · Gesamt = Guthaben plus offene Einsätze minus Startbudget</span></div>
    <div class="list players">${P.list.map((p, i) => `<button class="pl ${p.name === S.name ? 'me' : ''}" data-act="pl" data-n="${esc(p.name)}">
      <span class="rank">${i + 1}</span>
      <span class="who"><b>${esc(p.name)}${p.name === S.name ? ' (du)' : ''}</b><small>${p.won} gewonnen · ${p.lost} verloren${p.open ? ` · ${p.open} offen` : ''}</small></span>
      <span class="num"><small>Guthaben</small><b>CHF ${chf(p.bal)}</b></span>
      <span class="num"><small>Gesamt</small>${signed(p.profit)}</span>
    </button>`).join('')}</div>`;
}

function renderMine() {
  const open = S.bets.filter((b) => b.status === 'open');
  const done = S.bets.filter((b) => b.status !== 'open');
  const net = done.reduce((x, b) => x + b.payout - b.stake, 0);
  const broke = S.bal < MIN && !open.length;
  const list = (V.filter === 'open' ? open : done).slice().sort((a, b) => (b.done || b.t) - (a.done || a.t));
  $('#main').innerHTML = `
    ${broke ? `<div class="banner"><span>Dein Guthaben ist aufgebraucht.</span><button data-act="reset" data-sure="1">Neu starten</button></div>` : ''}
    <div class="stats">
      <div class="stat"><span>Guthaben</span><b>CHF ${chf(S.bal)}</b></div>
      <div class="stat"><span>Offene Einsätze</span><b>CHF ${chf(open.reduce((x, b) => x + b.stake, 0))}</b></div>
      <div class="stat"><span>Gewonnen / Verloren</span><b>${done.filter((b) => b.status === 'won').length} / ${done.filter((b) => b.status === 'lost').length}</b></div>
      <div class="stat"><span>Bilanz abgerechnet</span><b class="${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${net > 0 ? '+' : ''}${chf(net)}</b></div>
    </div>
    <div class="filter"><button data-act="filter" data-f="open" class="${V.filter === 'open' ? 'on' : ''}">Offen (${open.length})</button><button data-act="filter" data-f="done" class="${V.filter === 'done' ? 'on' : ''}">Abgerechnet (${done.length})</button></div>
    ${list.length ? list.map(betCard).join('') : `<p class="empty">${V.filter === 'open' ? 'Keine offenen Wetten.' : 'Noch nichts abgerechnet.'}</p>`}
    <button class="reset" data-act="reset">Konto zurücksetzen</button>`;
}

/* ---------- Statistik ---------- */

function lineChart(vals) {
  const W = 640, Hh = 200, pad = 8;
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals), span = max - min || 1;
  const x = (i) => pad + (i / Math.max(1, vals.length - 1)) * (W - 2 * pad);
  const y = (v) => pad + (1 - (v - min) / span) * (Hh - 2 * pad);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = vals.at(-1), col = last >= 0 ? 'var(--win)' : 'var(--lose)';
  return `<svg viewBox="0 0 ${W} ${Hh}" class="chart" preserveAspectRatio="none" role="img" aria-label="Verlauf Gewinn und Verlust">
    <polygon points="${x(0)},${y(0)} ${pts} ${x(vals.length - 1)},${y(0)}" fill="${col}" opacity=".12"/>
    <line x1="${pad}" x2="${W - pad}" y1="${y(0)}" y2="${y(0)}" stroke="var(--mut)" stroke-dasharray="4 4" stroke-width="1" vector-effect="non-scaling-stroke"/>
    <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </svg><div class="axis"><span>Tief ${chf(min)}</span><span>Hoch ${chf(max)}</span></div>`;
}

function renderStats() {
  const done = S.bets.filter((b) => b.status !== 'open').sort((a, b) => (a.done || a.t) - (b.done || b.t));
  const open = S.bets.filter((b) => b.status === 'open');
  const net = (b) => b.payout - b.stake;
  const won = done.filter((b) => b.status === 'won'), lost = done.filter((b) => b.status === 'lost');
  const total = done.reduce((x, b) => x + net(b), 0);
  const staked = done.reduce((x, b) => x + b.stake, 0);
  const sign = (v) => (v > 0 ? '+' : '') + chf(v);
  const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const arrow = (v) => (v > 0 ? '<i class="tr pos">▲</i>' : v < 0 ? '<i class="tr neg">▼</i>' : '<i class="tr">▶</i>');
  const recent = done.slice(-5).reduce((x, b) => x + net(b), 0);
  let streak = 0, kind = '';
  for (let i = done.length - 1; i >= 0; i--) {
    if (done[i].status === 'void') continue;
    if (!kind) kind = done[i].status;
    if (done[i].status !== kind) break;
    streak++;
  }
  const best = done.reduce((m, b) => Math.max(m, net(b)), 0);
  const avgOdds = won.length ? won.reduce((x, b) => x + b.payout / b.stake, 0) / won.length : 0;
  const stat = (label, val, c = '') => `<div class="stat"><span>${label}</span><b class="${c}">${val}</b></div>`;

  if (!done.length) {
    $('#main').innerHTML = `<div class="stats">${stat('Guthaben', 'CHF ' + chf(S.bal))}${stat('Offene Wetten', open.length)}</div><p class="empty">Noch keine abgerechnete Wette. Sobald dein erstes Spiel fertig ist, erscheinen hier Verlauf, Trefferquote und Trend.</p>`;
    return;
  }

  let run = 0;
  const curve = [0, ...done.map((b) => (run += net(b)))];
  const groups = (keyFn) => {
    const g = new Map();
    for (const b of done) { const k = keyFn(b); if (!g.has(k)) g.set(k, []); g.get(k).push(b); }
    const rows = [...g.entries()].map(([k, l]) => ({ k, n: l.length, w: l.filter((b) => b.status === 'won').length, d: l.filter((b) => b.status !== 'void').length, net: l.reduce((x, b) => x + net(b), 0) }));
    const mx = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
    return rows.sort((a, b) => b.net - a.net).map((r) => `<tr><td>${esc(r.k)}</td><td>${r.n}</td><td>${r.d ? Math.round(r.w / r.d * 100) + ' %' : '–'}</td><td class="barCell"><i class="bar ${cls(r.net)}" style="width:${Math.max(2, Math.abs(r.net) / mx * 100)}%"></i></td><td class="${cls(r.net)}">${sign(r.net)}</td></tr>`).join('');
  };
  const sportName = (b) => (b.legs.every((l) => l.sp === b.legs[0].sp) ? Object.fromEntries(SPORTS)[b.legs[0].sp] || 'Andere' : 'Gemischt');
  const last = done.slice(-12);
  const mxLast = Math.max(1, ...last.map((b) => Math.abs(net(b))));

  $('#main').innerHTML = `
    <div class="stats">
      ${stat('Guthaben', 'CHF ' + chf(S.bal))}
      ${stat('Gewinn / Verlust', sign(total) + ' ' + arrow(total), cls(total))}
      ${stat('Trend letzte 5 Wetten', sign(recent) + ' ' + arrow(recent), cls(recent))}
      ${stat('Trefferquote', (won.length + lost.length ? Math.round(won.length / (won.length + lost.length) * 100) : 0) + ' %')}
    </div>
    <div class="panel"><h3>Verlauf Gewinn und Verlust</h3><p class="sub">Summe aller abgerechneten Wetten, von der ersten bis zur letzten.</p>${lineChart(curve)}</div>
    <div class="stats">
      ${stat('Gewonnen / Verloren', `${won.length} / ${lost.length}`)}
      ${stat('Rendite auf Einsatz', (staked ? (total / staked * 100).toFixed(1) : '0.0') + ' %', cls(total))}
      ${stat('Grösster Gewinn', 'CHF ' + chf(best), best > 0 ? 'pos' : '')}
      ${stat('Aktuelle Serie', streak ? `${streak} ${kind === 'won' ? (streak > 1 ? 'Siege' : 'Sieg') : (streak > 1 ? 'Niederlagen' : 'Niederlage')}` : '–', kind === 'won' ? 'pos' : kind === 'lost' ? 'neg' : '')}
      ${stat('Einsatz abgerechnet', 'CHF ' + chf(staked))}
      ${stat('Offene Einsätze', 'CHF ' + chf(open.reduce((x, b) => x + b.stake, 0)))}
      ${stat('Ø Quote der Gewinne', avgOdds ? q(avgOdds) : '–')}
      ${stat('Wetten total', S.bets.length)}
    </div>
    <div class="panel"><h3>Letzte Wetten</h3><p class="sub">Gewinn oder Verlust pro Schein, neueste rechts.</p>
      <div class="bars">${last.map((b) => `<div title="${esc(b.legs.map((l) => l.pick).join(' + '))}: ${sign(net(b))}"><i class="${cls(net(b))}" style="height:${Math.max(3, Math.abs(net(b)) / mxLast * 100)}%"></i></div>`).join('')}</div></div>
    <div class="panel"><h3>Nach Sportart</h3><table class="tbl"><tr><th></th><th>Wetten</th><th>Treffer</th><th></th><th>Gewinn / Verlust</th></tr>${groups(sportName)}</table></div>
    <div class="panel"><h3>Einzel und Kombi</h3><table class="tbl"><tr><th></th><th>Wetten</th><th>Treffer</th><th></th><th>Gewinn / Verlust</th></tr>${groups((b) => (b.legs.length > 1 ? `Kombi ${b.legs.length}-fach` : 'Einzelwette'))}</table></div>`;
}

function renderSlip() {
  const t = totals();
  const el = $('#slip');
  const focused = document.activeElement?.id === 'stake';
  let h = `<div class="slipHead"><span>Wettschein${t.items.length ? ` (${t.items.length})` : ''}</span>${t.items.length ? '<button data-act="clear">Leeren</button>' : '<button data-act="sheet">Schliessen</button>'}</div>`;
  if (!t.items.length) h += '<p class="empty">Klick auf eine Quote, um einen Tipp hinzuzufügen.</p>';
  else {
    if (t.items.length > 1) h += `<div class="modes"><button data-act="mode" data-m="kombi" class="${t.kombi ? 'on' : ''}">Kombi</button><button data-act="mode" data-m="einzel" class="${t.kombi ? '' : 'on'}">Einzel</button></div>`;
    h += t.items.map((i) => `<div class="pick ${i.ok ? '' : 'bad'}">
      <b>${i.e ? esc(pickLabel(i.e, i.m, i.p, i.line)) : 'Tipp'}</b>
      <small>${mName(i.m)}${i.e ? ' · ' + esc(i.e.home.n) + ' – ' + esc(i.e.away.n) : ''}</small>
      ${i.ok ? `<small>${esc(i.sel.b === 'Modell' ? 'Modellquote' : i.sel.b)} · ${dayLabel(i.e.start)} ${timeLabel(i.e.start)}</small><span class="q">${q(i.sel.o)}</span>` : `<small class="err">${i.why}</small>`}
      <button class="x" data-act="pick" data-k="${esc(key(i.ev, i.m, i.p))}" title="Entfernen">×</button>
    </div>`).join('');
    h += `<div class="slipBody">
      <div class="stake"><label for="stake">Einsatz${t.kombi || t.items.length === 1 ? '' : ' pro Wette'}</label><span>CHF</span><input id="stake" type="number" min="0.5" step="0.5" inputmode="decimal" value="${esc(S.stake)}"></div>
      <div class="quick">${[5, 10, 25, 50].map((v) => `<button data-act="stake" data-v="${v}">${v}</button>`).join('')}<button data-act="stake" data-v="max">Max</button></div>
      <div id="sums"></div>
      <button class="go" data-act="place">Wette platzieren</button>
      <div class="warn">${esc(V.warn)}</div>
    </div>`;
  }
  el.innerHTML = h;
  renderSums();
  if (focused) { const i = $('#stake'); if (i) { i.focus(); } }
  const fab = $('#slipFab');
  fab.hidden = !t.items.length;
  fab.textContent = `Wettschein (${t.items.length})`;
}

function renderSums() {
  const el = $('#sums');
  if (!el) return;
  const t = totals();
  el.innerHTML = `${t.kombi ? `<div class="sum"><span>Gesamtquote (${t.items.length} Tipps)</span><b>${q(t.odds)}</b></div>` : ''}
    <div class="sum"><span>Einsatz total</span><b>CHF ${chf(t.total)}</b></div>
    <div class="sum big"><span>Möglicher Gewinn</span><b>CHF ${chf(t.win)}</b></div>`;
  const go = $('#slip .go');
  if (go) go.disabled = !!t.err;
}

function renderTop() {
  $('#bal').textContent = chf(S.bal);
  const who = S.tok ? S.name || '' : '';
  if ($('#who').dataset.n !== who) { $('#who').dataset.n = who; $('#who').innerHTML = who ? `<button data-act="rename" class="wname" title="Namen ändern">${esc(who)} ✎</button><button data-act="logout" title="Abmelden">Abmelden</button>` : ''; }
  const n = S.bets.filter((b) => b.status === 'open').length;
  $('#openCount').textContent = n || '';
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === V.tab));
  const s = D.upd ? Math.max(0, Math.round((Date.now() - D.upd) / 1000)) : null;
  $('#upd').textContent = s == null ? 'Quoten werden geladen' : s < 90 ? `Quoten aktualisiert vor ${s} s` : `Quoten aktualisiert vor ${Math.round(s / 60)} min`;
}

/* ---------- Start: Name, Erklärung, Budget ---------- */

const BUDGETS = [[100, 'Vorsichtig', 'Wenig Geld, jede Wette zählt.'], [500, 'Klassisch', 'Der normale Start.'], [2000, 'Grosser Einsatz', 'Viel Spielraum für Kombis.']];
const intro = { step: 0, mode: 'new', name: '', pw: '', budget: 500, err: '', busy: false, sig: '' };

async function introFirst() {
  const n = intro.name.trim();
  if (n.length < 2) { intro.err = 'Der Name braucht mindestens 2 Zeichen.'; return; }
  if (intro.pw.length < 4) { intro.err = 'Das Passwort braucht mindestens 4 Zeichen.'; return; }
  intro.busy = true; intro.err = ''; renderIntro();
  try {
    if (intro.mode === 'login') {
      const r = await api('login', { method: 'POST', body: JSON.stringify({ name: n, pw: intro.pw }) });
      S.tok = r.token;
      intro.pw = '';
      adopt(r.rev, r.state);
      toast(`Willkommen zurück, ${r.name}!`);
    } else {
      const r = await api('free?n=' + encodeURIComponent(n));
      if (!r.free) intro.err = 'Diesen Namen gibt es schon. Wähle einen anderen oder melde dich an.';
      else intro.step = 1;
    }
  } catch (e) { intro.err = e.message; }
  intro.busy = false; render();
}

async function introFinish() {
  // Neues Profil oder (nach «Konto zurücksetzen») neues Budget.
  if (S.tok && S.pick) {
    S.bal = intro.budget; S.start = intro.budget; S.pick = false;
    save(); toast(`Neustart mit CHF ${intro.budget}. Viel Glück!`); render(); return;
  }
  intro.busy = true; intro.err = ''; renderIntro();
  try {
    const st = { ...stateOf(), bal: intro.budget, start: intro.budget, bets: [], slip: [], seq: 1, name: intro.name.trim() };
    const r = await api('register', { method: 'POST', body: JSON.stringify({ name: intro.name.trim(), pw: intro.pw, state: st }) });
    S = { ...S, ...st, name: r.name, tok: r.token, rev: r.rev };
    intro.pw = '';
    saveLocal();
    toast(`Viel Glück, ${S.name}!`);
  } catch (e) { intro.err = e.message; intro.step = e.status === 409 ? 0 : intro.step; }
  intro.busy = false; render();
}

function renderIntro() {
  let el = $('#intro');
  const show = !S.tok || S.pick;
  if (!show) { el?.remove(); intro.sig = ''; return; }
  if (S.pick) intro.step = 2;
  // Nur neu zeichnen, wenn sich etwas geändert hat (sonst verschwindet beim Abruf, was man tippt).
  const sig = [intro.step, intro.mode, intro.err, intro.busy, intro.budget, !!S.pick].join('|');
  if (el && sig === intro.sig) return;
  intro.sig = sig;
  if (!el) { el = document.createElement('div'); el.id = 'intro'; document.body.append(el); }
  const dots = S.pick ? '' : `<div class="dots">${[0, 1, 2].map((i) => `<i class="${i === intro.step ? 'on' : ''}"></i>`).join('')}</div>`;
  const login = intro.mode === 'login';
  const err = intro.err ? `<p class="introErr">${esc(intro.err)}</p>` : '';
  const steps = [
    `<h2>Willkommen in der Wettbude</h2>
     <p>Hier wettest du auf echte Spiele mit echten Quoten, aber nur mit Spielgeld. Du kannst nichts verlieren und nichts gewinnen ausser Ruhm.</p>
     <div class="modeTabs"><button data-act="introMode" data-m="new" class="${login ? '' : 'on'}">Neu hier</button><button data-act="introMode" data-m="login" class="${login ? 'on' : ''}">Ich habe schon ein Profil</button></div>
     <label for="introName">Name</label>
     <input id="introName" maxlength="20" placeholder="Dein Name" value="${esc(intro.name)}" autocomplete="username">
     <label for="introPw">Passwort</label>
     <input id="introPw" type="password" maxlength="100" placeholder="${login ? 'Dein Passwort' : 'Mindestens 4 Zeichen'}" value="${esc(intro.pw)}" autocomplete="${login ? 'current-password' : 'new-password'}">
     <p class="hint">${login ? 'Mit Name und Passwort kommst du auf jedem Gerät in dein Profil.' : 'Merk dir Name und Passwort: Damit kommst du auch am Handy in dasselbe Profil.'}</p>
     ${err}
     <div class="introBtns"><span></span><button class="go" data-act="introFirst" ${intro.busy ? 'disabled' : ''}>${login ? 'Anmelden' : 'Weiter'}</button></div>`,
    `<h2>So funktioniert es</h2>
     <ol class="how">
       <li><b>Quote anklicken.</b> Die Zahl sagt, mit wie viel dein Einsatz multipliziert wird. Quote 2.50 und CHF 10 Einsatz ergeben CHF 25.</li>
       <li><b>Einzel oder Kombi.</b> Bei einer Kombi werden alle Quoten miteinander multipliziert. Dafür müssen alle Tipps stimmen.</li>
       <li><b>Einsatz wählen und platzieren.</b> Die Quote ist ab dann fix. Wetten gehen bis zum Anpfiff.</li>
       <li><b>Abrechnung von selbst.</b> Nach dem Spiel kommt der Gewinn aufs Konto. Unter «Meine Wetten» und «Statistik» siehst du, wie es läuft.</li>
     </ol>
     <div class="introBtns"><button class="reset" data-act="introBack">Zurück</button><button class="go" data-act="introNext">Weiter</button></div>`,
    `<h2>Mit wie viel startest du, ${esc(S.pick ? S.name : intro.name.trim())}?</h2>
     <div class="budgets">${BUDGETS.map(([v, t, d]) => `<button data-act="budget" data-v="${v}" class="${intro.budget === v ? 'on' : ''}"><b>CHF ${v}</b><span>${t}</span><small>${d}</small></button>`).join('')}</div>
     ${err}
     <div class="introBtns">${S.pick ? '<span></span>' : '<button class="reset" data-act="introBack">Zurück</button>'}<button class="go" data-act="introGo" ${intro.busy ? 'disabled' : ''}>Los gehts</button></div>`,
  ];
  el.innerHTML = `<div class="introCard">${dots}${steps[intro.step]}</div>`;
  if (intro.step === 0 && !intro.busy) (intro.name ? $('#introPw') : $('#introName'))?.focus();
}

function render() {
  renderIntro();
  renderTop();
  renderSide();
  document.body.classList.toggle('noSide', V.tab !== 'wetten');
  if (V.tab === 'wetten') renderList(); else if (V.tab === 'stats') renderStats(); else if (V.tab === 'spieler') renderPlayers(); else renderMine();
  renderSlip();
}

function toast(msg, cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 5000);
}

/* ---------- Bedienung ---------- */

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT') return;
  const a = b.dataset.act;
  if (a === 'pick') return togglePick(b.dataset.k);
  if (a === 'tab') { V.tab = b.dataset.tab; if (V.tab === 'spieler') { P.sel = null; loadPlayers(true); } }
  else if (a === 'pl') return void loadPlayer(b.dataset.n);
  else if (a === 'plBack') { P.sel = null; P.detail = null; }
  else if (a === 'sport') { V.sport = b.dataset.s; V.lg = 'all'; }
  else if (a === 'lg') V.lg = b.dataset.l;
  else if (a === 'more') { V.open.has(b.dataset.id) ? V.open.delete(b.dataset.id) : V.open.add(b.dataset.id); }
  else if (a === 'filter') V.filter = b.dataset.f;
  else if (a === 'fav') { const t = b.dataset.t; S.fav = S.fav.includes(t) ? S.fav.filter((x) => x !== t) : [...S.fav, t]; save(); }
  else if (a === 'favL') { const l = b.dataset.l, f = S.favL || []; S.favL = f.includes(l) ? f.filter((x) => x !== l) : [...f, l]; save(); }
  else if (a === 'qClear') { V.q = ''; $('#q').value = ''; $('#qx').hidden = true; }
  else if (a === 'mode') { S.mode = b.dataset.m; save(); }
  else if (a === 'clear') { S.slip = []; V.warn = ''; save(); }
  else if (a === 'stake') { S.stake = b.dataset.v === 'max' ? Math.floor(S.bal / (S.mode === 'kombi' || S.slip.length < 2 ? 1 : S.slip.length) * 100) / 100 : +b.dataset.v; V.warn = ''; save(); }
  else if (a === 'place') return place();
  else if (a === 'sheet') return document.body.classList.toggle('sheet');
  else if (a === 'reset') {
    if (!b.dataset.sure && !confirm('Konto wirklich zurücksetzen? Guthaben und alle Wetten werden gelöscht.')) return;
    // Profil bleibt, nur Guthaben und Wetten weg; danach Budget neu wählen.
    S = { ...S, bal: START, bets: [], slip: [], seq: 1, pick: true };
    save();
  }
  else if (a === 'gift') {
    const who = b.dataset.n;
    const x = parseFloat(String(prompt(`Wie viel CHF soll ${who} bekommen?`, '100') || '').replace(',', '.'));
    if (!(x > 0)) return;
    if (!confirm(`${who} CHF ${chf(x)} geben?`)) return;
    api('gift', { method: 'POST', body: JSON.stringify({ name: who, amount: x }) }).then((r) => {
      toast(`${r.name} hat jetzt CHF ${chf(r.bal)}`);
      P.list = null; loadPlayers(true); loadPlayer(who);
      if (r.name === S.name) pull();
    }).catch((e) => toast(e.message));
    return;
  }
  else if (a === 'rename') {
    const n = (prompt('Neuer Name (2 bis 20 Zeichen). Das Passwort bleibt gleich.', S.name) || '').trim();
    if (!n || n === S.name) return;
    api('rename', { method: 'POST', body: JSON.stringify({ name: n }) }).then((r) => {
      // Ungespeicherte Wetten auf diesem Gerät behalten, sonst den Serverstand übernehmen.
      if (dirty || pushing) { S.name = r.name; S.rev = r.rev; saveLocal(); render(); pushSoon(); }
      else adopt(r.rev, r.state);
      P.list = null;
      toast('Name geändert: ' + r.name);
    }).catch((e) => toast(e.message));
    return;
  }
  else if (a === 'logout') {
    if (!confirm('Abmelden? Mit Name und Passwort kommst du jederzeit wieder in dein Profil.')) return;
    const t = S.tok;
    fetch('/api/acc/logout', { method: 'POST', headers: { 'x-token': t } }).catch(() => {});
    return logoutLocal();
  }
  else if (a === 'introMode') { intro.mode = b.dataset.m; intro.err = ''; }
  else if (a === 'introFirst') return introFirst();
  else if (a === 'introNext') intro.step++;
  else if (a === 'introBack') { intro.step--; intro.err = ''; }
  else if (a === 'budget') intro.budget = +b.dataset.v;
  else if (a === 'introGo') return introFinish();
  render();
});
document.addEventListener('change', (ev) => { if (ev.target.dataset.act === 'lgSel') { V.lg = ev.target.value; render(); } });
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  if (ev.target.id === 'introName') $('#introPw')?.focus();
  if (ev.target.id === 'introPw') $('[data-act=introFirst]')?.click();
});
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'introName') { intro.name = ev.target.value; return; }
  if (ev.target.id === 'introPw') { intro.pw = ev.target.value; return; }
  if (ev.target.id === 'q') {
    V.q = ev.target.value;
    $('#qx').hidden = !V.q;
    if (V.tab !== 'wetten') { V.tab = 'wetten'; render(); } else renderList();
    return;
  }
  if (ev.target.id !== 'stake') return;
  S.stake = ev.target.value; V.warn = '';
  const w = $('.warn'); if (w) w.textContent = '';
  save(); renderSums();
});

window.addEventListener('storage', (e) => { if (e.key === LS) { S = load(); render(); } });
poll();
setInterval(poll, 30000);
setInterval(renderTop, 5000);
