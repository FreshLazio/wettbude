// Wettbude: Sportwetten mit Spielgeld. Holt Spielpläne, Resultate und Quoten von ESPN
// (DraftKings im Scoreboard, bet365 im Core-API) und liefert sie an die Oberfläche in public/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FD, FD_LEAGUES, parseFixtures, parseResults } from './fd.mjs';
import zlib from 'node:zlib';
import { fit, derive, fromTable, oneXtwo, hockey, hockeyFit } from './model.mjs';
import { TS_LEAGUES, tsStart } from './tsdb.mjs';
import { FS_SPORT, fsList, fsMatch, fsOdds } from './flashscore.mjs';
import { accounts } from './accounts.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(DIR, 'public');
const DATA = path.join(DIR, 'data');
const STORE = path.join(DATA, 'store.json');
const PORT = +process.env.PORT || 5211;
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
const CORE = 'https://sports.core.api.espn.com/v2/sports/';
const DAY = 864e5;

const F = 'fussball', B = 'basketball', H = 'eishockey', T = 'tennis';
const LEAGUES = [
  [F, 'soccer', 'sui.1', 'Super League', 'Schweiz'],
  [F, 'soccer', 'sui.2', 'Challenge League', 'Schweiz'],
  [F, 'soccer', 'sui.cup', 'Schweizer Cup', 'Schweiz'],
  [F, 'soccer', 'ita.1', 'Serie A', 'Italien'],
  [F, 'soccer', 'ita.2', 'Serie B', 'Italien'],
  [F, 'soccer', 'ita.coppa_italia', 'Coppa Italia', 'Italien'],
  [F, 'soccer', 'arg.1', 'Liga Profesional', 'Argentinien'],
  [F, 'soccer', 'arg.2', 'Primera Nacional', 'Argentinien'],
  [F, 'soccer', 'arg.3', 'Primera B', 'Argentinien'],
  [F, 'soccer', 'arg.4', 'Primera C', 'Argentinien'],
  [F, 'soccer', 'arg.5', 'Primera D', 'Argentinien'],
  [F, 'soccer', 'arg.copa', 'Copa Argentina', 'Argentinien'],
  [F, 'soccer', 'arg.copa_de_la_superliga', 'Copa de la Liga', 'Argentinien'],
  [F, 'soccer', 'arg.trofeo_de_la_campeones', 'Trofeo de Campeones', 'Argentinien'],
  [F, 'soccer', 'arg.supercopa', 'Supercopa Argentina', 'Argentinien'],
  [F, 'soccer', 'ger.1', 'Bundesliga', 'Deutschland'],
  [F, 'soccer', 'ger.2', '2. Bundesliga', 'Deutschland'],
  [F, 'soccer', 'ger.dfb_pokal', 'DFB-Pokal', 'Deutschland'],
  [F, 'soccer', 'eng.1', 'Premier League', 'England'],
  [F, 'soccer', 'eng.2', 'Championship', 'England'],
  [F, 'soccer', 'eng.3', 'League One', 'England'],
  [F, 'soccer', 'eng.4', 'League Two', 'England'],
  [F, 'soccer', 'eng.5', 'National League', 'England'],
  [F, 'soccer', 'eng.fa', 'FA Cup', 'England'],
  [F, 'soccer', 'eng.league_cup', 'League Cup', 'England'],
  [F, 'soccer', 'esp.1', 'LaLiga', 'Spanien'],
  [F, 'soccer', 'esp.2', 'LaLiga 2', 'Spanien'],
  [F, 'soccer', 'esp.copa_del_rey', 'Copa del Rey', 'Spanien'],
  [F, 'soccer', 'fra.1', 'Ligue 1', 'Frankreich'],
  [F, 'soccer', 'fra.2', 'Ligue 2', 'Frankreich'],
  [F, 'soccer', 'ned.1', 'Eredivisie', 'Niederlande'],
  [F, 'soccer', 'ned.2', 'Eerste Divisie', 'Niederlande'],
  [F, 'soccer', 'por.1', 'Primeira Liga', 'Portugal'],
  [F, 'soccer', 'bel.1', 'Pro League', 'Belgien'],
  [F, 'soccer', 'aut.1', 'Bundesliga', 'Österreich'],
  [F, 'soccer', 'tur.1', 'Süper Lig', 'Türkei'],
  [F, 'soccer', 'gre.1', 'Super League', 'Griechenland'],
  [F, 'soccer', 'sco.1', 'Premiership', 'Schottland'],
  [F, 'soccer', 'sco.2', 'Championship', 'Schottland'],
  [F, 'soccer', 'den.1', 'Superliga', 'Dänemark'],
  [F, 'soccer', 'swe.1', 'Allsvenskan', 'Schweden'],
  [F, 'soccer', 'nor.1', 'Eliteserien', 'Norwegen'],
  [F, 'soccer', 'rus.1', 'Premier Liga', 'Russland'],
  [F, 'soccer', 'bra.1', 'Série A', 'Brasilien'],
  [F, 'soccer', 'bra.2', 'Série B', 'Brasilien'],
  [F, 'soccer', 'uru.1', 'Primera División', 'Uruguay'],
  [F, 'soccer', 'chi.1', 'Primera División', 'Chile'],
  [F, 'soccer', 'col.1', 'Primera A', 'Kolumbien'],
  [F, 'soccer', 'per.1', 'Liga 1', 'Peru'],
  [F, 'soccer', 'par.1', 'Primera División', 'Paraguay'],
  [F, 'soccer', 'ecu.1', 'LigaPro', 'Ecuador'],
  [F, 'soccer', 'ven.1', 'Primera División', 'Venezuela'],
  [F, 'soccer', 'bol.1', 'División Profesional', 'Bolivien'],
  [F, 'soccer', 'mex.1', 'Liga MX', 'Mexiko'],
  [F, 'soccer', 'usa.1', 'MLS', 'USA'],
  [F, 'soccer', 'jpn.1', 'J1 League', 'Japan'],
  [F, 'soccer', 'chn.1', 'Super League', 'China'],
  [F, 'soccer', 'ksa.1', 'Saudi Pro League', 'Saudi-Arabien'],
  [F, 'soccer', 'aus.1', 'A-League', 'Australien'],
  [F, 'soccer', 'rsa.1', 'Premiership', 'Südafrika'],
  [F, 'soccer', 'uefa.champions', 'Champions League', 'International'],
  [F, 'soccer', 'uefa.europa', 'Europa League', 'International'],
  [F, 'soccer', 'uefa.europa.conf', 'Conference League', 'International'],
  [F, 'soccer', 'uefa.nations', 'Nations League', 'Länderspiele'],
  [F, 'soccer', 'uefa.euroq', 'EM-Qualifikation', 'Länderspiele'],
  [F, 'soccer', 'fifa.worldq.uefa', 'WM-Qualifikation Europa', 'Länderspiele'],
  [F, 'soccer', 'fifa.worldq.conmebol', 'WM-Qualifikation Südamerika', 'Länderspiele'],
  [F, 'soccer', 'fifa.worldq.concacaf', 'WM-Qualifikation Nord-/Mittelamerika', 'Länderspiele'],
  [F, 'soccer', 'fifa.worldq.afc', 'WM-Qualifikation Asien', 'Länderspiele'],
  [F, 'soccer', 'fifa.worldq.caf', 'WM-Qualifikation Afrika', 'Länderspiele'],
  [F, 'soccer', 'concacaf.nations.league', 'CONCACAF Nations League', 'Länderspiele'],
  [F, 'soccer', 'fifa.friendly', 'Freundschaftsspiele', 'Länderspiele'],
  [F, 'soccer', 'uefa.nations.w', 'Nations League Frauen', 'Länderspiele'],
  [F, 'soccer', 'fifa.friendly.w', 'Freundschaftsspiele Frauen', 'Länderspiele'],
  [F, 'soccer', 'conmebol.libertadores', 'Copa Libertadores', 'International'],
  [F, 'soccer', 'conmebol.sudamericana', 'Copa Sudamericana', 'International'],
  [T, 'tennis', 'atp', 'ATP', 'Herren'],
  [T, 'tennis', 'wta', 'WTA', 'Damen'],
  [H, 'hockey', 'nhl', 'NHL', 'USA/Kanada'],
  [B, 'basketball', 'nba', 'NBA', 'USA'],
  [B, 'basketball', 'wnba', 'WNBA', 'USA'],
  [B, 'basketball', 'mens-college-basketball', 'NCAA', 'USA'],
  [B, 'basketball', 'nbl', 'NBL', 'Australien'],
].map(([sport, es, slug, name, land]) => ({ sport, es, slug, name, land, dead: false }));
// Ligen aus TheSportsDB (Serie C/D, Eishockey Europa) hinter der jeweiligen Sportart einreihen.
for (const L of TS_LEAGUES) {
  const at = LEAGUES.findLastIndex((x) => x.sport === L.sport && (L.land !== 'Italien' || x.land === 'Italien'));
  LEAGUES.splice(at + 1, 0, L);
}

const store = new Map();
const points = new Map(); // Tennis: Athleten-ID -> Ranglistenpunkte
let lastSweep = 0;
let saveTimer = null;

const r2 = (x) => Math.round(x * 100) / 100;
const halfLine = (x) => Number.isFinite(x) && Math.abs(x * 2 - Math.round(x * 2)) < 1e-9;

async function getJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0 (wettbude)' } });
  if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
  return r.json();
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const it = items[i++];
      try { await fn(it); } catch { /* einzelne Fehler überspringen, nächster Sweep holt es nach */ }
    }
  }));
}

// amerikanische Quote (-360, +750, "EVEN") -> Dezimalquote
function american(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const s = v.trim().toUpperCase();
    if (s === 'EVEN' || s === 'EV' || s === 'EVS') return 2;
    v = parseFloat(s.replace('+', ''));
  }
  if (!Number.isFinite(v) || v === 0) return null;
  const d = v > 0 ? 1 + v / 100 : 1 + 100 / -v;
  return d > 1.005 ? r2(d) : null;
}

// Bruchquote ("5/1", "EVS") -> Dezimalquote
function frac(v) {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  if (s === 'EVS' || s === 'EVENS' || s === 'EVEN') return 2;
  const m = s.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (!m || +m[2] === 0) return null;
  const d = 1 + m[1] / m[2];
  return d > 1.005 ? r2(d) : null;
}

function parseDK(o, soccer) {
  if (!o) return null;
  const ml = o.moneyline || {};
  const out = {};
  const h = american(ml.home?.close?.odds ?? o.homeTeamOdds?.moneyLine);
  const a = american(ml.away?.close?.odds ?? o.awayTeamOdds?.moneyLine);
  const d = american(ml.draw?.close?.odds ?? o.drawOdds?.moneyLine);
  if (h && a && (!soccer || d)) out.w = soccer ? { 1: h, X: d, 2: a } : { 1: h, 2: a };
  const tl = parseFloat(String(o.total?.over?.close?.line ?? '').replace(/^[ou]/i, ''));
  const line = Number.isFinite(tl) ? tl : +o.overUnder;
  const O = american(o.total?.over?.close?.odds), U = american(o.total?.under?.close?.odds);
  if (halfLine(line) && line > 0 && O && U) out.ou = { line, O, U };
  const sl = parseFloat(o.pointSpread?.home?.close?.line);
  const s1 = american(o.pointSpread?.home?.close?.odds), s2 = american(o.pointSpread?.away?.close?.odds);
  if (halfLine(sl) && sl !== 0 && s1 && s2) out.hc = { line: sl, 1: s1, 2: s2 };
  return Object.keys(out).length ? out : null;
}

function parseB365(items) {
  const it = (items || []).find((i) => String(i.provider?.id) === '2000');
  const t = it?.bettingOdds?.teamOdds;
  if (!t) return null;
  const v = (k) => frac(t[k]?.value);
  const out = {};
  const h = v('preMatchFullTimeResultHome'), d = v('preMatchFullTimeResultDraw'), a = v('preMatchFullTimeResultAway');
  if (h && d && a) out.w = { 1: h, X: d, 2: a };
  const dc = { '1X': v('preMatchDoubleChanceHomeOrDraw'), 12: v('preMatchDoubleChanceHomeOrAway'), X2: v('preMatchDoubleChanceDrawOrAway') };
  if (dc['1X'] && dc[12] && dc.X2) out.dc = dc;
  const raw = String(t.preMatchOverUnderHandicap?.value ?? '').trim();
  const line = /^\d+(\.\d+)?$/.test(raw) ? +raw : NaN;
  const O = v('preMatchGoalLineOver'), U = v('preMatchGoalLineUnder');
  if (halfLine(line) && line > 0 && O && U) out.ou = { line, O, U };
  const scorers = (k) => {
    const list = (it.bettingOdds.playerOdds?.[k] || []).map((x) => [String(x.player || '').trim(), frac(x.value)]).filter(([n, o]) => n && o && !n.includes('|'));
    list.sort((a, b) => a[1] - b[1]);
    return list.length ? Object.fromEntries(list.slice(0, 30)) : null;
  };
  const gsa = scorers('preMatchAnyTimeGoalScorer'), gsf = scorers('preMatchFirstGoalScorer');
  if (gsa) out.gsa = gsa;
  if (gsf) out.gsf = gsf;
  return Object.keys(out).length ? out : null;
}

// Reihenfolge der Buchmacher: alle Quoten eines Spiels kommen vom ersten, der welche hat.
// Fehlt ihm ein Markt (z. B. Handicap), springt der nächste ein.
const ORDER = [['bet365', 'b365'], ['Pinnacle', 'pin'], ['DraftKings', 'dk'], ['Modell', 'mod']];
const tag = (obj, b) => Object.fromEntries(Object.entries(obj).map(([k, o]) => [k, { o, b }]));

function build(ev) {
  const s = ev.src || {};
  const soccer = ev.sport === F;
  if (s.fs?.m && Object.keys(s.fs.m).length) {
    // Flashscore hat Vorrang: alle Märkte vom ersten Anbieter (bet365, Interwetten, ...).
    const m = { ...s.fs.m };
    ev.book = s.fs.book;
    if (soccer && m['1x2']) {
      // Fehlende Tormärkte aus seiner Linie berechnen (beschriftet als «berechnet»).
      try {
        const w = Object.fromEntries(Object.entries(m['1x2']).map(([k, x]) => [k, x.o]));
        const main = m['ou2.5'] ? { line: 2.5, O: m['ou2.5'].O.o, U: m['ou2.5'].U.o } : null;
        const der = derive(fit(w, main), 'berechnet', { half: !ev.nohalf });
        for (const k in der) if (!m[k]) m[k] = der[k];
      } catch { /* ohne Zusatzmärkte */ }
    }
    if (s.b365?.gsa) m.gsa = tag(s.b365.gsa, 'bet365');
    if (s.b365?.gsf) m.gsf = tag(s.b365.gsf, 'bet365');
    ev.m = m;
    ev.cmp = s.fs.cmp || {};
    return;
  }
  const m = {};
  const first = (k) => ORDER.find(([, id]) => s[id]?.[k]);
  const prim = first('w');
  const ouB = first('ou');
  const ou = ouB ? s[ouB[1]].ou : null;
  const ice = ev.sport === H;
  if (prim && ice) {
    // Eishockey wie bei bet365: 1X2 nach 60 Minuten. Liefert der Buchmacher nur den Sieger
    // inkl. Verlängerung, wird die Unentschieden-Quote aus seiner Linie berechnet.
    const w = s[prim[1]].w;
    if (w.X) m['1x2'] = tag(w, prim[0]);
    else {
      try { m['1x2'] = tag(hockey(hockeyFit(w, ou)).w, 'berechnet'); } catch { /* ohne 1X2 */ }
      m.ml = tag(w, prim[0]);
    }
  } else if (prim) m[soccer ? '1x2' : 'ml'] = tag(s[prim[1]].w, prim[0]);
  ev.book = prim?.[0] || '';
  const dcB = first('dc');
  if (dcB) m.dc = tag(s[dcB[1]].dc, dcB[0]);
  if (ou) m[soccer ? 'ou' + ou.line : 'ou'] = { line: ou.line, O: { o: ou.O, b: ouB[0] }, U: { o: ou.U, b: ouB[0] } };
  if (!ou) for (const x of s.mod?.ous || []) m['ou' + x.line] = { line: x.line, O: { o: x.O, b: 'Modell' }, U: { o: x.U, b: 'Modell' } };
  const hcB = first('hc');
  if (hcB) { const hc = s[hcB[1]].hc; m.hc = { line: hc.line, 1: { o: hc[1], b: hcB[0] }, 2: { o: hc[2], b: hcB[0] } }; }
  if (soccer && prim) {
    // Weitere Tormärkte aus der Linie des Buchmachers berechnet.
    try {
      const lam = (prim[1] === 'mod' && s.lam) || fit(s[prim[1]].w, ou);
      const der = derive(lam, 'berechnet', { half: !ev.nohalf, skipOu: ou?.line });
      for (const k in der) if (!m[k]) m[k] = der[k];
    } catch { /* ohne Zusatzmärkte weiter */ }
  }
  if (s.b365?.gsa) m.gsa = tag(s.b365.gsa, 'bet365');
  if (s.b365?.gsf) m.gsf = tag(s.b365.gsf, 'bet365');
  ev.m = m;
  const cmp = {};
  for (const [b, id] of ORDER) if (s[id]?.w) cmp[b] = s[id].w;
  ev.cmp = cmp;
}

function upsert(n) {
  const o = store.get(n.id);
  if (o) {
    // Quoten nur vor Anpfiff erneuern, danach die letzten bekannten behalten.
    n.src = n.state === 'pre' ? { ...o.src, ...n.src } : o.src;
    n.b365At = o.b365At;
    for (const k of ['fsId', 'fsH', 'fsA', 'fsAt']) if (o[k] != null && n[k] == null) n[k] = o[k];
    if (!n.day) n.day = o.day;
    if ((n.done || n.void) && !(o.done || o.void)) queueSave();
  }
  store.set(n.id, n);
  build(n);
}

const num = (x) => { const v = parseInt(x, 10); return Number.isFinite(v) ? v : null; };

function parseEvent(L, e, day) {
  const c = e.competitions?.[0];
  if (!c) return null;
  const hc = c.competitors?.find((x) => x.homeAway === 'home'), ac = c.competitors?.find((x) => x.homeAway === 'away');
  if (!hc?.team || !ac?.team) return null;
  const st = e.status?.type || {};
  const name = st.name || '';
  const team = (x) => ({ id: String(x.team.id || ''), n: x.team.displayName || x.team.name, s: x.team.shortDisplayName || x.team.abbreviation || x.team.displayName, l: x.team.logo || '' });
  const soccer = L.sport === F;
  const dk = parseDK(c.odds?.[0], soccer);
  const sh = num(hc.score), sa = num(ac.score);
  // Fussball: Tore mit Minute und Schütze, daraus Halbzeitstand und Torschützen-Abrechnung.
  let goals = null, h1 = null;
  if (soccer && st.state !== 'pre') {
    const list = [];
    for (const d of c.details || []) {
      if (!d.scoringPlay || d.shootout) continue;
      const min = parseInt(d.clock?.displayValue, 10) || Math.round((d.clock?.value || 0) / 60);
      list.push({ m: min, t: String(d.team?.id) === String(hc.team.id) ? '1' : '2', n: d.athletesInvolved?.[0]?.displayName || '', og: !!d.ownGoal });
    }
    const fits = (l) => l.filter((g) => g.t === '1').length === sh && l.filter((g) => g.t === '2').length === sa;
    let ok = fits(list);
    if (!ok) { // Eigentore zählen je nach Feed für das andere Team
      const flipped = list.map((g) => (g.og ? { ...g, t: g.t === '1' ? '2' : '1' } : g));
      if (fits(flipped)) { list.splice(0, list.length, ...flipped); ok = true; }
    }
    if (ok) {
      goals = list;
      if (st.completed || (e.status?.period || 0) >= 2) h1 = [list.filter((g) => g.t === '1' && g.m <= 45).length, list.filter((g) => g.t === '2' && g.m <= 45).length];
    }
  }
  return {
    goals, h1,
    id: String(e.id), sport: L.sport, lg: L.slug, start: Date.parse(e.date), day,
    home: team(hc), away: team(ac),
    state: st.state || 'pre', done: !!st.completed,
    void: /POSTPON|CANCEL|ABANDON|FORFEIT/.test(name),
    et: soccer && /AET|PEN/.test(name),
    // Eishockey: nach Verlängerung oder Penaltyschiessen stand es nach 60 Minuten unentschieden.
    ot: L.sport === H && !!st.completed && (/OT|SO|SHOOTOUT/i.test(name) || /\b(OT|SO)\b/.test(st.shortDetail || '')),
    txt: st.shortDetail || '', sh, sa,
    src: dk ? { dk } : {},
  };
}

function tennisOdds(a, b) {
  const pa = Math.max(points.get(a) || 150, 50) ** 1.3, pb = Math.max(points.get(b) || 150, 50) ** 1.3;
  const p = pa / (pa + pb);
  const q = (x) => Math.max(1.02, r2(1 / (x * 1.06)));
  return { 1: q(p), 2: q(1 - p) };
}

function parseTennis(L, j) {
  for (const e of j.events || []) {
    for (const g of e.groupings || []) {
      if (!/singles/.test(g.grouping?.slug || '')) continue;
      for (const c of g.competitions || []) {
        const cs = [...(c.competitors || [])].sort((x, y) => (x.order || 0) - (y.order || 0));
        if (cs.length !== 2 || cs.some((x) => !x.athlete || +x.id < 0 || /^TBD$/i.test(x.athlete.displayName || ''))) continue;
        const st = c.status?.type || {};
        const name = st.name || '';
        const sets = [0, 0];
        const n = Math.max(cs[0].linescores?.length || 0, cs[1].linescores?.length || 0);
        for (let i = 0; i < n; i++) {
          const x = cs[0].linescores?.[i]?.value, y = cs[1].linescores?.[i]?.value;
          if (x > y) sets[0]++; else if (y > x) sets[1]++;
        }
        const pl = (x) => ({ n: x.athlete.displayName, s: x.athlete.shortName || x.athlete.displayName, l: x.athlete.flag?.href || '' });
        const done = !!st.completed;
        upsert({
          id: 't' + c.id, sport: T, lg: L.slug, start: Date.parse(c.date || e.date), day: '',
          tour: (e.shortName || e.name || '') + (c.round?.displayName ? ' · ' + c.round.displayName : ''),
          home: pl(cs[0]), away: pl(cs[1]),
          state: st.state || 'pre', done, void: /RETIRE|WALKOVER|CANCEL|ABANDON/.test(name), et: false,
          txt: st.shortDetail || '', sh: sets[0], sa: sets[1],
          win: done ? (cs[0].winner ? '1' : cs[1].winner ? '2' : null) : null,
          src: { mod: { w: tennisOdds(String(cs[0].id), String(cs[1].id)) } },
        });
      }
    }
  }
}

const dayKey = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t)).replace(/-/g, '');

async function fetchDay(L, day) {
  const j = await getJSON(`${SITE}${L.es}/${L.slug}/scoreboard?dates=${day}&limit=300`);
  for (const e of j.events || []) { const ev = parseEvent(L, e, day); if (ev && Number.isFinite(ev.start)) upsert(ev); }
}

async function fetchTennis() {
  await pool(LEAGUES.filter((l) => l.sport === T), 2, async (L) => parseTennis(L, await getJSON(`${SITE}tennis/${L.slug}/scoreboard`)));
}

async function loadRankings() {
  await pool(['atp', 'wta'], 2, async (s) => {
    const j = await getJSON(`${SITE}tennis/${s}/rankings`);
    for (const r of j.rankings?.[0]?.ranks || []) if (r.athlete?.id) points.set(String(r.athlete.id), +r.points || 0);
  });
}

// Ligen ausprobieren, die ESPN vielleicht gar nicht führt (z. B. Serie C/D).
async function probeLeagues() {
  await pool(LEAGUES.filter((l) => l.sport !== T && l.es), 8, async (L) => {
    try { await getJSON(`${SITE}${L.es}/${L.slug}/scoreboard?dates=${dayKey(Date.now())}`); }
    catch (e) { if (e.status === 400 || e.status === 404) L.dead = true; }
  });
  const dead = LEAGUES.filter((l) => l.dead).map((l) => l.slug);
  if (dead.length) console.log('Nicht verfügbar bei der Quelle:', dead.join(', '));
}

async function fullSweep() {
  const days = Array.from({ length: 12 }, (_, i) => dayKey(Date.now() + (i - 2) * DAY));
  const jobs = [];
  for (const L of LEAGUES) if (!L.dead && L.es && L.sport !== T) for (const d of days) jobs.push([L, d]);
  await pool(jobs, 8, ([L, d]) => fetchDay(L, d));
  await fetchTennis().catch(() => {});
  await modelSweep().catch(() => {});
  lastSweep = Date.now();
  prune();
  queueSave();
}

// Fussballspiele, für die noch kein Buchmacher Quoten liefert (z. B. tiefere argentinische Ligen
// ein paar Tage vor dem Spiel): Modellquote aus der Tabelle, bis echte Quoten da sind.
const tables = new Map(); // Liga -> { at, teams, avg }
async function modelSweep() {
  const now = Date.now();
  const open = [...store.values()].filter((e) => e.sport === F && !e.fd && e.state === 'pre' && e.start > now && e.home.id && !e.src?.dk?.w && !e.src?.b365?.w);
  const slugs = [...new Set(open.map((e) => e.lg))];
  await pool(slugs, 4, async (slug) => {
    const t = tables.get(slug);
    if (t && now - t.at < 6 * 36e5) return;
    const j = await getJSON(`https://site.api.espn.com/apis/v2/sports/soccer/${slug}/standings`);
    const teams = new Map();
    let goals = 0, games = 0;
    const walk = (n) => {
      for (const en of n?.standings?.entries || []) {
        const st = Object.fromEntries((en.stats || []).map((s) => [s.name, +s.value || 0]));
        if (!en.team?.id || !st.gamesPlayed) continue;
        teams.set(String(en.team.id), { played: st.gamesPlayed, gf: st.pointsFor, ga: st.pointsAgainst, ppg: (st.points || 0) / st.gamesPlayed });
        goals += st.pointsFor; games += st.gamesPlayed;
      }
      for (const c of n?.children || []) walk(c);
    };
    walk(j);
    tables.set(slug, { at: now, teams, avg: games >= 20 ? goals / games : 1.25 });
  });
  for (const ev of open) {
    const t = tables.get(ev.lg);
    // Ohne Tabelle (Cup, Länderspiele) gibt es keine Grundlage für eine Quote.
    if (!t || !t.teams.has(ev.home.id) || !t.teams.has(ev.away.id)) continue;
    const H_ = t.teams.get(ev.home.id), A_ = t.teams.get(ev.away.id);
    const lam = fromTable(H_, A_, t.avg);
    // Tabellenplatz (Punkte pro Spiel) zusätzlich zu den Toren: Leader gegen Schlusslicht klar verschieben.
    const f = ((H_.ppg + 1) / (A_.ppg + 1)) ** 0.35;
    lam.lh *= f; lam.la /= f;
    const w = oneXtwo(lam, 'Modell');
    if (!w) continue;
    ev.src = { ...ev.src, mod: { w: { 1: w[1].o, X: w.X.o, 2: w[2].o } }, lam };
    build(ev);
  }
}

// Ein Spiel nachladen, das nicht mehr im Speicher ist (alte offene Wette nach einem Neustart).
const asked = new Map();
async function recover(id, slug, start) {
  if (store.has(id) || (asked.get(id) || 0) > Date.now() - 10 * 6e4) return;
  asked.set(id, Date.now());
  const L = LEAGUES.find((l) => l.slug === slug && l.es && l.sport !== T);
  if (!L || !Number.isFinite(start)) return;
  for (const d of new Set([dayKey(start), dayKey(start - DAY / 2), dayKey(start + DAY / 2)])) await fetchDay(L, d).catch(() => {});
}

async function fastSweep() {
  const now = Date.now();
  const pairs = new Map();
  for (const ev of store.values()) {
    if (ev.sport === T || ev.done || ev.void || !ev.day) continue;
    if (ev.start < now - 3 * DAY) continue;
    if (ev.state === 'in' || ev.start < now + 1.5 * DAY) pairs.set(ev.lg + '|' + ev.day, ev);
  }
  const jobs = [...pairs.keys()].map((k) => { const [slug, d] = k.split('|'); return [LEAGUES.find((l) => l.slug === slug), d]; }).filter((j) => j[0]);
  await pool(jobs, 8, ([L, d]) => fetchDay(L, d));
  await fetchTennis().catch(() => {});
  lastSweep = Date.now();
}

// bet365-Quoten: ein Abruf pro Fussballspiel, darum gedrosselt und gecacht.
async function b365Sweep() {
  const now = Date.now();
  const due = [...store.values()].filter((ev) => ev.sport === F && !ev.fd && ev.state === 'pre' && !ev.void && ev.start > now && ev.start < now + 5 * DAY
    && now - (ev.b365At || 0) > (ev.start - now < 3 * 36e5 ? 5 : 25) * 6e4);
  due.sort((a, b) => a.start - b.start);
  await pool(due.slice(0, 400), 5, async (ev) => {
    ev.b365At = Date.now();
    const j = await getJSON(`${CORE}soccer/leagues/${ev.lg}/events/${ev.id}/competitions/${ev.id}/odds?limit=20`);
    const b = parseB365(j.items);
    const cur = store.get(ev.id);
    if (b && cur && cur.state === 'pre') { cur.src = { ...cur.src, b365: b }; build(cur); }
  });
}

// Flashscore: Spiele zuordnen und Quoten aller Anbieter holen (bet365, dann Interwetten, dann Rest).
const fsLists = new Map(); // Sportart -> { at, list }
let fsStat = { matched: 0, odds: 0, at: 0 };
async function fsSweep() {
  const now = Date.now();
  for (const [sport, sid] of Object.entries(FS_SPORT)) {
    const c = fsLists.get(sport);
    if (c && now - c.at < 15 * 6e4) continue;
    const list = [];
    for (let d = -1; d <= 7; d++) {
      try { list.push(...(await fsList(sid, d))); } catch { /* Tag fehlt, nächstes Mal */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (list.length) fsLists.set(sport, { at: now, list: list.filter((x) => !/\//.test(x.home + x.away)) });
  }
  const open = [...store.values()].filter((e) => e.state === 'pre' && !e.void && e.start > now && e.start < now + 8 * DAY);
  let matched = 0;
  for (const ev of open) {
    if (!ev.fsId) {
      const c = fsLists.get(ev.sport);
      const hit = c && fsMatch(ev, c.list);
      if (hit) Object.assign(ev, { fsId: hit.id, fsH: hit.hp, fsA: hit.ap });
    }
    if (ev.fsId) matched++;
  }
  const due = open.filter((e) => e.fsId && now - (e.fsAt || 0) > (e.start - now < 3 * 36e5 ? 10 : e.start - now < DAY ? 30 : 120) * 6e4);
  due.sort((a, b) => a.start - b.start);
  await pool(due.slice(0, 600), 3, async (ev) => {
    ev.fsAt = Date.now();
    const o = await fsOdds(ev.fsId, ev.fsH, ev.fsA, ev.sport, { nohalf: ev.nohalf });
    const cur = store.get(ev.id);
    if (o && cur && cur.state === 'pre') { cur.src = { ...cur.src, fs: o }; build(cur); }
    await new Promise((r) => setTimeout(r, 250));
  });
  fsStat = { matched, odds: open.filter((e) => e.src?.fs).length, at: Date.now() };
  console.log(`Flashscore: ${matched} von ${open.length} Spielen zugeordnet, ${fsStat.odds} mit Quoten`);
  queueSave();
}

async function getText(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0 (wettbude)' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

// Schweizer Liga über football-data.co.uk: Spielplan mit Quoten, Resultate ein paar Tage später.
async function fdSweep() {
  const now = Date.now();
  const csv = await getText(FD + 'new_league_fixtures.csv');
  for (const L of FD_LEAGUES) {
    for (const ev of parseFixtures(csv, L)) {
      if (ev.start > now && Object.keys(ev.src).length) upsert(ev);
    }
    const pending = [...store.values()].filter((e) => e.fd && e.lg === L.slug && !e.done && !e.void && e.start < now);
    if (!pending.length) continue;
    const res = parseResults(await getText(`${FD}new/${L.file}.csv`), L);
    for (const e of pending) {
      const r = res.get(e.id);
      if (r) Object.assign(e, r, { done: true, state: 'post', txt: 'Beendet' });
      else if (e.start < now - 10 * DAY) e.void = true;
      else Object.assign(e, now - e.start < 2.2 * 36e5 ? { state: 'in', txt: 'läuft' } : { state: 'post', txt: 'Resultat folgt' });
    }
    queueSave();
  }
}

function prune() {
  const lim = Date.now() - 30 * DAY;
  for (const [id, ev] of store) if (ev.start < lim) store.delete(id);
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA, { recursive: true });
      fs.writeFileSync(STORE + '.tmp', JSON.stringify([...store.values()]));
      fs.renameSync(STORE + '.tmp', STORE);
    } catch (e) { console.log('Speichern fehlgeschlagen:', e.message); }
  }, 3000);
}

function loadStore() {
  try { for (const ev of JSON.parse(fs.readFileSync(STORE, 'utf8'))) if (ev?.id) store.set(ev.id, ev); } catch { /* erster Start */ }
}

function payload(need) {
  const now = Date.now();
  const events = [];
  const known = new Set(LEAGUES.map((l) => l.slug));
  for (const ev of store.values()) {
    if (!need.has(ev.id) && (!known.has(ev.lg) || ev.start < now - 2 * DAY || ev.start > now + 10 * DAY || ev.done || ev.void || ev.state !== 'pre')) continue;
    const { src, b365At, day, fsId, fsH, fsA, fsAt, ...pub } = ev;
    // Modellquoten nur, wenn 24 Stunden vor dem Spiel immer noch kein Buchmacher Quoten hat.
    if (ev.book === 'Modell' && ev.start - now > DAY) { pub.m = {}; pub.cmp = {}; pub.wait = true; }
    events.push(pub);
  }
  return { t: now, upd: lastSweep, leagues: LEAGUES.filter((l) => !l.dead).map(({ slug, sport, name, land }) => ({ slug, sport, name, land })), events };
}

let plain = { at: 0, body: '' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

// Profile: /api/acc/free, register, login, logout, profile (GET laden, PUT speichern)
const acc = accounts({ dataDir: DATA });
console.log(acc.remote ? 'Profile werden in Upstash gespeichert' : 'Profile werden in data/users.json gespeichert');
function readBody(req, max = 2_000_000) {
  return new Promise((ok, bad) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { s += c; if (s.length > max) { bad(Object.assign(new Error('Zu gross'), { status: 413 })); req.destroy(); } });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { bad(Object.assign(new Error('Ungültige Anfrage'), { status: 400 })); } });
    req.on('error', bad);
  });
}
async function accApi(req, res, u) {
  const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  try {
    const p = u.pathname.slice('/api/acc/'.length);
    const token = req.headers['x-token'];
    let out;
    if (p === 'free' && req.method === 'GET') out = await acc.free(u.searchParams.get('n'));
    else if (p === 'register' && req.method === 'POST') out = await acc.register(await readBody(req));
    else if (p === 'login' && req.method === 'POST') out = await acc.login(await readBody(req, 10000));
    else if (p === 'logout' && req.method === 'POST') out = await acc.logout(token);
    else if (p === 'players' && req.method === 'GET') out = await acc.players(token);
    else if (p === 'player' && req.method === 'GET') out = await acc.player(token, u.searchParams.get('n'));
    else if (p === 'profile' && req.method === 'GET') out = await acc.load(token, u.searchParams.get('rev'));
    else if (p === 'profile' && req.method === 'PUT') out = await acc.save(token, await readBody(req));
    else return send(404, { error: 'Nicht gefunden' });
    send(200, out);
  } catch (e) {
    if (!e.status) console.log('Profil-Fehler:', e.message);
    send(e.status || 500, { error: e.status ? e.message : 'Speicher nicht erreichbar, später nochmals versuchen.' });
  }
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/acc/')) return void accApi(req, res, u);
  if (u.pathname === '/api/events') {
    // need = "id~liga~startzeit,…": offene Wetten des Besuchers, damit auch ältere Spiele mitkommen.
    const hints = (u.searchParams.get('need') || '').split(',').filter(Boolean).slice(0, 300).map((x) => x.split('~'));
    const need = new Set(hints.map((h) => h[0]));
    const send = (body) => {
      const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(gz ? { 'content-encoding': 'gzip' } : {}) });
      res.end(gz ? zlib.gzipSync(body, { level: 5 }) : body);
    };
    const missing = hints.filter((h) => !store.has(h[0]) && h[1]);
    Promise.all(missing.slice(0, 20).map((h) => recover(h[0], h[1], +h[2]))).catch(() => {}).then(() => {
      // Die Antwort ohne eigene Wetten ist für alle gleich: 10 Sekunden zwischenspeichern.
      if (!need.size && plain.body && Date.now() - plain.at < 10000) return send(plain.body);
      const body = JSON.stringify(payload(need));
      if (!need.size) plain = { at: Date.now(), body };
      send(body);
    });
    return;
  }
  const rel = path.normalize(decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
  const file = path.join(PUB, rel);
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Nicht gefunden'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`Wettbude läuft auf http://localhost:${PORT}`));

let busy = false;
async function guarded(fn) {
  if (busy) return;
  busy = true;
  try { await fn(); } catch (e) { console.log('Abruf fehlgeschlagen:', e.message); } finally { busy = false; }
}

loadStore();
for (const ev of store.values()) build(ev);
tsStart({ upsert, dataDir: DATA, log: (m) => console.log(m) });
(async () => {
  await loadRankings().catch(() => {});
  await probeLeagues();
  await guarded(fullSweep);
  await fdSweep().catch((e) => console.log('football-data fehlgeschlagen:', e.message));
  setInterval(() => fdSweep().catch(() => {}), 30 * 60e3);
  console.log(`Erster Abruf fertig: ${store.size} Spiele`);
  await b365Sweep().catch(() => {});
  console.log('bet365-Quoten geladen');
  setInterval(() => guarded(fastSweep), 60e3);
  setInterval(() => guarded(fullSweep), 30 * 60e3);
  setInterval(() => b365Sweep().catch(() => {}), 5 * 60e3);
  setInterval(() => loadRankings().catch(() => {}), 12 * 36e5);
})();
// Flashscore läuft unabhängig: Liste alle 15 Minuten, Quoten je nach Abstand zum Anpfiff.
(async () => {
  await new Promise((r) => setTimeout(r, 20000)); // erst ESPN und TheSportsDB füllen lassen
  for (;;) {
    await fsSweep().catch((e) => console.log('Flashscore fehlgeschlagen:', e.message));
    await new Promise((r) => setTimeout(r, 3 * 60e3));
  }
})();
