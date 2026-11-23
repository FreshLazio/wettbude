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
// true = U21 spielt am selben Tag, false = U21 spielt in den 3 Tagen davor/danach an einem anderen Tag, null = unbekannt
function u21Same(club, start) {
  const key = U21[club];
  if (!key) return null;
  const re = new RegExp(`^${key}( sport)? (ii|u21|u-21)$`);
  let other = false;
  for (const e of store.values()) {
    if (e.sport !== F || e.lg === 'sui.u19' || Math.abs(e.start - start) > 3.5 * DAY || e.void) continue;
    if (![e.home?.n, e.away?.n].some((n) => re.test(plainName(n)))) continue;
    if (zDay(e.start) === zDay(start)) return true;
    other = true;
  }
  return other ? false : null;
}
// Logo der ersten Mannschaft (Super/Challenge League) für das U19-Team; einmal gefunden, gemerkt
const u19Logo = new Map();
function logoOf(club) {
  if (u19Logo.has(club)) return u19Logo.get(club);
  const key = U21[club];
  if (!key) return '';
  const re = new RegExp(`^(neuchatel )?${key}( sport)?$`);
  for (const e of store.values()) {
    if (e.sport !== F || !/^sui\.[12]$/.test(e.lg)) continue;
    for (const t of [e.home, e.away]) if (t?.l && re.test(plainName(t.n))) { u19Logo.set(club, t.l); return t.l; }
  }
  return '';
}
let u19At = 0;
function u19Sweep() {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(U19, 'utf8')); } catch { return; }
  const now = Date.now();
  const games = (doc.games || []).map((g) => ({ ...g, ts: Date.parse(g.t) })).filter((g) => Number.isFinite(g.ts));
  const R = ratings(games.filter((g) => g.ts < now).map((g) => ({ home: g.h, away: g.a, hs: g.hs, as: g.as, ts: g.ts })), now, { half: 35 * DAY, prior: 3 });
  let n = 0;
  for (const g of games) {
    const id = 'u19-' + g.t.slice(0, 10) + '-' + plainName(g.h).replace(/ /g, '') + '-' + plainName(g.a).replace(/ /g, '');
    const old = store.get(id);
    if (!old && g.ts < now - 2 * DAY) continue; // alte Spiele nur für die Ratings
    const ev = {
      id, sport: F, lg: 'sui.u19', start: g.ts, day: '', u19: true, nohalf: true,
      home: { n: g.h + ' U19', s: g.h + ' U19', l: logoOf(g.h) }, away: { n: g.a + ' U19', s: g.a + ' U19', l: logoOf(g.a) },
      state: 'pre', done: false, void: false, et: false, txt: '', sh: null, sa: null, src: {},
    };
    if (Number.isFinite(g.hs) && Number.isFinite(g.as)) Object.assign(ev, { state: 'post', done: true, txt: 'Beendet', sh: g.hs, sa: g.as });
    else if (g.off || g.ts < now - 7 * DAY) Object.assign(ev, { state: 'post', void: true, txt: 'Verschoben' });
    else if (g.ts < now) Object.assign(ev, now - g.ts < 2 * 36e5 ? { state: 'in', txt: 'läuft' } : { state: 'post', txt: 'Resultat folgt' });
    else if (R) {
      const lam = fromRatings(R, g.h, g.a, 4.5, 0.85);
      // Poisson ist bei so vielen Toren zu sicher (Saison: 78 % über 2.5, Modell sagte ~88 %): Tore Richtung 3.9 ziehen
      const tot = lam.lh + lam.la, f = (0.6 * tot + 0.4 * 3.9) / tot;
      lam.lh *= f; lam.la *= f;
      const hS = g.u21h ?? u21Same(g.h, g.ts), aS = g.u21a ?? u21Same(g.a, g.ts);
      const adj = (x) => (x === true ? 0.88 : x === false ? 1.05 : 1);
      lam.lh *= adj(hS) / Math.sqrt(adj(aS)); lam.la *= adj(aS) / Math.sqrt(adj(hS));
      // Poisson unterschätzt Unentschieden (U19 Elite diese Saison: 21 %), darum X etwas anheben
      const w0 = oneXtwo(lam, 'Modell');
      const w = w0 && (() => { const p = { 1: 1 / w0[1].o, X: 1.18 / w0.X.o, 2: 1 / w0[2].o }, s = p[1] + p.X + p[2]; return Object.fromEntries(Object.entries(p).map(([k, x]) => [k, Math.round(100 / (1.07 * x / s)) / 100])); })();
      if (w) ev.src = { mod: { w }, lam, u21: [hS, aS] };
      ev.u21 = [hS, aS];
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

function payload(need) {
  const now = Date.now();
  const events = [];
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
