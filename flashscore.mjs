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
export const FS_SPORT = { fussball: 1, tennis: 2, basketball: 3, eishockey: 4, amfootball: 5, rugby: 8, darts: 14 };
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
    if (f.AA && f.AE && f.AF && f.AD) {
      const n = (k) => (f[k] != null && f[k] !== '' && Number.isFinite(+f[k]) ? +f[k] : null);
      out.push({
        id: f.AA, start: +f.AD * 1000, home: f.AE, away: f.AF, hp: f.JA || '', ap: f.JB || '', st: +f.AB || 0, ac: +f.AC || 0, lg,
        g: [n('AG'), n('AH')], rt: [n('AT'), n('AU')], h1: [n('BC'), n('BD')], win: f.AS === '1' || f.AS === '2' ? f.AS : null,
        lh: f.OA ? IMG + f.OA : '', la: f.OB ? IMG + f.OB : '',
      });
    }
  }
  return out;
}
const IMG = 'https://www.flashscore.com/res/image/data/';

// Flashscore-Ligenname («LAND: Liga» oder «LAND: Liga - Runde») -> unsere Liga.
const FS_LEAGUES = {
  'sui.1': 'SWITZERLAND: Super League', 'sui.2': 'SWITZERLAND: Challenge League', 'sui.cup': ['SWITZERLAND: Swiss Cup', 'SWITZERLAND: Schweizer Cup'], 'fra.coupe_de_france': 'FRANCE: Coupe de France',
  'sui.3': 'SWITZERLAND: Promotion League', 'sui.4.1': 'SWITZERLAND: 1.Liga Classic Group 1', 'sui.4.2': 'SWITZERLAND: 1.Liga Classic Group 2', 'sui.4.3': 'SWITZERLAND: 1.Liga Classic Group 3',
  'ita.1': 'ITALY: Serie A', 'ita.2': 'ITALY: Serie B', 'ita.coppa_italia': 'ITALY: Coppa Italia',
  'ita.c.a': 'ITALY: Serie C - Group A', 'ita.c.b': 'ITALY: Serie C - Group B', 'ita.c.c': 'ITALY: Serie C - Group C', 'ita.d.i': 'ITALY: Serie D - Group I',
  'arg.1': 'ARGENTINA: Liga Profesional', 'arg.2': 'ARGENTINA: Primera Nacional', 'arg.3': 'ARGENTINA: Primera B', 'arg.4': 'ARGENTINA: Primera C', 'arg.5': 'ARGENTINA: Primera D',
  'arg.copa': 'ARGENTINA: Copa Argentina', 'arg.copa_de_la_superliga': 'ARGENTINA: Copa de la Liga Profesional', 'arg.trofeo_de_la_campeones': 'ARGENTINA: Trofeo de Campeones', 'arg.supercopa': ['ARGENTINA: Super Cup', 'ARGENTINA: Supercopa Argentina'],
  'ger.1': 'GERMANY: Bundesliga', 'ger.2': 'GERMANY: 2. Bundesliga', 'ger.dfb_pokal': ['GERMANY: DFB Pokal', 'GERMANY: DFB-Pokal'],
  'eng.1': 'ENGLAND: Premier League', 'eng.2': 'ENGLAND: Championship', 'eng.3': 'ENGLAND: League One', 'eng.4': 'ENGLAND: League Two', 'eng.5': 'ENGLAND: National League', 'eng.fa': 'ENGLAND: FA Cup', 'eng.league_cup': 'ENGLAND: EFL Cup',
  'esp.1': 'SPAIN: LaLiga', 'esp.2': 'SPAIN: LaLiga2', 'esp.copa_del_rey': 'SPAIN: Copa del Rey',
  'fra.1': 'FRANCE: Ligue 1', 'fra.2': 'FRANCE: Ligue 2', 'ned.1': 'NETHERLANDS: Eredivisie', 'ned.2': 'NETHERLANDS: Eerste Divisie',
  'rou.1': 'ROMANIA: Superliga', 'rou.2': 'ROMANIA: Liga 2',
  'por.1': 'PORTUGAL: Liga Portugal', 'bel.1': 'BELGIUM: Jupiler Pro League', 'aut.1': 'AUSTRIA: Bundesliga', 'tur.1': 'TURKEY: Super Lig', 'gre.1': 'GREECE: Super League',
  'sco.1': 'SCOTLAND: Premiership', 'sco.2': 'SCOTLAND: Championship', 'den.1': 'DENMARK: Superliga', 'swe.1': 'SWEDEN: Allsvenskan', 'nor.1': 'NORWAY: Eliteserien', 'rus.1': 'RUSSIA: Premier League',
  'bra.1': 'BRAZIL: Serie A', 'bra.2': 'BRAZIL: Serie B', 'uru.1': 'URUGUAY: Liga AUF Uruguaya', 'chi.1': 'CHILE: Liga de Primera', 'col.1': 'COLOMBIA: Primera A', 'per.1': 'PERU: Liga 1',
  'par.1': 'PARAGUAY: Copa de Primera', 'ecu.1': 'ECUADOR: Liga Pro', 'ven.1': 'VENEZUELA: Liga FUTVE', 'bol.1': 'BOLIVIA: Division Profesional', 'mex.1': 'MEXICO: Liga MX', 'usa.1': 'USA: MLS',
  'jpn.1': 'JAPAN: J1 League', 'chn.1': 'CHINA: Super League', 'ksa.1': 'SAUDI ARABIA: Saudi Professional League', 'aus.1': 'AUSTRALIA: A-League', 'rsa.1': 'SOUTH AFRICA: Betway Premiership',
  'uefa.champions': 'EUROPE: Champions League', 'uefa.europa': 'EUROPE: Europa League', 'uefa.europa.conf': 'EUROPE: Conference League',
  'uefa.nations': 'EUROPE: UEFA Nations League', 'uefa.euroq': 'EUROPE: Euro - Qualification', 'fifa.worldq.uefa': 'EUROPE: World Championship - Qualification',
  'fifa.worldq.conmebol': 'SOUTH AMERICA: World Championship - Qualification', 'fifa.worldq.concacaf': 'NORTH & CENTRAL AMERICA: World Championship - Qualification',
  'fifa.worldq.afc': 'ASIA: World Championship - Qualification', 'fifa.worldq.caf': 'AFRICA: World Championship - Qualification',
  'concacaf.nations.league': 'NORTH & CENTRAL AMERICA: CONCACAF Nations League', 'fifa.friendly': 'WORLD: Friendly International',
  'uefa.nations.w': 'EUROPE: UEFA Nations League Women', 'fifa.friendly.w': 'WORLD: Friendly International Women',
  'conmebol.libertadores': 'SOUTH AMERICA: Copa Libertadores', 'conmebol.sudamericana': 'SOUTH AMERICA: Copa Sudamericana',
  nhl: 'USA: NHL', 'sui.nl': 'SWITZERLAND: National League', 'sui.sl': 'SWITZERLAND: Swiss League', 'swe.shl': 'SWEDEN: SHL', 'nor.ehl': 'NORWAY: EHL', 'rus.khl': 'RUSSIA: KHL',
  nba: 'USA: NBA', wnba: 'USA: WNBA', 'mens-college-basketball': 'USA: NCAA', nbl: 'AUSTRALIA: NBL',
  euroleague: 'EUROPE: Euroleague', eurocup: 'EUROPE: EuroCup',
  nfl: 'USA: NFL', 'college-football': 'USA: NCAA',
  // Rugby: Flashscore führt einige Wettbewerbe je nach Saison unter EUROPE oder WORLD, darum mehrere Namen.
  'rug.top14': 'FRANCE: Top 14', 'rug.prod2': 'FRANCE: Pro D2', 'rug.prem': ['ENGLAND: Premiership Rugby', 'ENGLAND: Premiership'],
  'rug.urc': ['WORLD: United Rugby Championship', 'EUROPE: United Rugby Championship'], 'rug.cc': ['EUROPE: Champions Cup', 'EUROPE: European Rugby Champions Cup'],
  'rug.six': ['EUROPE: Six Nations', 'WORLD: Six Nations'], 'rug.rc': 'WORLD: The Rugby Championship', 'rug.nc': ['WORLD: Nations Championship', 'WORLD: World Rugby Nations Cup'],
  'rug.friendly': 'WORLD: Friendly International', 'rug.super': ['WORLD: Super Rugby', 'WORLD: Super Rugby Pacific'], 'rug.wc': 'WORLD: World Cup',
};
const FS_SPORT_OF = (slug) => (/^(nhl|sui\.nl|sui\.sl|swe\.shl|nor\.ehl|rus\.khl)$/.test(slug) ? 'eishockey' : /^(nba|wnba|mens-college-basketball|nbl|euroleague|eurocup)$/.test(slug) ? 'basketball'
  : /^(nfl|college-football)$/.test(slug) ? 'amfootball' : slug.startsWith('rug.') ? 'rugby' : 'fussball');
export function fsLeague(sport, name) {
  if (sport === 'tennis') return /^ATP - SINGLES:/.test(name) ? 'atp' : /^WTA - SINGLES:/.test(name) ? 'wta' : null;
  // Darts: alle Turniere der Welt- und Europa-Tour, ohne Junioren, Frauen-Nebenturniere und Paare
  if (sport === 'darts') return /^(WORLD|EUROPE):/.test(name) && !/youth|women|pairs|modus|junior/i.test(name) ? 'darts' : null;
  for (const [slug, keys] of Object.entries(FS_LEAGUES)) {
    if (FS_SPORT_OF(slug) !== sport) continue;
    for (const key of [].concat(keys)) if (name === key || name.startsWith(key + ' - ')) return slug;
  }
  return null;
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
  const soccer = sport === 'fussball', ice = sport === 'eishockey', rugby = sport === 'rugby', afb = sport === 'amfootball';
  const basket = sport === 'basketball' || afb || rugby; // Punktesportarten: nur die Haupt-Linie bei Über/Unter
  const books = new Map((j.settings?.bookmakers || []).map((b) => [b.bookmaker.id, NAMES[b.bookmaker.id] || b.bookmaker.name.replace(/\.(de|it|dk|com)$/i, '')]));
  const order = [...PRIO.filter((id) => books.has(id)), ...[...books.keys()].filter((id) => !PRIO.includes(id))];
  const mk = new Map(); // Markt -> Map(Anbieter -> Quoten)
  const put = (key, bid, obj) => { if (!mk.has(key)) mk.set(key, new Map()); mk.get(key).set(bid, obj); };
  const side = (i) => (i.eventParticipantId && i.eventParticipantId === hp ? '1' : i.eventParticipantId && i.eventParticipantId === ap ? '2' : null);
  const fullOT = basket && !rugby ? 'FULL_TIME_OVER_TIME' : 'FULL_TIME';

  for (const o of j.odds) {
    const items = (o.odds || []).filter((i) => i.active !== false && +i.value > 1.001);
    if (!items.length) continue;
    const T = o.bettingType, S = o.bettingScope, b = o.bookmakerId;
    // Darts: nur der Sieger (Über/Unter und Handicap zählen je nach Turnier Legs oder Sätze)
    if (sport === 'darts' && T !== 'HOME_AWAY') continue;
    if (T === 'HOME_DRAW_AWAY' && (soccer || ice || rugby) &&(S === 'FULL_TIME' || (soccer && !nohalf && S === 'FIRST_HALF'))) {
      const w = {};
      for (const i of items) { const s = side(i); if (s) w[s] = val(i); else if (!i.eventParticipantId) w.X = val(i); }
      if (w[1] && w.X && w[2]) put(S === 'FULL_TIME' ? '1x2' : 'h1', b, w);
    } else if (T === 'HOME_AWAY' && (S === 'FULL_TIME_OVER_TIME' || S === 'FULL_TIME') && !soccer) {
      const w = {};
      for (const i of items) { const s = side(i); if (s) w[s] = val(i); }
      if (w[1] && w[2]) put('ml', b, w);
    } else if (T === 'DOUBLE_CHANCE' && S === 'FULL_TIME' && (soccer || ice || rugby)) {
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

  const mainKey = soccer || ((ice || rugby) && mk.has('1x2')) ? '1x2' : 'ml';
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
