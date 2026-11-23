// Dritte Quelle: TheSportsDB (Gratis-Stufe) für Ligen, die sonst niemand frei führt:
// Serie C, Serie D und europäisches Eishockey. Liefert Spielplan und Endresultate, aber keine
// Buchmacherquoten. Die Quoten werden darum aus den bisherigen Resultaten der Saison berechnet
// und in der Oberfläche als «Modellquote» angeschrieben.
// Die Gratis-Stufe ist streng gedrosselt, darum läuft alles über eine Warteschlange.
import fs from 'node:fs';
import path from 'node:path';
import { ratings, fromRatings, oneXtwo, hockey } from './model.mjs';

const T = 'https://www.thesportsdb.com/api/v1/json/123/';
const GAP = 7500;
const F = 'fussball', H = 'eishockey';

export const TS_LEAGUES = [
  [5340, 'ita.c.a', F, 'Serie C Girone A', 'Italien'],
  [5339, 'ita.c.b', F, 'Serie C Girone B', 'Italien'],
  [4398, 'ita.c.c', F, 'Serie C Girone C', 'Italien'],
  [4785, 'ita.d.i', F, 'Serie D Girone I', 'Italien'],
  [4934, 'sui.nl', H, 'National League', 'Schweiz'],
  [5163, 'sui.sl', H, 'Swiss League', 'Schweiz'],
  [4419, 'swe.shl', H, 'SHL', 'Schweden'],
  [4926, 'nor.ehl', H, 'Fjordkraft-ligaen', 'Norwegen'],
  [4920, 'rus.khl', H, 'KHL', 'Russland'],
].map(([id, slug, sport, name, land]) => ({ id, slug, sport, name, land, es: null, dead: false }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let chain = Promise.resolve();
function tsGet(ep) {
  const job = chain.then(async () => {
    for (let tries = 0; tries < 3; tries++) {
      await sleep(GAP);
      const r = await fetch(T + ep, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0 (wettbude)' } });
      if (r.status === 429) { await sleep(90000); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }
    throw new Error('HTTP 429');
  });
  chain = job.catch(() => {});
  return job;
}

const FINAL = /^(FT|AET|PEN|AOT|AP|Match Finished|Finished)$/i;

export function tsStart({ upsert, dataDir, log }) {
  const file = path.join(dataDir, 'tsdb.json');
  let cache = {};
  // Ohne eigenen Zwischenspeicher (frisch gestarteter Online-Server) mit der mitgelieferten Kopie beginnen.
  for (const f of [file, path.join(dataDir, '..', 'seed', 'tsdb.json')]) {
    try { cache = JSON.parse(fs.readFileSync(f, 'utf8')); break; } catch { /* nächste Quelle */ }
  }
  const save = () => { try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(cache)); } catch { /* nächster Versuch beim nächsten Durchgang */ } };

  async function loadRound(L, c, r) {
    const j = await tsGet(`eventsround.php?id=${L.id}&r=${r}&s=${encodeURIComponent(c.season)}`);
    const games = (j.events || []).map((e) => ({
      id: e.idEvent, ts: Date.parse((e.strTimestamp || `${e.dateEvent}T${e.strTime || '12:00:00'}`).replace(/Z?$/, 'Z')),
      home: e.strHomeTeam, away: e.strAwayTeam, hl: e.strHomeTeamBadge || '', al: e.strAwayTeamBadge || '',
      hs: e.intHomeScore == null || e.intHomeScore === '' ? null : +e.intHomeScore,
      as: e.intAwayScore == null || e.intAwayScore === '' ? null : +e.intAwayScore,
      st: e.strStatus || '', pp: e.strPostponed === 'yes',
    })).filter((g) => g.home && g.away && Number.isFinite(g.ts));
    c.rounds[r] = { complete: games.length > 0 && games.every((g) => g.hs != null || g.pp), games };
  }

  const played = (g, now) => g.hs != null && g.as != null && (FINAL.test(g.st) || g.ts < now - 4 * 36e5);

  function publish(L, c) {
    const now = Date.now();
    const hockeyLg = L.sport === H;
    const fin = Object.values(c.rounds).flatMap((rd) => rd.games).filter((g) => played(g, now));
    // Stärkewerte aus allen Resultaten (gegnerbereinigt, letzte Spiele zählen mehr).
    const R = ratings(fin, now, { half: (hockeyLg ? 30 : 45) * 864e5 });
    const fallback = { att: new Map(), def: new Map(), avg: hockeyLg ? 2.9 : 1.25, hm: hockeyLg ? 1.03 : 1.1, am: hockeyLg ? 0.97 : 0.9 };
    for (const rd of Object.values(c.rounds)) {
      for (const g of rd.games) {
        if (g.ts < now - 12 * 864e5 || g.ts > now + 10 * 864e5) continue;
        const done = played(g, now);
        const ev = {
          id: 'ts' + g.id, sport: L.sport, lg: L.slug, start: g.ts, day: '', fd: true, nohalf: true,
          home: { n: g.home, s: g.home, l: g.hl }, away: { n: g.away, s: g.away, l: g.al },
          state: done ? 'post' : g.ts > now ? 'pre' : now - g.ts < 2.5 * 36e5 ? 'in' : 'post',
          done, void: !done && (g.pp || /^(PST|CANC|ABD|Postponed|Cancelled)$/i.test(g.st)), et: false,
          txt: done ? 'Beendet' : '', sh: done ? g.hs : null, sa: done ? g.as : null, src: {},
        };
        if (hockeyLg && done) {
          ev.win = g.hs > g.as ? '1' : g.as > g.hs ? '2' : null;
          ev.ot = /^(AOT|AP|OT|SO|PEN|AET)$/i.test(g.st); // nach 60 Minuten unentschieden
        }
        if (g.ts > now) {
          const lam = fromRatings(R || fallback, g.home, g.away, hockeyLg ? 5.5 : 3.5, hockeyLg ? 1 : 0.8);
          if (hockeyLg) ev.src = { mod: hockey(lam) };
          else { const w = oneXtwo(lam, 'Modell'); if (w) ev.src = { mod: { w: { 1: w[1].o, X: w.X.o, 2: w[2].o } }, lam }; }
        }
        upsert(ev);
      }
    }
  }

  async function quick(L) {
    const c = cache[L.id] || (cache[L.id] = { rounds: {}, at: 0 });
    if (!c.season || Date.now() - c.at > 6 * 36e5) {
      const nx = (await tsGet(`eventsnextleague.php?id=${L.id}`)).events?.[0];
      if (!nx?.strSeason || !(+nx.intRound > 0)) { if (!c.season) L.dead = true; return; }
      c.season = nx.strSeason; c.round = +nx.intRound; c.at = Date.now();
    }
    for (const r of [c.round - 1, c.round, c.round + 1]) {
      if (r < 1 || (r < c.round && c.rounds[r]?.complete)) continue;
      await loadRound(L, c, r).catch(() => {});
    }
    publish(L, c);
    save();
  }

  // Frühere Spieltage für die Tabelle nachladen (einmalig, danach aus dem Zwischenspeicher).
  async function history(L) {
    const c = cache[L.id];
    if (!c?.season) return;
    const back = L.sport === H ? 14 : 40;
    let got = false;
    for (let r = c.round - 2; r >= Math.max(1, c.round - back); r--) {
      if (c.rounds[r]?.complete) continue;
      await loadRound(L, c, r).catch(() => {});
      got = true;
    }
    if (got) { publish(L, c); save(); }
  }

  async function cycle() {
    for (const L of TS_LEAGUES) if (!L.dead) await quick(L).catch((e) => log(`TheSportsDB ${L.name}: ${e.message}`));
    for (const L of TS_LEAGUES) if (!L.dead) await history(L).catch(() => {});
  }

  // Sofort anzeigen, was schon im Zwischenspeicher liegt.
  for (const L of TS_LEAGUES) if (cache[L.id]?.season) { try { publish(L, cache[L.id]); } catch { /* beschädigter Eintrag wird neu geladen */ } }
  (async () => { for (;;) { await cycle().catch(() => {}); await sleep(25 * 60e3); } })();
}
