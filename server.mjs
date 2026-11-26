// Wettbude: Sportwetten mit Spielgeld. Holt Spielpläne, Resultate und Quoten von ESPN
// (DraftKings im Scoreboard, bet365 im Core-API) und liefert sie an die Oberfläche in public/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FD, FD_LEAGUES, parseFixtures, parseResults } from './fd.mjs';
import zlib from 'node:zlib';
import { fit, derive, fromTable, oneXtwo, hockey, hockeyFit, ratings, fromRatings } from './model.mjs';
import { TS_LEAGUES, tsStart } from './tsdb.mjs';
import { FS_SPORT, fsList, fsMatch, fsOdds, fsLeague, fsRaces, fsPlayerStats } from './flashscore.mjs';
import { accounts } from './accounts.mjs';
import { evalLeg, evalLegEarly, earlyText, settleBet, scoreText, psKey } from './public/settle.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(DIR, 'public');
const DATA = path.join(DIR, 'data');
const STORE = path.join(DATA, 'store.json');
const PORT = +process.env.PORT || 5211;
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
const CORE = 'https://sports.core.api.espn.com/v2/sports/';
const DAY = 864e5;

const F = 'fussball', B = 'basketball', H = 'eishockey', T = 'tennis', AF = 'amfootball', R = 'rugby', D = 'darts';
const LEAGUES = [
  [F, 'soccer', 'sui.1', 'Super League', 'Schweiz'],
  [F, 'soccer', 'sui.2', 'Challenge League', 'Schweiz'],
  [F, 'soccer', 'sui.cup', 'Schweizer Cup', 'Schweiz'],
  // Tiefere Schweizer Ligen nur über Flashscore und nur Spiele mit echten Buchmacherquoten
  [F, null, 'sui.3', 'Promotion League', 'Schweiz', true],
  [F, null, 'sui.4.1', '1. Liga Classic Gruppe 1', 'Schweiz', true],
  [F, null, 'sui.4.2', '1. Liga Classic Gruppe 2', 'Schweiz', true],
  [F, null, 'sui.4.3', '1. Liga Classic Gruppe 3', 'Schweiz', true],
  [F, null, 'sui.u19', 'U19 Elite', 'Schweiz'], // aus u19.json, immer Modellquoten
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
  [F, null, 'fra.coupe_de_france', 'Coupe de France', 'Frankreich', true], // viele Amateurklubs: nur mit echten Quoten
  [F, 'soccer', 'ned.1', 'Eredivisie', 'Niederlande'],
  [F, 'soccer', 'ned.2', 'Eerste Divisie', 'Niederlande'],
  [F, 'soccer', 'por.1', 'Primeira Liga', 'Portugal'],
  [F, 'soccer', 'bel.1', 'Pro League', 'Belgien'],
  [F, 'soccer', 'aut.1', 'Bundesliga', 'Österreich'],
  [F, 'soccer', 'tur.1', 'Süper Lig', 'Türkei'],
  [F, 'soccer', 'rou.1', 'Superliga', 'Rumänien'],
  [F, null, 'rou.2', 'Liga 2', 'Rumänien'], // nur Flashscore, ESPN kennt sie nicht
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
  // Nur über Flashscore (ESPN-Kürzel leer)
  [B, null, 'euroleague', 'EuroLeague', 'International'],
  [B, null, 'eurocup', 'EuroCup', 'International'],
  [D, null, 'darts', 'PDC und weitere Turniere', 'Welt'],
  ['ski', null, 'ski.m', 'Herren', 'Ski alpin'],
  ['ski', null, 'ski.w', 'Damen', 'Ski alpin'],
  [AF, null, 'nfl', 'NFL', 'USA'],
  [AF, null, 'college-football', 'College Football', 'USA'],
  [R, null, 'rug.top14', 'Top 14', 'Frankreich'],
  [R, null, 'rug.prod2', 'Pro D2', 'Frankreich'],
  [R, null, 'rug.prem', 'Premiership', 'England'],
  [R, null, 'rug.urc', 'United Rugby Championship', 'International'],
  [R, null, 'rug.cc', 'Champions Cup', 'International'],
  [R, null, 'rug.super', 'Super Rugby', 'International'],
  [R, null, 'rug.six', 'Six Nations', 'Länderspiele'],
  [R, null, 'rug.rc', 'The Rugby Championship', 'Länderspiele'],
  [R, null, 'rug.nc', 'Nations Championship', 'Länderspiele'],
  [R, null, 'rug.wc', 'Weltmeisterschaft', 'Länderspiele'],
  [R, null, 'rug.friendly', 'Testspiele', 'Länderspiele'],
].map(([sport, es, slug, name, land, onlyReal]) => ({ sport, es, slug, name, land, dead: false, onlyReal: !!onlyReal }));
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
  buildBase(ev);
  // NBA-Spielerwetten von Unibet dazu (bet365 bietet sie über Flashscore nicht an); Statistik für die Abrechnung
  const s = ev.src || {};
  if (s.props && ev.m && !ev.race) Object.assign(ev.m, s.props);
  if (s.ps) ev.ps = s.ps;
}
function buildBase(ev) {
  const s = ev.src || {};
  // Ski-Rennen: nur Modellquoten (kein Buchmacher bietet sie über Flashscore an)
  if (ev.race) { ev.m = s.ski || {}; ev.book = s.skiBook || 'Modell'; ev.cmp = {}; return; }
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
      const der = derive(lam, 'berechnet', { half: !ev.nohalf, skipOu: ou?.line, hf: s.hf });
      for (const k in der) if (!m[k]) m[k] = der[k];
    } catch { /* ohne Zusatzmärkte weiter */ }
  }
  if (s.b365?.gsa) m.gsa = tag(s.b365.gsa, 'bet365');
  if (s.b365?.gsf) m.gsf = tag(s.b365.gsf, 'bet365');
  if (s.u19gs) m.gsa = s.u19gs;
  if (s.u19gf) m.gsf = s.u19gf;
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
    for (const k of ['fsId', 'fsH', 'fsA', 'fsAt', 'mv']) if (o[k] != null && n[k] == null) n[k] = o[k];
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
  let err = null;
  for (const L of LEAGUES.filter((l) => l.sport === T)) {
    try { parseTennis(L, await getJSON(`${SITE}tennis/${L.slug}/scoreboard`)); } catch (e) { err = e; }
  }
  if (err) { console.log('ESPN Tennis fehlgeschlagen:', err.message); throw err; }
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
  let jobs = [];
  for (const L of LEAGUES) if (!L.dead && L.es && L.sport !== T) for (const d of days) jobs.push([L, d]);
  // Wichtige Ligen zuerst (NBA, NHL, Top-Fussball), damit sie nicht hinten im Stau landen.
  const TOP = new Set(['nba', 'nhl', 'ita.1', 'eng.1', 'esp.1', 'ger.1', 'fra.1', 'ita.2', 'uefa.champions']);
  jobs.sort((a, b) => (TOP.has(b[0].slug) ? 1 : 0) - (TOP.has(a[0].slug) ? 1 : 0));
  // Fehlgeschlagene Abrufe (z. B. ESPN bremst nach vielen Anfragen) bis zu dreimal nach einer Pause wiederholen.
  for (let round = 0; round < 4 && jobs.length; round++) {
    if (round) await new Promise((r) => setTimeout(r, 15000 * round));
    const failed = [];
    await pool(jobs, round ? 3 : 5, async (j) => { try { await fetchDay(...j); } catch (e) { failed.push(j); j.err = e.message; } });
    if (failed.length) console.log(`ESPN: ${failed.length} von ${jobs.length} Abrufen fehlgeschlagen (${failed[0].err}), ${round < 3 ? 'neuer Versuch' : 'nächster Durchgang in 30 min'}`);
    // Alles gesperrt (z. B. HTTP 403 auf dem Server): nicht weiter anklopfen, Flashscore liefert die Spiele.
    if (failed.length === jobs.length && /403/.test(failed[0]?.err || '')) { console.log('ESPN gesperrt, Spiele kommen von Flashscore'); break; }
    jobs = failed;
  }
  for (let i = 0; i < 3; i++) { try { await fetchTennis(); break; } catch { await new Promise((r) => setTimeout(r, 10000)); } }
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

// U19 Elite (Schweiz): keine Quelle mit maschinellem Zugriff, darum pflegt Claude u19.json von Hand
// (Spielplan + Resultate). Immer Modellquoten: Angriff/Abwehr aus allen Saisonspielen, neuere zählen mehr (Form).
// U21-Regel: spielt die U21 des Klubs am selben Tag, fehlen der U19 die Spieler, die hochgezogen werden
// (eher schwächer); spielt die U21 an einem anderen Tag, sind die U19-Stammspieler dabei (eher stärker).
const U19 = path.join(DIR, 'u19.json');
const U21 = { 'Young Boys': 'young boys', Basel: 'basel', Luzern: 'luzern', 'Zürich': 'zurich', Ticino: 'lugano', 'St. Gallen': 'st gallen', Thun: 'thun', Servette: 'servette', Sion: 'sion', GC: 'grasshoppers?', Lausanne: 'lausanne', Winterthur: 'winterthur', Xamax: 'xamax', Aarau: 'aarau' };
const plainName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.\-]/g, ' ').replace(/\b(fc|bsc|fcz|ss)\b/g, '').replace(/\s+/g, ' ').trim();
const zDay = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
// U21 eines Klubs (Promotion League, 1. Liga Classic, Testspiele bei Flashscore):
// true = spielt am selben Tag, false = spielt an einem anderen Tag in den 3 Tagen davor/danach,
// 0 = hat in diesen Tagen kein Spiel (z. B. Winterpause), null = unbekannt (U21 nirgends gefunden / zu weit weg)
const u21Re = (club) => U21[club] && new RegExp(`^(neuchatel )?${U21[club]}( sport)? (ii|u21|u 21)$`);
// 1. Liga Classic: Flashscore kennt sie nicht, darum ganzer Spielplan in u21.json (vom Nutzer eingefügt).
// Für diese Klubs ist der Plan vollständig: Spiel am selben Tag = true, anderer Tag = false, sonst 0.
const U21L = { Winterthur: 'FC Winterthur U-21', 'St. Gallen': 'FC St. Gallen 1879 U-21', Thun: 'FC Thun Berner Oberland U-21', GC: 'Grasshopper Club Zürich U-21', Servette: 'Servette FC M-21', Sion: 'FC Sion M-21', Lausanne: 'FC Lausanne-Sport M-21' };
let u21Liga = { games: [] }, u21Mt = 0;
function u21Load() {
  try { const f = path.join(DIR, 'u21.json'), mt = fs.statSync(f).mtimeMs; if (mt !== u21Mt) { u21Liga = JSON.parse(fs.readFileSync(f, 'utf8')); u21Mt = mt; } } catch {}
  return u21Liga.games || [];
}
// Spiele der U21 (mit Gegner) und Tabelle der Gruppe bis heute
function u21Liga1(club) {
  const team = U21L[club];
  if (!team) return null;
  const all = u21Load(), mine = all.filter((g) => g.h === team || g.a === team);
  if (!mine.length) return null;
  const grp = mine[0].grp, T = new Map();
  for (const g of all) {
    if (g.grp !== grp || !Number.isFinite(g.hs)) continue;
    for (const [n, f, a] of [[g.h, g.hs, g.as], [g.a, g.as, g.hs]]) {
      const x = T.get(n) || { n, p: 0, sp: 0, gf: 0, ga: 0 };
      x.sp++; x.gf += f; x.ga += a; x.p += f > a ? 3 : f === a ? 1 : 0; T.set(n, x);
    }
  }
  const tab = [...T.values()].sort((a, b) => b.p - a.p || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
  const rk = tab.findIndex((x) => x.n === team) + 1, me = tab[rk - 1];
  const form = mine.filter((g) => Number.isFinite(g.hs)).slice(-5).map((g) => { const f = g.h === team ? g.hs : g.as, a = g.h === team ? g.as : g.hs; return f > a ? 'S' : f < a ? 'N' : 'U'; }).join('');
  return { team, grp, mine, rk, me, n: tab.length, form };
}
function u21Same(club, start) {
  const L = u21Liga1(club);
  if (L) {
    const day = zDay(start);
    if (start > Date.parse(L.mine[L.mine.length - 1].d) + 7 * DAY) return null; // nach Saisonende unbekannt
    if (L.mine.some((g) => g.d === day)) return true;
    return L.mine.some((g) => Math.abs(Date.parse(g.d + 'T12:00:00Z') - start) <= 3.5 * DAY) ? false : 0;
  }
  const re = u21Re(club);
  if (!re) return null;
  let other = false, known = false;
  for (const e of store.values()) {
    if (e.sport !== F || e.lg === 'sui.u19' || e.void) continue;
    if (![e.home?.n, e.away?.n].some((n) => re.test(plainName(n)))) continue;
    known = true;
    if (Math.abs(e.start - start) > 3.5 * DAY) continue;
    if (zDay(e.start) === zDay(start)) return true;
    other = true;
  }
  if (other) return false;
  // Flashscore-Spielpläne reichen 7 Tage voraus: danach kein Spiel = U21 spielt nicht
  return known && start < Date.now() + 6.5 * DAY ? 0 : null;
}
// Logo der ersten Mannschaft (sonst der U21) für das U19-Team; einmal gefunden, gemerkt
const u19Logo = new Map();
// Rückfall, falls die ersten Mannschaften gerade nicht im Spielplan stehen (Neustart, Winterpause)
let u19LogoFix = {};
try { u19LogoFix = JSON.parse(fs.readFileSync(path.join(DIR, 'u19logos.json'), 'utf8')); } catch {}
function logoOf(club) {
  if (u19Logo.get(club)) return u19Logo.get(club);
  if (!U21[club]) return u19LogoFix[club] || '';
  const first = new RegExp(`^(neuchatel )?${U21[club]}( sport)?$`), second = u21Re(club);
  let alt = '';
  for (const e of store.values()) {
    if (e.sport !== F || !/^sui\./.test(e.lg) || e.lg === 'sui.u19') continue;
    for (const t of [e.home, e.away]) {
      if (!t?.l) continue;
      const n = plainName(t.n);
      if (first.test(n)) { u19Logo.set(club, t.l); return t.l; }
      if (!alt && second.test(n)) alt = t.l;
    }
  }
  if (alt) u19Logo.set(club, alt);
  return alt || u19LogoFix[club] || '';
}
// Tabelle und Form: Punkte pro Spiel gesamt, zu Hause bzw. auswärts, letzte 5 Spiele
function u19Table(games) {
  const T = new Map();
  for (const g of games) {
    for (const [t, gf, ga, home] of [[g.h, g.hs, g.as, true], [g.a, g.as, g.hs, false]]) {
      if (!T.has(t)) T.set(t, { p: 0, n: 0, hp: 0, hn: 0, ap: 0, an: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, last: [], res: [] });
      const x = T.get(t), pts = gf > ga ? 3 : gf === ga ? 1 : 0;
      x.p += pts; x.n++; x.last.push(pts); x.gf += gf; x.ga += ga; x[pts === 3 ? 'w' : pts ? 'd' : 'l']++;
      x.res.push({ t: g.ts, vs: home ? g.a : g.h, home, gf, ga });
      if (home) { x.hp += pts; x.hn++; } else { x.ap += pts; x.an++; }
    }
  }
  return T;
}
// Stärke aus der Tabelle: 45 % Saison, 20 % Heim-/Auswärtsbilanz, 35 % letzte 5 Spiele (Form)
function u19Str(T, team, home) {
  const x = T.get(team);
  if (!x || !x.n) return 1.4;
  const venue = home ? (x.hn ? x.hp / x.hn : x.p / x.n) : (x.an ? x.ap / x.an : x.p / x.n);
  const l5 = x.last.slice(-5), form = l5.reduce((s, v) => s + v, 0) / l5.length;
  return 0.45 * x.p / x.n + 0.2 * venue + 0.35 * form;
}
// Torschütze (jederzeit) aus der Torschützenliste: Tore pro Einsatz (gedämpft), skaliert auf die erwarteten
// Tore des Teams in diesem Spiel, mal Wahrscheinlichkeit, dass er spielt. U21-Regel pro Spieler: wer nur gut
// die Hälfte der Spiele macht, aber oft trifft (z. B. Gambardella bei YB), spielt meist dann, wenn die U21 frei hat.
// Aus den Spielberichten zusätzlich: Form (Tore in den letzten 5 Teamspielen) und Joker (oft eingewechselt =
// weniger Minuten). Erster Torschütze: Anteil des Spielers an den erwarteten Toren beider Teams mal P(ein Tor fällt).
function u19Scorers(players, T, g, lam, hS, aS, recent) {
  const out = {}, first = {}, all = [];
  for (const [team, mu, u21] of [[g.h, lam.lh, hS], [g.a, lam.la, aS]]) {
    const x = T.get(team), list = players[team];
    if (!x?.n || !list?.length) continue;
    const gfPg = Math.max(0.8, list.reduce((s, p) => s + p[2], 0) / x.n);
    const rec = recent?.get(team) || new Map();
    const rows = [];
    for (const [name, apps, goals, ex = {}] of list) {
      if (!(goals >= 1)) continue;
      let rate = (goals + 0.25) / (apps + 1.5);
      const share = apps / x.n;
      // Form: Tore in den letzten 5 Spielen gegenüber dem eigenen Schnitt (gedämpft)
      const r5 = [...rec].find(([k]) => nameKey(k) === nameKey(name))?.[1] || 0;
      const exp5 = 5 * rate * Math.min(1, share);
      rate *= Math.min(1.35, Math.max(0.75, Math.sqrt((r5 + 0.5) / (exp5 + 0.5))));
      // Joker: wer meist eingewechselt wird, spielt etwa ein Drittel des Spiels
      const jok = apps ? Math.min(1, (ex.in || 0) / apps) : 0;
      const mins = 1 - 0.6 * jok;
      let play = Math.min(0.92, Math.max(0.15, share + 0.05));
      const part = share < 0.65 && apps >= 3 && rate >= 0.35; // Teilzeit-Torjäger, pendelt mit der U21
      if (part && u21 === true) play *= 0.35;
      else if (part && (u21 === false || u21 === 0)) play = Math.max(play, 0.75);
      const m = rate * mu / gfPg * mins;
      const p = play * (1 - Math.exp(-m));
      if (p >= 0.04) rows.push([name, p, play * m]);
    }
    rows.sort((a, b) => b[1] - a[1]);
    for (const [name, p, m] of rows.slice(0, 10)) { out[name] = { o: Math.min(41, Math.max(1.3, Math.round(100 / (p * 1.15)) / 100)), b: 'Modell' }; all.push([name, m]); }
  }
  const tot = lam.lh + lam.la, any = 1 - Math.exp(-tot);
  for (const [name, m] of all) { const p = (m / tot) * any; if (p >= 0.02) first[name] = { o: Math.min(51, Math.max(2, Math.round(100 / (p * 1.2)) / 100)), b: 'Modell' }; }
  return Object.keys(out).length ? { gsa: out, gsf: Object.keys(first).length ? first : null } : null;
}
// Infos für die Spieler: Tabelle, Form, Heim/Auswärts, Direktduelle, Torschützen, U21-Lage
let u19Over = null, u19Teams = {};
function u19Rank(T) {
  return [...T.entries()].map(([team, x]) => ({ team, n: x.n, w: x.w, d: x.d, l: x.l, gf: x.gf, ga: x.ga, p: x.p }))
    .sort((a, b) => b.p - a.p || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf).map((r, i) => ({ ...r, rk: i + 1 }));
}
function u19TeamInfo(T, rank, players, team, home) {
  const x = T.get(team);
  if (!x) return null;
  const r = rank.find((y) => y.team === team);
  const v = x.res.filter((y) => y.home === home);
  return {
    sp: u19Teams[team]?.sp, rk: r?.rk, p: x.p, n: x.n, w: x.w, d: x.d, l: x.l, gf: x.gf, ga: x.ga,
    venue: { n: v.length, p: v.reduce((s, y) => s + (y.gf > y.ga ? 3 : y.gf === y.ga ? 1 : 0), 0), gf: v.reduce((s, y) => s + y.gf, 0), ga: v.reduce((s, y) => s + y.ga, 0) },
    last: x.res.slice(-5).reverse().map((y) => ({ vs: y.vs, home: y.home, gf: y.gf, ga: y.ga, t: y.t })),
    top: (players[team] || []).slice().sort((a, b) => b[2] - a[2] || a[1] - b[1]).slice(0, 4).map(([n, apps, goals]) => ({ n, apps, goals })),
  };
}
// Aus den offiziellen Spielberichten (g.r): wann ein Team trifft und kassiert, Pausenstand, erstes Tor,
// Karten, Joker-Tore. Pro Spieler: Tore in den letzten 5 Teamspielen.
function u19Stats(played) {
  const S = new Map(), recent = new Map();
  const get = (t) => { if (!S.has(t)) S.set(t, { n: 0, gf1: 0, ga1: 0, gf2: 0, ga2: 0, lateF: 0, lateA: 0, first: 0, firstW: 0, firstN: 0, conc1st: 0, conc1stPts: 0, htL: 0, htLP: 0, htT: 0, htTP: 0, htD: 0, htDP: 0, y: 0, red: 0, joker: 0, cs: 0, blank: 0, og: 0, cards: {}, games: [] }); return S.get(t); };
  for (const g of played) {
    if (!g.r) continue;
    for (const side of ['h', 'a']) {
      const team = side === 'h' ? g.h : g.a, opp = side === 'h' ? 'a' : 'h', x = get(team);
      const gf = side === 'h' ? g.hs : g.as, ga = side === 'h' ? g.as : g.hs, pts = gf > ga ? 3 : gf === ga ? 1 : 0;
      x.n++; x.games.push(g);
      for (const [min, s, , og] of g.r.g) {
        const mine = s === side;
        if (min <= 45) x[mine ? 'gf1' : 'ga1']++; else x[mine ? 'gf2' : 'ga2']++;
        if (min >= 76) x[mine ? 'lateF' : 'lateA']++;
        if (og && !mine) x.og++;
      }
      const f = g.r.g[0];
      if (f) { x.firstN++; if (f[1] === side) { x.first++; if (pts === 3) x.firstW++; } else { x.conc1st++; x.conc1stPts += pts; } }
      if (g.ht) {
        const [hh, ha] = side === 'h' ? g.ht : [g.ht[1], g.ht[0]];
        if (hh > ha) { x.htL++; x.htLP += pts; } else if (hh < ha) { x.htT++; x.htTP += pts; } else { x.htD++; x.htDP += pts; }
      }
      for (const [, s, n, t] of g.r.c) if (s === side) { if (t === 'Y') x.y++; else x.red++; x.cards[n] = (x.cards[n] || 0) + 1; }
      // Joker-Tor: Torschütze wurde in diesem Spiel vorher eingewechselt
      for (const [min, s, n, og] of g.r.g) if (s === side && !og && g.r.s.some(([sm, ss, , inn]) => ss === side && inn === n && sm <= min)) x.joker++;
      if (!ga) x.cs++;
      if (!gf) x.blank++;
    }
  }
  for (const [team, x] of S) {
    const last = x.games.slice(-5), m = new Map();
    for (const g of last) for (const [, s, n, og] of g.r.g) if (!og && (s === 'h' ? g.h : g.a) === team) m.set(n, (m.get(n) || 0) + 1);
    recent.set(team, m);
    delete x.games;
  }
  return { S, recent };
}
const pct = (p) => Math.round(p * 100) + ' %';
const nameKey = (s) => plainName(s).split(' ').sort().join(' ');
// Langer Bericht zum Spiel, «was der Roboter sagt»: beschreibt beide Teams aus Tabelle, Form und
// Spielberichten und das Modell, gibt aber bewusst keinen Tipp ab.
function u19Report(g, T, rank, st, players, lam, w, hS, aS, h2h) {
  const P = [];
  const team = (name, home, u21) => {
    const x = T.get(name), r = rank.find((y) => y.team === name), s = st.S.get(name);
    if (!x || !s) return;
    const ppg = x.p / x.n, l5 = x.res.slice(-5), l5p = l5.reduce((a, y) => a + (y.gf > y.ga ? 3 : y.gf === y.ga ? 1 : 0), 0);
    const v = x.res.filter((y) => y.home === home), vp = v.reduce((a, y) => a + (y.gf > y.ga ? 3 : y.gf === y.ga ? 1 : 0), 0);
    const t = [];
    const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    t.push(`${name} steht auf Platz ${r.rk} mit ${x.p} Punkten aus ${x.n} Spielen (${pl(x.w, 'Sieg', 'Siege')}, ${x.d} Unentschieden, ${pl(x.l, 'Niederlage', 'Niederlagen')}, Tore ${x.gf}:${x.ga}). Das sind ${ppg.toFixed(2)} Punkte pro Spiel.`);
    const fTxt = l5p >= 12 ? 'ist in starker Form' : l5p >= 8 ? 'ist ordentlich in Form' : l5p >= 5 ? 'schwankt zurzeit' : 'steckt in einem Tief';
    t.push(`Aus den letzten fünf Spielen holte ${name} ${l5p} Punkte (${l5.map((y) => `${y.home ? '' : '@'}${y.vs} ${y.gf}:${y.ga}`).join(', ')}) und ${fTxt}.`);
    if (v.length) t.push(`${home ? 'Zu Hause' : 'Auswärts'}: ${(vp / v.length).toFixed(2)} Punkte pro Spiel, Tore ${v.reduce((a, y) => a + y.gf, 0)}:${v.reduce((a, y) => a + y.ga, 0)} in ${v.length} Spielen.`);
    const gf = s.gf1 + s.gf2, ga = s.ga1 + s.ga2;
    if (gf) t.push(`Von den ${gf} Toren fielen ${s.gf1} vor und ${s.gf2} nach der Pause${s.gf2 > s.gf1 * 1.4 ? ', das Team legt in der zweiten Halbzeit zu' : s.gf1 > s.gf2 * 1.3 ? ', das Team ist vor allem früh gefährlich' : ''}. In den letzten 15 Minuten traf es ${s.lateF}-mal und kassierte ${s.lateA} Gegentore.`);
    if (ga) t.push(`Gegentore: ${s.ga1} in der ersten, ${s.ga2} in der zweiten Halbzeit. ${s.cs ? `${s.cs}-mal blieb es ohne Gegentor` : 'Ohne Gegentor blieb es noch nie'}${s.blank ? `, ${s.blank}-mal traf es selbst nicht` : ', getroffen hat es in jedem Spiel'}.`);
    if (s.firstN) t.push(`Das erste Tor schoss ${name} in ${s.first} von ${s.firstN} Spielen und gewann davon ${s.firstW}. Lag es zuerst zurück (${s.conc1st}-mal), holte es danach im Schnitt ${s.conc1st ? (s.conc1stPts / s.conc1st).toFixed(1) : '–'} Punkte.`);
    if (s.htL + s.htT + s.htD) t.push(`Zur Pause führte es ${s.htL}-mal (danach ${s.htL ? (s.htLP / s.htL).toFixed(1) : '–'} Punkte pro Spiel), lag ${s.htT}-mal zurück (${s.htT ? (s.htTP / s.htT).toFixed(1) : '–'}) und stand ${s.htD}-mal unentschieden (${s.htD ? (s.htDP / s.htD).toFixed(1) : '–'}).`);
    const list = (players[name] || []).filter((p) => p[2] > 0);
    const rec = st.recent.get(name) || new Map();
    if (list.length) {
      const top = list.slice(0, 4).map(([n, apps, goals]) => { const r5 = [...rec].find(([k]) => nameKey(k) === nameKey(n))?.[1] || 0; return `${n} (${pl(goals, 'Tor', 'Tore')} in ${apps} Einsätzen${r5 ? `, ${r5} in den letzten 5 Spielen` : ''})`; });
      const share = list[0][2] / Math.max(1, gf);
      t.push(`Torschützen: ${top.join(', ')}. ${share >= 0.25 ? `Ein grosser Teil hängt an ${list[0][0]} (${pct(share)} der Tore).` : `Die Tore verteilen sich auf ${list.length} Spieler.`}${s.joker ? ` ${s.joker === 1 ? 'Ein Tor kam' : `${s.joker} Tore kamen`} von Eingewechselten.` : ''}`);
    }
    const hot = [...rec].filter(([n]) => !list.slice(0, 4).some((p) => nameKey(p[0]) === nameKey(n))).sort((a, b) => b[1] - a[1])[0];
    if (hot && hot[1] >= 2) t.push(`Zuletzt auffällig: ${hot[0]} mit ${hot[1]} Toren in den letzten fünf Spielen.`);
    const bad = Object.entries(s.cards).sort((a, b) => b[1] - a[1])[0];
    t.push(`Karten: ${(s.y / s.n).toFixed(1)} Gelbe pro Spiel${s.red ? `, ${s.red}-mal Rot oder Gelb-Rot` : ', noch kein Platzverweis'}${bad && bad[1] >= 3 ? `; am häufigsten verwarnt wurde ${bad[0]} (${bad[1]})` : ''}.`);
    const L = u21Liga1(name);
    if (L && L.me) {
      const day = zDay(g.ts), same = L.mine.find((y) => y.d === day);
      const opp = same && (same.h === L.team ? `zu Hause gegen ${same.a}` : `auswärts bei ${same.h}`);
      t.push(`Die U21 spielt in der 1. Liga (Gruppe ${L.grp}) und ist dort ${L.rk}. von ${L.n} mit ${L.me.p} Punkten aus ${L.me.sp} Spielen${L.form ? `, zuletzt ${L.form.split('').join('-')}` : ''}.${opp ? ` Am gleichen Tag spielt sie ${same.t ? `um ${same.t} ` : ''}${opp}.` : ''}`);
    }
    t.push(u21 === true ? `Die U21 von ${name} spielt am selben Tag. Dann fehlen der U19 oft Spieler, die oben aushelfen.` : u21 === false ? `Die U21 spielt an einem anderen Tag, die U19 dürfte also ihre besten Spieler zur Verfügung haben.` : u21 === 0 ? `Die U21 hat in diesen Tagen kein Spiel, die U19 kann voll besetzt antreten.` : `Ob die U21 am selben Tag spielt, ist noch nicht bekannt.`);
    P.push({ h: name, t: t.join(' ') });
  };
  team(g.h, true, hS);
  team(g.a, false, aS);
  // Modell: Wahrscheinlichkeiten aus den Quoten ohne Marge, Tore aus dem Gitter
  if (w && lam) {
    const q = { 1: 1 / w[1], X: 1 / w.X, 2: 1 / w[2] }, s = q[1] + q.X + q[2];
    const po = (k, l) => Math.exp(-l) * l ** k / [1, 1, 2, 6, 24, 120, 720, 5040, 40320][k];
    let o25 = 0, bt = 0;
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) { const p = po(i, lam.lh) * po(j, lam.la); if (i + j > 2.5) o25 += p; if (i && j) bt += p; }
    const m = [`Das Modell erwartet ${lam.lh.toFixed(1)} Tore für ${g.h} und ${lam.la.toFixed(1)} für ${g.a}.`,
      `Daraus ergeben sich etwa ${pct(q[1] / s)} für einen Heimsieg, ${pct(q.X / s)} für ein Unentschieden und ${pct(q[2] / s)} für einen Auswärtssieg.`,
      `Mehr als 2.5 Tore: rund ${pct(o25)}. Beide Teams treffen: rund ${pct(bt)}.`];
    if (h2h.length) m.push(`Direktduell diese Saison: ${h2h.map((x) => `${x.h}–${x.a} ${x.hs}:${x.as}`).join(', ')}.`);
    m.push('Das ist eine Beschreibung aus den Zahlen, kein Tipp. U19-Spiele sind schwer vorherzusagen, weil Kader oft wechseln.');
    P.push({ h: 'Was der Roboter sagt', t: m.join(' ') });
  }
  return P;
}
let u19At = 0;
function u19Sweep() {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(U19, 'utf8')); } catch { return; }
  const now = Date.now();
  const games = (doc.games || []).map((g) => ({ ...g, ts: Date.parse(g.t) })).filter((g) => Number.isFinite(g.ts));
  const played = games.filter((g) => g.ts < now && Number.isFinite(g.hs) && Number.isFinite(g.as));
  const R = ratings(played.map((g) => ({ home: g.h, away: g.a, hs: g.hs, as: g.as, ts: g.ts })), now, { half: 60 * DAY, prior: 3 });
  u19Teams = doc.teams || {};
  const T = u19Table(played), rank = u19Rank(T).map((r) => ({ ...r, sp: u19Teams[r.team]?.sp })), players = doc.players || {};
  const st = u19Stats(played);
  // Anteil der Tore in der ersten Halbzeit (für die Halbzeit-Märkte)
  const allG = played.flatMap((g) => g.r?.g || []), hf = allG.length > 50 ? allG.filter((x) => x[0] <= 45).length / allG.length : 0.45;
  const scorers = Object.entries(players).flatMap(([team, l]) => l.map(([n, apps, goals]) => ({ n, team, apps, goals }))).sort((a, b) => b.goals - a.goals || a.apps - b.apps).slice(0, 30);
  u19Over = { updated: doc.updated, playersAt: doc.playersAt, playersSrc: doc.playersSrc, table: rank, scorers, goals: played.reduce((s, g) => s + g.hs + g.as, 0), games: played.length, home: played.filter((g) => g.hs > g.as).length, draw: played.filter((g) => g.hs === g.as).length };
  let n = 0;
  for (const g of games) {
    const id = 'u19-' + g.t.slice(0, 10) + '-' + plainName(g.h).replace(/ /g, '') + '-' + plainName(g.a).replace(/ /g, '');
    const old = store.get(id);
    if (!old && g.ts < now - 2 * DAY) continue; // alte Spiele nur für die Ratings
    const ev = {
      id, sport: F, lg: 'sui.u19', start: g.ts, day: '', u19: true, nohalf: false,
      home: { n: g.h + ' U19', s: g.h + ' U19', l: logoOf(g.h) }, away: { n: g.a + ' U19', s: g.a + ' U19', l: logoOf(g.a) },
      state: 'pre', done: false, void: false, et: false, txt: '', sh: null, sa: null, src: {},
    };
    if (Number.isFinite(g.hs) && Number.isFinite(g.as)) {
      Object.assign(ev, { state: 'post', done: true, txt: 'Beendet', sh: g.hs, sa: g.as });
      // Torschützen trage ich nach der Runde ein (aus dem offiziellen Spielbericht, mit Minute)
      if (g.r) { ev.goals = g.r.g.map(([m, , n, og]) => ({ n, m, ...(og ? { og: true } : {}) })); ev.np = g.np || []; }
      else if (Array.isArray(g.sc)) { ev.goals = g.sc.map((n) => ({ n, m: 1 })); ev.np = g.np || []; }
      // Halbzeit-Märkte: ohne Pausenstand Geld zurück
      if (Array.isArray(g.ht)) ev.h1 = g.ht;
      else ev.nohalf = true;
    } else if (g.off || g.ts < now - 7 * DAY) Object.assign(ev, { state: 'post', void: true, txt: 'Verschoben' });
    else if (g.ts < now) Object.assign(ev, now - g.ts < 2 * 36e5 ? { state: 'in', txt: 'läuft' } : { state: 'post', txt: 'Resultat folgt' });
    else if (R) {
      // Tore (Angriff/Abwehr nach Gegnerstärke) ...
      const lam = fromRatings(R, g.h, g.a, 4.5, 0.8);
      // ... plus Tabelle und Form: Tore allein überschätzen Teams mit vielen Toren, aber wenig Punkten
      const f = ((u19Str(T, g.h, true) + 1) / (u19Str(T, g.a, false) + 1)) ** 1.6;
      lam.lh = Math.min(4.5, Math.max(0.35, lam.lh * Math.sqrt(Math.min(2.2, Math.max(0.45, f)))));
      lam.la = Math.min(4.5, Math.max(0.35, lam.la / Math.sqrt(Math.min(2.2, Math.max(0.45, f)))));
      // Poisson ist bei so vielen Toren zu sicher (Saison: 78 % über 2.5, Modell sagte ~88 %): Tore Richtung 3.9 ziehen
      const tot = lam.lh + lam.la, fT = (0.6 * tot + 0.4 * 3.9) / tot;
      lam.lh *= fT; lam.la *= fT;
      const hS = g.u21h ?? u21Same(g.h, g.ts), aS = g.u21a ?? u21Same(g.a, g.ts);
      const adj = (x) => (x === true ? 0.88 : x === false || x === 0 ? 1.04 : 1);
      lam.lh *= adj(hS) / Math.sqrt(adj(aS)); lam.la *= adj(aS) / Math.sqrt(adj(hS));
      // Poisson unterschätzt Unentschieden (U19 Elite diese Saison: 21 %), darum X etwas anheben
      const w0 = oneXtwo(lam, 'Modell');
      const w = w0 && (() => { const p = { 1: 1 / w0[1].o, X: 1.18 / w0.X.o, 2: 1 / w0[2].o }, s = p[1] + p.X + p[2]; return Object.fromEntries(Object.entries(p).map(([k, x]) => [k, Math.round(100 / (1.07 * x / s)) / 100])); })();
      const gs = w && u19Scorers(players, T, g, lam, hS, aS, st.recent);
      if (w) ev.src = { mod: { w }, lam, hf, u21: [hS, aS], u19gs: gs?.gsa || null, u19gf: gs?.gsf || null };
      ev.u21 = [hS, aS];
      // Serien (ab 3 Siegen oder Niederlagen in Folge) aus der ganzen Saison
      const sk = (team) => { const r = T.get(team)?.res || [], k = (y) => (y.gf > y.ga ? 'w' : y.gf < y.ga ? 'l' : 'd'); const last = r.length && k(r[r.length - 1]); if (!last || last === 'd') return null; let n = 0; for (let i = r.length - 1; i >= 0 && k(r[i]) === last; i--) n++; return n >= 3 ? { k: last, n } : null; };
      const skx = [sk(g.h), sk(g.a)];
      if (skx[0] || skx[1]) ev.sk = skx;
      const h2h = played.filter((x) => (x.h === g.h && x.a === g.a) || (x.h === g.a && x.a === g.h)).map((x) => ({ t: x.ts, h: x.h, a: x.a, hs: x.hs, as: x.as }));
      ev.info = { v: g.v || '', h: u19TeamInfo(T, rank, players, g.h, true), a: u19TeamInfo(T, rank, players, g.a, false), xg: [Math.round(lam.lh * 10) / 10, Math.round(lam.la * 10) / 10], h2h,
        rep: u19Report(g, T, rank, st, players, lam, w, hS, aS, h2h) };
    }
    upsert(ev);
    n++;
  }
  if (now - u19At > 36e5) { u19At = now; console.log(`U19 Elite: ${n} Spiele aus u19.json`); }
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
  const due = [...store.values()].filter((ev) => ev.sport === F && !ev.fd && !ev.u19 && !ev.id.startsWith('fs') && !fsCovered.has(ev.lg) && ev.state === 'pre' && !ev.void && ev.start > now && ev.start < now + 5 * DAY
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
const fsDays = new Map(); // "Sportart|Tag" -> { at, list }
const fsCovered = new Set(); // Ligen, deren Spiele von Flashscore kommen
let fsStat = { matched: 0, odds: 0, at: 0 };

// Ein Flashscore-Spiel als eigenes Spiel: Spielplan, Live-Stand und Resultat.
function fsEvent(sport, slug, x) {
  const soccer = sport === F;
  const pre = x.st === 1 || (x.st !== 2 && x.st !== 3);
  const fin = x.st === 3 && [3, 10, 11].includes(x.ac);
  const extra = x.ac === 10 || x.ac === 11;
  // Fussball und Eishockey zählen nach 90 bzw. 60 Minuten; Flashscore liefert diesen Stand separat.
  const reg = (soccer || sport === H) && extra && x.rt[0] != null ? x.rt : x.g;
  const ev = {
    id: 'fs' + x.id, sport, lg: slug, start: x.start, day: '',
    home: { id: x.hp, n: x.home, s: x.home, l: x.lh }, away: { id: x.ap, n: x.away, s: x.away, l: x.la },
    state: pre ? 'pre' : x.st === 2 ? 'in' : 'post', done: fin && reg[0] != null && reg[1] != null,
    void: x.st === 3 && !fin, et: false, ot: false,
    sh: pre ? null : fin ? reg[0] : x.g[0], sa: pre ? null : fin ? reg[1] : x.g[1],
    win: fin && sport !== F ? x.win : null,
    h1: soccer && x.st === 3 && x.h1[0] != null && x.h1[1] != null ? x.h1 : null,
    txt: pre ? '' : x.st === 2 ? 'läuft' : !fin ? 'abgesagt' : x.ac === 10 ? `n. V. ${x.g[0]}:${x.g[1]}` : x.ac === 11 ? `n. P. ${x.g[0]}:${x.g[1]}` : 'Beendet',
    fsId: x.id, fsH: x.hp, fsA: x.ap, src: {},
    // Spielphase während des Spiels (für frühe Abrechnung): Fussball 12/13 Halbzeiten, 38 Pause;
    // Eishockey 14/15/16 Drittel, 46 Pause
    ph: x.st === 2 ? x.ac : null,
  };
  if (sport === T) ev.tour = x.lg.replace(/^(ATP|WTA) - SINGLES:\s*/, '');
  if (sport === D) ev.tour = x.lg.replace(/^[A-Z &]+:\s*/, '');
  return ev;
}

async function fsSweep() {
  const now = Date.now();
  for (const [sport, sid] of Object.entries(FS_SPORT)) {
    for (const d of [0, 1, 2, -1, 3, 4, 5, 6, 7, -2, -3, -4, -5, -6, -7]) {
      const k = sport + '|' + d, c = fsDays.get(k);
      // heute/gestern oft (Live-Stand, Resultate), die übrigen Tage seltener
      const ttl = d >= -1 && d <= 0 ? 5 : d < -1 ? 180 : d <= 2 ? 30 : 120;
      if (c && now - c.at < ttl * 6e4) continue;
      try { fsDays.set(k, { at: now, list: (await fsList(sid, d)).filter((x) => !/\//.test(x.home + x.away)) }); } catch { /* Tag fehlt, nächstes Mal */ }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  const lists = new Map();
  for (const [k, c] of fsDays) { const s = k.split('|')[0]; if (!lists.has(s)) lists.set(s, []); lists.get(s).push(...c.list); }
  // Spiele der bekannten Ligen direkt übernehmen
  const known = new Set(LEAGUES.map((l) => l.slug));
  for (const [sport, list] of lists) {
    for (const x of list) {
      const slug = fsLeague(sport, x.lg);
      if (!slug || !known.has(slug)) continue;
      // Testspiele: nur A-Nationalteams, keine Junioren (U17, U21, ...)
      if (/^fifa\.friendly/.test(slug) && /\bU\d{2}\b/.test(x.home + ' ' + x.away)) continue;
      fsCovered.add(slug);
      upsert(fsEvent(sport, slug, x));
    }
  }
  const open = [...store.values()].filter((e) => !e.u19 && e.state === 'pre' && !e.void && e.start > now && e.start < now + 8 * DAY);
  let matched = 0;
  for (const ev of open) {
    if (!ev.fsId) {
      const hit = lists.has(ev.sport) && fsMatch(ev, lists.get(ev.sport));
      if (hit) Object.assign(ev, { fsId: hit.id, fsH: hit.hp, fsA: hit.ap });
    }
    if (!ev.fsId) continue;
    matched++;
    // Spiel aus anderer Quelle mit Flashscore-Zwilling: dessen Modellquote weitergeben, falls Flashscore keine hat.
    const tw = !ev.id.startsWith('fs') && store.get('fs' + ev.fsId);
    if (tw && tw.state === 'pre' && !tw.src.fs) {
      for (const k of ['b365', 'dk', 'mod', 'lam']) if (ev.src?.[k]) tw.src[k] = ev.src[k];
      build(tw);
    }
  }
  const due = open.filter((e) => e.fsId && (e.id.startsWith('fs') || !fsCovered.has(e.lg))
    && now - (e.fsAt || 0) > (e.start - now < 3 * 36e5 ? 10 : e.start - now < DAY ? 30 : 120) * 6e4);
  // Wichtige Ligen zuerst (als ob sie 4 Tage früher spielten), dann nach Anstoss.
  // Kleine Ligen wie College-Basketball (Hunderte Spiele) kommen danach.
  const TOPL = /^(nfl|nba|nhl|euroleague|darts|sui\.|ita\.[12]$|ita\.[cd]|eng\.1|esp\.1|ger\.1|fra\.1|uefa\.|arg\.1|rug\.)/;
  const prio = (e) => e.start - (TOPL.test(e.lg) ? 4 * DAY : 0) + (/college/.test(e.lg) ? DAY : 0);
  due.sort((a, b) => prio(a) - prio(b));
  await pool(due.slice(0, 900), 4, async (ev) => {
    ev.fsAt = Date.now();
    const o = await fsOdds(ev.fsId, ev.fsH, ev.fsA, ev.sport, { nohalf: ev.nohalf });
    const cur = store.get(ev.id);
    if (o && cur && cur.state === 'pre') {
      // Richtung der letzten Änderung pro Tipp merken (wie die Pfeile auf Flashscore).
      const prev = cur.src?.fs?.m || {}, mv = {};
      for (const [mk, x] of Object.entries(o.m)) {
        for (const [p, s] of Object.entries(x)) {
          if (p === 'line' || !s?.o) continue;
          const old = prev[mk]?.[p];
          const sameLine = prev[mk]?.line === x.line && old?.b === s.b;
          // { d: 1 gestiegen / -1 gesunken, t: Zeitpunkt der Änderung }
          const was = cur.mv?.[mk]?.[p];
          const hit = sameLine && old.o !== s.o ? { d: s.o > old.o ? 1 : -1, t: Date.now() } : sameLine && was?.t ? was : null;
          if (hit) (mv[mk] ||= {})[p] = hit;
        }
      }
      cur.mv = mv;
      cur.src = { ...cur.src, fs: o }; build(cur);
    }
    await new Promise((r) => setTimeout(r, 250));
  });
  const own = open.filter((e) => e.id.startsWith('fs'));
  fsStat = { matched, odds: own.filter((e) => e.src?.fs).length, at: Date.now() };
  lastSweep = Date.now();
  console.log(`Flashscore: ${own.length} offene Spiele in ${fsCovered.size} Ligen, ${fsStat.odds} mit Quoten`);
  await skiSweep().catch((e) => console.log('Ski:', e.message));
  await propsSweep().catch((e) => console.log('NBA-Spielerwetten:', e.message));
  queueSave();
}

// Live-Stände und Resultate: unabhängig von der langen Runde oben (Quoten, Ski, Bot) alle 90 Sekunden
// die Tageslisten der Sportarten holen, in denen ein Flashscore-Spiel angefangen hat, aber nicht abgerechnet ist.
let fsLiveBusy = false;
async function fsLive() {
  if (fsLiveBusy) return;
  fsLiveBusy = true;
  try {
    const now = Date.now();
    const open = [...store.values()].filter((e) => e.id.startsWith('fs') && !e.done && !e.void && e.start < now && e.start > now - 2 * DAY);
    const known = new Set(LEAGUES.map((l) => l.slug));
    for (const sport of new Set(open.map((e) => e.sport))) {
      const sid = FS_SPORT[sport];
      if (!sid) continue;
      for (const d of open.some((e) => e.sport === sport && now - e.start > 8 * 36e5) ? [0, -1] : [0]) {
        let list;
        try { list = (await fsList(sid, d)).filter((x) => !/\//.test(x.home + x.away)); } catch { continue; }
        fsDays.set(sport + '|' + d, { at: Date.now(), list });
        for (const x of list) {
          const slug = fsLeague(sport, x.lg);
          if (slug && known.has(slug) && store.has('fs' + x.id)) upsert(fsEvent(sport, slug, x));
        }
      }
    }
  } finally { fsLiveBusy = false; }
}

/* ---------- Ski alpin: Rennen mit Sieger-, Podest- und Top-10-Wetten ---------- */

const DISC = { 'Downhill': 'Abfahrt', 'Super-G': 'Super-G', 'Giant Slalom': 'Riesenslalom', 'Slalom': 'Slalom', 'Alpine Combined': 'Kombination', 'Combined': 'Kombination', 'Team Combined': 'Team-Kombination', 'Parallel': 'Parallel' };
// Ausfallquote pro Disziplin (Slalom am höchsten), ungefähr aus Weltcup-Resultaten
const DNF = { Slalom: 0.24, Riesenslalom: 0.15, 'Super-G': 0.08, Abfahrt: 0.05 };
const title = (s) => s.toLowerCase().replace(/(^|[\s.-])\S/g, (x) => x.toUpperCase());

// Modell: Stärke aus der Reihenfolge der Favoriten (Flashscore-Position vor dem Rennen).
// Plackett-Luce mit Gumbel-Zufall, dazu Ausfälle; die Liste wird bis 70 Läufer mit «Rest des Feldes» aufgefüllt.
// Quote = 0.88 / Wahrscheinlichkeit (12 % Marge wie bei Siegerwetten üblich), als «Modellquote» angeschrieben.
function skiModel(ath, disc) {
  // Stärke = Position^-1.3: die Besten deutlich vorne (Nr. 1 gewinnt ohne Ausfall rund jedes dritte Rennen)
  const A = 1.3, N = 20000, dnf = DNF[disc] ?? 0.15;
  const field = ath.map((a) => ({ id: a.id, s: a.seed }));
  const maxS = Math.max(30, ...field.map((a) => a.s < 99 ? a.s : 0));
  for (let s = maxS + 1; s <= 70; s++) field.push({ id: null, s });
  const lw = field.map((a) => -A * Math.log(Math.min(a.s, 70)));
  const cnt = field.map(() => [0, 0, 0]);
  const sc = new Float64Array(field.length), idx = field.map((_, i) => i);
  for (let n = 0; n < N; n++) {
    for (let i = 0; i < field.length; i++) sc[i] = Math.random() < dnf ? -1e9 : lw[i] - Math.log(-Math.log(Math.random()));
    idx.sort((a, b) => sc[b] - sc[a]);
    for (let r = 0; r < 10; r++) { const i = idx[r]; if (sc[i] < -1e8) break; if (r === 0) cnt[i][0]++; if (r < 3) cnt[i][1]++; cnt[i][2]++; }
  }
  const odds = (c) => { const p = Math.max(c / N, 0.0015); const o = 0.88 / p; return Math.min(501, Math.max(1.03, o < 10 ? Math.round(o * 100) / 100 : o < 50 ? Math.round(o * 2) / 2 : Math.round(o))); };
  const m = { sw: {}, sp: {}, s10: {} };
  field.forEach((a, i) => {
    if (!a.id) return;
    m.sw[a.id] = { o: odds(cnt[i][0]), b: 'Modell' };
    m.sp[a.id] = { o: odds(cnt[i][1]), b: 'Modell' };
    m.s10[a.id] = { o: odds(cnt[i][2]), b: 'Modell' };
  });
  return m;
}

// Echte Ski-Quoten von Unibet (Kambi-Angebot, offen abrufbar). Rennen erscheinen meist erst 1–2 Tage vorher.
const KAMBI = 'https://eu-offering-api.kambicdn.com/offering/v2018/ub';
let kambi = { at: 0, ev: [] };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
async function kambiSki() {
  if (Date.now() - kambi.at < 20 * 6e4) return kambi.ev;
  const out = [];
  try {
    const list = JSON.parse(await getText(`${KAMBI}/listView/winter_sports/alpine_skiing.json?lang=en_GB&market=CH&useCombined=true`));
    for (const { event: e } of list.events || []) {
      if (/standings|overall|cup winner/i.test(e.name)) continue; // Saisonwertungen sind keine Rennen
      const d = JSON.parse(await getText(`${KAMBI}/betoffer/event/${e.id}.json?lang=en_GB&market=CH`));
      const m = {};
      for (const b of d.betOffers || []) {
        const L = b.criterion?.englishLabel || b.criterion?.label || '';
        const k = /top 3|podium/i.test(L) ? 'sp' : /top 10/i.test(L) ? 's10' : /winner|finishing position|to win/i.test(L) ? 'sw' : null;
        if (!k || m[k]) continue;
        m[k] = (b.outcomes || []).filter((o) => o.status === 'OPEN' && o.odds > 1000).map((o) => ({ n: o.participant || o.label, o: Math.round(o.odds / 10) / 100 }));
      }
      out.push({ name: e.englishName || e.name, group: e.group || '', start: Date.parse(e.start), m });
      await new Promise((r) => setTimeout(r, 300));
    }
    kambi = { at: Date.now(), ev: out };
  } catch (e) { console.log('Unibet Ski:', e.message); kambi.at = Date.now() - 15 * 6e4; }
  return kambi.ev;
}
// Unibet «Lucas Pinheiro Braathen» ↔ Flashscore «Pinheiro Braathen L.»
function kambiMarkets(K, r, men, disc, ath) {
  const en = Object.entries(DISC).find(([, v]) => v === disc)?.[0] || disc;
  const ke = K.find((k) => Math.abs(k.start - r.start) < 4 * 36e5 && /\bwomen|ladies\b/i.test(k.name + k.group) !== men && norm(k.name).includes(norm(en)));
  if (!ke) return null;
  const fsKey = new Map(ath.map((a) => { const t = norm(a.n).split(' '); return [t.slice(0, -1).join(' ') + '|' + (t.at(-1) || '')[0], a.id]; }));
  const idOf = (n) => { const t = norm(n).split(' '); for (let i = 1; i < t.length; i++) { const id = fsKey.get(t.slice(i).join(' ') + '|' + t[0][0]); if (id) return id; } return null; };
  const m = {};
  for (const [k, list] of Object.entries(ke.m)) {
    const x = {};
    for (const o of list) { const id = idOf(o.n); if (id) x[id] = { o: o.o, b: 'Unibet' }; }
    if (Object.keys(x).length >= 5) m[k] = x;
  }
  return Object.keys(m).length ? m : null;
}

// NBA-Spielerwetten (Über/Unter Punkte, Rebounds, Assists, Dreier) von Unibet, alle 20 Minuten
const PROP_CRIT = [[/^points scored by the player/i, 'pts'], [/^rebounds by the player/i, 'reb'], [/^assists by the player/i, 'ast'], [/^3-point field goals made by the player/i, 'tpm']];
let propsAt = 0;
async function propsSweep() {
  const now = Date.now();
  if (now - propsAt > 20 * 6e4) {
    propsAt = now;
    try {
      const list = JSON.parse(await getText(`${KAMBI}/listView/basketball/nba.json?lang=en_GB&market=CH&useCombined=true`));
      const last = (s) => norm(s).split(' ').at(-1);
      const fsNba = [...store.values()].filter((e) => e.lg === 'nba' && String(e.id).startsWith('fs') && e.state === 'pre');
      let n = 0;
      for (const { event: k } of list.events || []) {
        const st = Date.parse(k.start);
        const ev = fsNba.find((e) => Math.abs(e.start - st) < 3 * 36e5 && last(e.home.n) === last(k.homeName) && last(e.away.n) === last(k.awayName));
        if (!ev || st - now > 2 * DAY) continue;
        const d = JSON.parse(await getText(`${KAMBI}/betoffer/event/${k.id}.json?lang=en_GB&market=CH`));
        const props = {};
        for (const b of d.betOffers || []) {
          const st2 = PROP_CRIT.find(([re]) => re.test(b.criterion?.englishLabel || ''))?.[1];
          if (!st2) continue;
          const by = new Map();
          for (const o of b.outcomes || []) {
            if (o.status !== 'OPEN' || !(o.odds > 1000) || !o.participant || o.line == null) continue;
            const key = o.participant + '|' + o.line;
            if (!by.has(key)) by.set(key, { n: o.participant, line: o.line / 1000 });
            by.get(key)[/^over/i.test(o.englishLabel || o.label) ? 'O' : 'U'] = Math.round(o.odds / 10) / 100;
          }
          // pro Spieler die ausgeglichenste Linie
          const best = new Map();
          for (const x of by.values()) {
            if (!x.O || !x.U) continue;
            const g = Math.abs(x.O - x.U), cur = best.get(x.n);
            if (!cur || g < cur.g) best.set(x.n, { ...x, g });
          }
          for (const x of best.values()) props[`pp|${st2}|${x.n}`] = { line: x.line, O: { o: x.O, b: 'Unibet' }, U: { o: x.U, b: 'Unibet' } };
        }
        if (Object.keys(props).length) { ev.src.props = props; build(ev); n++; }
        await new Promise((r) => setTimeout(r, 300));
      }
      console.log(`NBA-Spielerwetten: ${n} Spiele`);
    } catch (e) { console.log('NBA-Spielerwetten:', e.message); }
  }
  // Statistik nach Spielschluss holen (nur für Spiele mit Spielerwetten)
  for (const ev of store.values()) {
    if (!ev.done || !ev.src?.props || ev.src.ps || now - ev.start > 3 * DAY || (ev.psTry || 0) > now - 15 * 6e4) continue;
    ev.psTry = now;
    try {
      const raw = await fsPlayerStats(ev.id.slice(2));
      if (raw) { ev.src.ps = Object.fromEntries(Object.entries(raw).map(([k, v]) => [psKey(k), v])); build(ev); queueSave(); }
    } catch { /* später nochmals */ }
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function skiSweep() {
  const now = Date.now();
  const K = await kambiSki();
  for (const d of [0, 1, 2, -1, 3, 4, 5, 6, 7, -2, -3]) {
    const k = 'ski|' + d, c = fsDays.get(k);
    const ttl = d >= -1 && d <= 0 ? 5 : d < -1 ? 180 : 60;
    if (c && now - c.at < ttl * 6e4) continue;
    try { fsDays.set(k, { at: now, races: await fsRaces(d) }); } catch { /* nächstes Mal */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  let n = 0;
  for (const [k, c] of fsDays) {
    if (!k.startsWith('ski|')) continue;
    for (const r of c.races || []) {
      // «COPPER MT.: Giant Slalom - Men (USA)»
      const mt = /^(.+?):\s*(.+?)\s+-\s+(Men|Women)\s*(?:\((.+)\))?/.exec(r.name);
      if (!mt || r.ath.length < 8) continue;
      const disc = DISC[mt[2]] || mt[2];
      const id = 'sk' + r.id, old = store.get(id);
      const ath = r.ath.slice().sort((a, b) => a.seed - b.seed);
      const done = r.state === 'post' && !r.void;
      const ev = {
        id, sport: 'ski', race: true, lg: mt[3] === 'Men' ? 'ski.m' : 'ski.w', start: r.start, day: '',
        home: { id: '', n: `${title(mt[1])} · ${disc}`, s: title(mt[1]), l: '' }, away: { id: '', n: mt[3] === 'Men' ? 'Herren' : 'Damen', s: '', l: '' },
        tour: mt[4] || '', disc, state: r.void ? 'post' : r.state, done, void: r.void, et: false, ot: false, sh: null, sa: null,
        txt: r.void ? 'abgesagt' : r.state === 'in' ? 'läuft' : done ? 'Beendet' : '',
        al: ath.map((a) => ({ id: a.id, n: a.n, c: a.c })),
        ranks: done ? Object.fromEntries(r.ath.map((a) => [a.id, a.rank])) : null,
        src: {},
      };
      // Modell nur vor dem Start neu rechnen, und nur wenn sich die Startliste geändert hat
      const sig = 'v2|' + ath.map((a) => a.id + a.seed).join(); // v2 = Modellversion, bei Änderungen am Modell erhöhen
      if (r.state === 'pre') {
        const model = old?.skiSig === sig && old.src?.skiModel ? old.src.skiModel : skiModel(ath, disc);
        ev.src.skiModel = model;
        // Ein Anbieter pro Rennen: Unibet für die Märkte, die es anbietet, Modell nur für fehlende Märkte
        const real = kambiMarkets(K, r, mt[3] === 'Men', disc, ath);
        ev.src.ski = real ? { ...model, ...real } : model;
        ev.src.skiBook = real ? 'Unibet' : 'Modell';
      } else if (old?.src) { ev.src.ski = old.src.ski; ev.src.skiBook = old.src.skiBook; }
      ev.skiSig = r.state === 'pre' ? sig : old?.skiSig;
      upsert(ev);
      n++;
    }
  }
  console.log(`Ski: ${n} Rennen`);
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

// Sieges- und Niederlagenserien (ab 3) aus den beendeten Spielen der letzten 120 Tage im Speicher.
// Unentschieden beendet beide Serien. Wird höchstens einmal pro Minute neu berechnet.
let skAt = 0, skMap = new Map();
function streaks(now) {
  if (now - skAt < 60e3) return skMap;
  const seen = new Set(), list = [];
  for (const e of store.values()) {
    if (!e.done || e.void || e.u19 || !Number.isFinite(e.sh) || !Number.isFinite(e.sa) || now - e.start > 120 * DAY || !e.home?.n || !e.away?.n) continue;
    const k = `${e.sport}|${plainName(e.home.n)}|${plainName(e.away.n)}|${Math.round(e.start / 36e5)}`;
    if (seen.has(k)) continue;
    seen.add(k); list.push(e);
  }
  list.sort((a, b) => a.start - b.start);
  const seq = new Map();
  for (const e of list) {
    const hw = e.sport !== F && String(e.win) === '1' ? true : e.sport !== F && String(e.win) === '2' ? false : e.sh > e.sa ? true : e.sh < e.sa ? false : null;
    for (const [t, r] of [[e.home.n, hw === null ? 'd' : hw ? 'w' : 'l'], [e.away.n, hw === null ? 'd' : hw ? 'l' : 'w']]) {
      const key = e.sport + '|' + plainName(t);
      if (!seq.has(key)) seq.set(key, []);
      seq.get(key).push(r);
    }
  }
  const out = new Map();
  for (const [key, s] of seq) {
    const last = s[s.length - 1];
    if (last === 'd') continue;
    let n = 0;
    for (let i = s.length - 1; i >= 0 && s[i] === last; i--) n++;
    if (n >= 3) out.set(key, { k: last, n });
  }
  skAt = now; skMap = out;
  return out;
}
function payload(need) {
  const now = Date.now();
  const events = [];
  const SK = streaks(now);
  const known = new Set(LEAGUES.map((l) => l.slug));
  const onlyReal = new Set(LEAGUES.filter((l) => l.onlyReal).map((l) => l.slug));
  for (const ev of store.values()) {
    if (!need.has(ev.id) && (!known.has(ev.lg) || ev.start < now - 2 * DAY || ev.start > now + 10 * DAY || ev.done || ev.void || ev.state !== 'pre')) continue;
    // Promotion League / 1. Liga: nur Spiele, für die ein Buchmacher wirklich Quoten anbietet.
    if (!need.has(ev.id) && onlyReal.has(ev.lg) && !ev.src?.fs?.m?.['1x2']) continue;
    // Liga kommt von Flashscore: Spiele aus anderen Quellen nur noch für bestehende Wetten zeigen.
    if (!need.has(ev.id) && fsCovered.has(ev.lg) && !ev.id.startsWith('fs')) continue;
    const { src, b365At, day, fsId, fsH, fsA, fsAt, mv, skiSig, ...pub } = ev;
    // Pfeile nur für Quoten, die sich in den letzten 2 Stunden geändert haben
    if (mv) {
      const rec = {};
      for (const [mk, x] of Object.entries(mv)) for (const [p, c] of Object.entries(x)) if (c?.t > now - 2 * 36e5) (rec[mk] ||= {})[p] = c.d;
      if (Object.keys(rec).length) pub.mv = rec;
    }
    // Alte Wette auf ein Spiel aus einer anderen Quelle: Resultat vom Flashscore-Zwilling nehmen.
    const tw = fsId && !ev.id.startsWith('fs') && !ev.done && !ev.void && store.get('fs' + fsId);
    if (tw && (tw.done || tw.void || tw.state !== 'pre')) {
      for (const k of ['state', 'done', 'void', 'sh', 'sa', 'win', 'h1', 'et', 'ot', 'txt', 'ph']) pub[k] = tw[k];
    }
    // Modellquoten nur, wenn 24 Stunden vor dem Spiel immer noch kein Buchmacher Quoten hat.
    if (ev.book === 'Modell' && ev.lg !== 'sui.u19' && ev.start - now > DAY) { pub.m = {}; pub.cmp = {}; pub.wait = true; }
    if (!ev.u19 && ev.state === 'pre' && ev.home?.n && ev.away?.n) {
      const sk = [SK.get(ev.sport + '|' + plainName(ev.home.n)) || null, SK.get(ev.sport + '|' + plainName(ev.away.n)) || null];
      if (sk[0] || sk[1]) pub.sk = sk;
    }
    events.push(pub);
  }
  return { t: now, upd: lastSweep, leagues: LEAGUES.filter((l) => !l.dead || fsCovered.has(l.slug)).map(({ slug, sport, name, land }) => ({ slug, sport, name, land })), events };
}

// Fremde Scheine werden erst abgerechnet, wenn ihr Besitzer die Seite öffnet. Für die Anzeige
// bei den anderen Spielern hier schon mit den bekannten Resultaten auswerten (nur Kopie, nicht gespeichert).
function evFor(id) {
  const ev = store.get(id);
  const tw = ev?.fsId && !id.startsWith('fs') && !ev.done && !ev.void && store.get('fs' + ev.fsId);
  if (!tw || tw.state === 'pre') return ev;
  const x = { ...ev };
  for (const k of ['state', 'done', 'void', 'sh', 'sa', 'win', 'h1', 'et', 'ot', 'txt', 'ph']) x[k] = tw[k];
  return x;
}
function liveBets(bets = []) {
  for (const b of bets) {
    if (b.status !== 'open') continue;
    for (const l of b.legs || []) {
      if (l.res) continue;
      const e = evFor(l.ev), r = e && evalLeg(l, e);
      if (r) { l.res = r; l.score = scoreText(e, l); continue; }
      const early = e && evalLegEarly(l, e);
      if (early) { l.res = early; l.score = earlyText(e); l.early = true; }
    }
    const out = settleBet(b);
    // pend: entschieden, aber beim Besitzer noch nicht ausbezahlt
    if (out) Object.assign(b, { status: out.status, payout: out.payout, done: Date.now(), pend: true, ...(out.ins ? { ins: true } : {}), ...(out.capped ? { capped: true } : {}) });
  }
  return bets;
}

// Clauder: Bot-Spieler, dessen Tipps in clauder.json stehen (Spiel-ID, Markt, Tipp, Einsatz, Begründung).
const BOT_FILE = path.join(DIR, 'clauder.json');
function botLeg(t) {
  const now = Date.now(), ev = store.get(t.ev);
  if (!ev) return t.start && now > Date.parse(t.start) ? 'gone' : null;
  if (ev.void || ev.done || ev.state !== 'pre' || ev.start <= now + 5 * 6e4) return 'gone';
  const mk = ev.m?.[t.m], sel = mk?.[t.p];
  if (!sel?.o) return ev.start - now < 30 * 6e4 ? 'gone' : null;
  // Quote darf seit der Analyse nicht stark gefallen sein, sonst lohnt sich der Tipp nicht mehr
  if (t.minOdds && sel.o < t.minOdds) return ev.start - now < 30 * 6e4 ? 'gone' : null;
  const L = LEAGUES.find((l) => l.slug === ev.lg);
  return {
    ev: ev.id, m: t.m, p: t.p, line: mk.line ?? null, o: sel.o, b: sel.b, pick: t.pick || t.p, mk: t.mk || t.m, sp: ev.sport, ls: ev.lg,
    match: ev.race ? `${ev.home.n} ${ev.away.n}` : `${ev.home.n} – ${ev.away.n}`, lg: L?.name || '', start: ev.start, res: null,
  };
}
function botSettle(b) {
  for (const l of b.legs) {
    if (l.res) continue;
    const e = evFor(l.ev), r = e && evalLeg(l, e);
    if (r) { l.res = r; l.score = scoreText(e, l); continue; }
    const early = e && evalLegEarly(l, e);
    if (early) { l.res = early; l.score = earlyText(e); l.early = true; }
  }
  return settleBet(b);
}
// Auto-Runde: Clauder sucht selbst Tipps. Formmodell (Angriff/Abwehr aus den Resultaten der Liga, bei
// Basketball Punktedifferenz) gegen die Buchmacherquote. Je mehr Spiele er von beiden Teams kennt, desto
// mehr zählt sein Modell und desto höher der Einsatz. Ohne klaren Vorteil tippt er nicht.
const phi = (x) => 1 / (1 + Math.exp(-1.702 * x));
function botAuto(s) {
  const now = Date.now(), all = [...store.values()];
  const byLg = new Map();
  for (const e of all) {
    if (!e.done || e.void || !Number.isFinite(e.sh) || !Number.isFinite(e.sa) || now - e.start > 120 * DAY) continue;
    if (!byLg.has(e.lg)) byLg.set(e.lg, []);
    byLg.get(e.lg).push(e);
  }
  const games = (lg) => {
    const list = byLg.get(lg) || [], fsOnly = list.filter((e) => String(e.id).startsWith('fs'));
    const use = fsOnly.length >= 6 ? fsOnly : list, seen = new Set();
    return use.filter((e) => { const k = `${e.home.n}|${e.away.n}|${Math.round(e.start / 36e5)}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((e) => ({ home: e.home.n, away: e.away.n, hs: e.sh, as: e.sa, ts: e.start }));
  };
  const R = new Map(), cnt = (G, t) => G.filter((g) => g.home === t || g.away === t).length;
  const cands = [];
  for (const ev of all) {
    if (!String(ev.id).startsWith('fs') || ev.state !== 'pre' || ev.void || ev.race) continue;
    if (ev.start < now + 2 * 36e5 || ev.start > now + 36 * 36e5 || !ev.book || /modell/i.test(ev.book)) continue;
    if (![F, H, B].includes(ev.sport)) continue;
    const mk = ev.sport === B ? 'ml' : '1x2', w = ev.m?.[mk];
    const keys = ev.sport === B ? ['1', '2'] : ['1', 'X', '2'];
    if (!w || keys.some((k) => !(w[k]?.o > 1))) continue;
    const G = games(ev.lg), h = ev.home.n, a = ev.away.n;
    const n = Math.min(cnt(G, h), cnt(G, a));
    if (n < 5) continue; // zu wenig Wissen über eines der Teams
    let pm;
    if (ev.sport === B) {
      const mar = (t) => { const g = G.filter((x) => x.home === t || x.away === t).slice(-12); return g.reduce((x, y) => x + (y.home === t ? y.hs - y.as : y.as - y.hs), 0) / g.length; };
      const p1 = phi(((mar(h) - mar(a)) / 2 + 3) / 12); // Heimvorteil ~3 Punkte, Streuung ~12
      pm = { 1: p1, 2: 1 - p1 };
    } else {
      if (!R.has(ev.lg)) R.set(ev.lg, ratings(G, now));
      const r = R.get(ev.lg);
      if (!r) continue;
      const lam = fromRatings(r, h, a, ev.sport === H ? 6 : 3.5, ev.sport === H ? 1 : 0.8);
      const o = ev.sport === H ? hockey(lam).w : oneXtwo(lam, '');
      if (!o) continue;
      const inv = keys.map((k) => 1 / (o[k].o ?? o[k])), t = inv.reduce((x, y) => x + y, 0);
      pm = Object.fromEntries(keys.map((k, i) => [k, inv[i] / t]));
    }
    const inv = keys.map((k) => 1 / w[k].o), tot = inv.reduce((x, y) => x + y, 0);
    // Gewicht des eigenen Modells: Basketball-Form ohne Gegnerstärke ist unsicherer, darum weniger
    const c = Math.min(1, n / (ev.sport === B ? 14 : 10)), wt = (ev.sport === B ? 0.25 : 0.4) * c;
    for (const [i, k] of keys.entries()) {
      const pMkt = inv[i] / tot, p = (1 - wt) * pMkt + wt * pm[k], o = w[k].o, edge = p * o - 1;
      if (edge < 0.03 || o > 4.5) continue;
      cands.push({ ev, k, mk, o, p, pMkt, pm: pm[k], edge, c, n, score: edge * c });
    }
  }
  cands.sort((x, y) => y.score - x.score);
  const picks = [], used = new Set(), day = new Date(now).toISOString().slice(0, 10);
  let budget = Math.floor(s.bal * 0.4);
  for (const x of cands) {
    if (picks.length >= 6 || used.has(x.ev.id)) continue;
    const stake = Math.min(50, budget, Math.max(5, Math.round(50 * x.c * Math.min(1, x.edge / 0.1) / 5) * 5));
    if (stake < 5) break;
    used.add(x.ev.id); budget -= stake;
    const name = x.k === '1' ? x.ev.home.n : x.k === '2' ? x.ev.away.n : 'Unentschieden';
    const pc = (v) => Math.round(v * 100);
    picks.push({
      id: `a-${day}-${x.ev.id}`, ev: x.ev.id, start: new Date(x.ev.start).toISOString(), m: x.mk, p: x.k, pick: name,
      mk: x.mk === 'ml' ? 'Sieger (inkl. Verlängerung)' : 'Spielausgang', minOdds: Math.round(x.o * 0.95 * 100) / 100, stake,
      note: `Auto-Runde. Formmodell aus ${x.n}+ Spielen pro Team: ${pc(x.pm)} %, Buchmacher ${pc(x.pMkt)} %, gemischt ${pc(x.p)} %. Quote ${x.o} ergibt ${Math.round(x.edge * 100)} % Vorteil.`,
    });
  }
  console.log(`Clauder Auto-Runde: ${cands.length} Kandidaten, ${picks.length} Tipps`);
  return picks;
}
async function botSweep() {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(BOT_FILE, 'utf8')); } catch { return; }
  if (process.env.WB_BOT_DRY) for (const p of botAuto({ bal: 500 })) console.log('  trocken:', p.pick, p.o ?? '', p.stake, p.note);
  const r = await acc.botRun(cfg, { legOf: botLeg, settle: botSettle, auto: cfg.auto === false ? null : botAuto });
  if (r) console.log(`Clauder: ${r.error || `CHF ${r.bal}, ${r.open} offen, ${r.bets} Scheine`}`);
}

let plain = { at: 0, body: '' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

// Profile: /api/acc/free, register, login, logout, profile (GET laden, PUT speichern)
const acc = accounts({ dataDir: DATA, enrich: liveBets });
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
    else if (p === 'gift' && req.method === 'POST') out = await acc.gift(token, await readBody(req, 10000));
    else if (p === 'void' && req.method === 'POST') out = await acc.voidBet(token, await readBody(req, 10000));
    else if (p === 'rescale' && req.method === 'POST') out = await acc.rescale(token, await readBody(req, 10000));
    else if (p === 'rename' && req.method === 'POST') out = await acc.rename(token, (await readBody(req, 10000)).name);
    else if (p === 'chat' && req.method === 'GET') out = await acc.chatGet(token, u.searchParams.get('since'));
    else if (p === 'chat' && req.method === 'POST') out = await acc.chatSend(token, await readBody(req, 4000));
    else if (p === 'chatdel' && req.method === 'POST') out = await acc.chatDel(token, (await readBody(req, 1000)).id);
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
  if (u.pathname === '/api/u19') { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); return void res.end(JSON.stringify(u19Over || {})); }
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
u19Sweep();
setInterval(u19Sweep, 10 * 60e3);
tsStart({ upsert, dataDir: DATA, log: (m) => console.log(m) });
(async () => {
  await loadRankings().catch(() => {});
  await probeLeagues();
  await guarded(fullSweep);
  u19Sweep(); // jetzt sind die Super-League-Spiele da: Wappen und U21-Hinweise für U19 sofort nachziehen
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
  await new Promise((r) => setTimeout(r, 2000));
  for (;;) {
    await fsSweep().catch((e) => console.log('Flashscore fehlgeschlagen:', e.message));
    await botSweep().catch((e) => console.log('Clauder fehlgeschlagen:', e.message));
    await new Promise((r) => setTimeout(r, 3 * 60e3));
  }
})();
setInterval(() => fsLive().catch(() => {}), 90e3);
