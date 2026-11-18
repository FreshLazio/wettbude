// Flashscore als Hauptquelle für Buchmacherquoten (auf Wunsch des Nutzers, nur für den eigenen Gebrauch).
// 1. Spielliste pro Sportart und Tag (enthält Teamnamen, Anstoss, Teilnehmer-IDs).
// 2. Quotenvergleich pro Spiel: alle Anbieter mit allen Märkten.
// Pro Spiel kommen alle Quoten vom ersten Anbieter in der Reihenfolge bet365, Interwetten, dann die übrigen.
// Hat er einen Markt nicht, springt der nächste ein.

const LIST = 'https://www.flashscore.com/x/feed/';
const ODDS = 'https://global.ds.lsapp.eu/odds/pq_graphql?_hash=oce&projectId=4&geoIpCode=CH&geoIpSubdivisionCode=CHBE&eventId=';
const HDR = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
  'x-fsign': 'SW9D1eZo',
  referer: 'https://www.flashscore.com/',
};
export const FS_SPORT = { fussball: 1, tennis: 2, basketball: 3, eishockey: 4 };
const PRIO = [16, 1]; // bet365, Interwetten
const NAMES = { 16: 'bet365', 1: 'Interwetten', 645: 'bet-at-home', 3: 'bet-at-home' };

async function get(url, json) {
  const r = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return json ? r.json() : r.text();
}

// Spielliste: day = 0 heute, 1 morgen, ...
export async function fsList(sportId, day) {
  const t = await get(`${LIST}f_${sportId}_${day}_1_en_1`);
  const out = [];
  let lg = '';
  for (const rec of t.split('¬~')) {
    const f = {};
    for (const kv of rec.split('¬')) { const i = kv.indexOf('÷'); if (i > 0) f[kv.slice(0, i)] = kv.slice(i + 1); }
    if (f.ZA) lg = f.ZA;
    if (f.AA && f.AE && f.AF && f.AD) out.push({ id: f.AA, start: +f.AD * 1000, home: f.AE, away: f.AF, hp: f.JA || '', ap: f.JB || '', st: +f.AB || 0, lg });
  }
  return out;
}

/* ---------- Zuordnung zu unseren Spielen ---------- */

const STOP = new Set(['fc', 'cf', 'ac', 'as', 'sc', 'ss', 'us', 'ssd', 'asd', 'afc', 'cd', 'ca', 'club', 'de', 'la', 'el', 'hc', 'ehc', 'ev', 'ec', 'hk', 'if', 'ik', 'bk', 'fk', 'sk', 'the', 'and', 'calcio', 'sv', 'vfl', 'vfb', 'tsg', 'rc', 'cs', 'sd', 'ud', 'cp', 'fbc', 'acd', 'ssc', 'srl', 'women', 'w']);
const toks = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
  .split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));
function sim(a, b) {
  const A = toks(a), B = toks(b);
  if (!A.length || !B.length) return 0;
  if (A.join('') === B.join('')) return 1;
  const hit = (t, L) => L.some((u) => t === u || (t.length >= 4 && u.length >= 4 && (t.startsWith(u) || u.startsWith(t))));
  const n = A.filter((t) => hit(t, B)).length;
  return n / Math.min(A.length, B.length);
}

// Bestes Flashscore-Spiel zu einem unserer Spiele: gleiche Sportart, Anstoss nahe, beide Namen passen.
export function fsMatch(ev, cands) {
  let best = null, bs = 0;
  for (const c of cands) {
    const dt = Math.abs(c.start - ev.start);
    if (dt > 3 * 36e5) continue;
    const sh = sim(ev.home.n, c.home), sa = sim(ev.away.n, c.away);
    // genaue Zeit: beide Namen halbwegs; Zeit daneben (andere Quelle, Zeitzone): beide Namen klar
    const ok = dt <= 20 * 6e4 ? sh >= 0.5 && sa >= 0.5 : sh >= 0.99 && sa >= 0.99;
    const s = sh + sa - dt / 36e5;
    if (ok && s > bs) { bs = s; best = c; }
  }
  return best;
}

/* ---------- Quoten ---------- */

const half = (x) => Number.isFinite(x) && Math.abs(x * 2 - Math.round(x * 2)) < 1e-9 && Math.abs(x % 1) === 0.5;
const val = (i) => Math.round(+i.value * 100) / 100;

export async function fsOdds(fsId, hp, ap, sport, { nohalf = false } = {}) {
  const j = (await get(ODDS + encodeURIComponent(fsId), true))?.data?.findOddsByEventId;
  if (!j?.odds?.length) return null;
  return parseOdds(j, hp, ap, sport, nohalf);
}

export function parseOdds(j, hp, ap, sport, nohalf) {
  const soccer = sport === 'fussball', ice = sport === 'eishockey', basket = sport === 'basketball';
  const books = new Map((j.settings?.bookmakers || []).map((b) => [b.bookmaker.id, NAMES[b.bookmaker.id] || b.bookmaker.name.replace(/\.(de|it|dk|com)$/i, '')]));
  const order = [...PRIO.filter((id) => books.has(id)), ...[...books.keys()].filter((id) => !PRIO.includes(id))];
  const mk = new Map(); // Markt -> Map(Anbieter -> Quoten)
  const put = (key, bid, obj) => { if (!mk.has(key)) mk.set(key, new Map()); mk.get(key).set(bid, obj); };
  const side = (i) => (i.eventParticipantId && i.eventParticipantId === hp ? '1' : i.eventParticipantId && i.eventParticipantId === ap ? '2' : null);
  const fullOT = basket ? 'FULL_TIME_OVER_TIME' : 'FULL_TIME';

  for (const o of j.odds) {
    const items = (o.odds || []).filter((i) => i.active !== false && +i.value > 1.001);
    if (!items.length) continue;
    const T = o.bettingType, S = o.bettingScope, b = o.bookmakerId;
    if (T === 'HOME_DRAW_AWAY' && (soccer || ice) && (S === 'FULL_TIME' || (soccer && !nohalf && S === 'FIRST_HALF'))) {
      const w = {};
      for (const i of items) { const s = side(i); if (s) w[s] = val(i); else if (!i.eventParticipantId) w.X = val(i); }
      if (w[1] && w.X && w[2]) put(S === 'FULL_TIME' ? '1x2' : 'h1', b, w);
    } else if (T === 'HOME_AWAY' && (S === 'FULL_TIME_OVER_TIME' || S === 'FULL_TIME') && !soccer) {
      const w = {};
      for (const i of items) { const s = side(i); if (s) w[s] = val(i); }
      if (w[1] && w[2]) put('ml', b, w);
    } else if (T === 'DOUBLE_CHANCE' && S === 'FULL_TIME' && (soccer || ice)) {
      const w = {};
      for (const i of items) { const s = side(i); w[s === '1' ? '1X' : s === '2' ? 'X2' : '12'] = val(i); }
      if (w['1X'] && w['12'] && w.X2) put('dc', b, w);
    } else if (T === 'DRAW_NO_BET' && S === 'FULL_TIME' && (soccer || ice)) {
      const w = {};
      for (const i of items) { const s = side(i); if (s) w[s] = val(i); }
      if (w[1] && w[2]) put('dnb', b, w);
    } else if (T === 'BOTH_TEAMS_TO_SCORE' && S === 'FULL_TIME' && soccer) {
      const w = {};
      for (const i of items) if (i.bothTeamsToScore != null) w[i.bothTeamsToScore ? 'J' : 'N'] = val(i);
      if (w.J && w.N) put('btts', b, w);
    } else if (T === 'CORRECT_SCORE' && S === 'FULL_TIME' && soccer) {
      const w = {};
      for (const i of items) if (/^\d+:\d+$/.test(i.score || '')) w[i.score] = val(i);
      if (Object.keys(w).length >= 4) put('cs', b, w);
    } else if (T === 'OVER_UNDER' && (S === fullOT || (soccer && !nohalf && S === 'FIRST_HALF'))) {
      const lines = new Map();
      for (const i of items) {
        const L = +i.handicap?.value;
        if (!half(L) || !i.selection) continue;
        if (!lines.has(L)) lines.set(L, {});
        lines.get(L)[i.selection === 'OVER' ? 'O' : 'U'] = val(i);
      }
      const pre = S === 'FIRST_HALF' ? 'h1ou' : 'ou';
      for (const [L, x] of lines) if (x.O && x.U) put(pre + L, b, { line: L, ...x });
    } else if (T === 'ASIAN_HANDICAP' && S === fullOT && !soccer) {
      // Handicap nur bei Eishockey und Basketball (beim Fussball hat es genug andere Märkte).
      const hs = items.filter((i) => side(i) === '1'), as = items.filter((i) => side(i) === '2');
      let best = null;
      for (const h of hs) {
        const L = +h.handicap?.value;
        if (!half(L)) continue;
        const a = as.find((x) => +x.handicap?.value === -L);
        if (!a) continue;
        const d = Math.abs(val(h) - val(a));
        if (!best || d < best.d) best = { d, line: L, 1: val(h), 2: val(a) };
      }
      if (best) put('hc', b, { line: best.line, 1: best[1], 2: best[2] });
    }
  }

  const mainKey = soccer || (ice && mk.has('1x2')) ? '1x2' : 'ml';
  if (!mk.has(mainKey)) return null;
  const pick = (key) => { const m = mk.get(key); const bid = order.find((id) => m?.has(id)) ?? [...(m?.keys() || [])][0]; return bid == null ? null : [bid, m.get(bid)]; };
  const [mainBid] = pick(mainKey);
  const book = books.get(mainBid) || 'Buchmacher';
  const nameOf = (bid) => books.get(bid) || 'Buchmacher';
  const tagW = (w, bid) => Object.fromEntries(Object.entries(w).map(([k, o]) => [k, { o, b: nameOf(bid) }]));
  const m = {};
  // Basketball: nur die Hauptlinie (Quoten am nächsten bei 50:50)
  if (basket) {
    const all = [...mk.keys()].filter((k) => /^ou\d/.test(k));
    let best = null;
    for (const k of all) { const p = pick(k); const d = Math.abs(p[1].O - p[1].U) + (p[0] === mainBid ? 0 : 10); if (!best || d < best.d) best = { d, k }; }
    for (const k of all) if (k !== best?.k) mk.delete(k);
  }
  for (const key of mk.keys()) {
    const [bid, x] = pick(key);
    if (x.line != null) {
      const k = basket && key.startsWith('ou') ? 'ou' : key;
      m[k] = key.includes('ou') ? { line: x.line, O: { o: x.O, b: nameOf(bid) }, U: { o: x.U, b: nameOf(bid) } } : { line: x.line, 1: { o: x[1], b: nameOf(bid) }, 2: { o: x[2], b: nameOf(bid) } };
    } else m[key] = tagW(x, bid);
  }
  const cmp = {};
  for (const [bid, w] of mk.get(mainKey)) cmp[nameOf(bid)] = w;
  return { book, m, cmp };
}
