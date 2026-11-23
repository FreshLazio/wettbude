// Profile mit Name und Passwort, damit man am Handy und am PC dasselbe Konto hat.
// Speicher: Upstash (dieselbe Datenbank wie Kirchenfeldl, Schlüssel mit Präfix «wb:»), wenn
// UPSTASH_REDIS_REST_URL und UPSTASH_REDIS_REST_TOKEN gesetzt sind; sonst die Datei data/users.json.
// Passwörter werden nur als scrypt-Hash mit Salz gespeichert.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { betOdds, capWin, playAt } from './public/settle.js';

// Quote eines Scheins inkl. Wettbauer, Kombi-Boost und Systemwette (gleiche Rechnung wie in der App)
const oddsOf = (b) => { try { return Array.isArray(b?.legs) && b.legs.length ? betOdds(b) : 1; } catch { return 1; } };
// Möglicher Gewinn eines offenen Scheins, höchstens der Höchstgewinn
const winOf = (b) => capWin((+b.stake || 0) * oddsOf(b));
const MAX_STATE = 1_500_000; // Zeichen; reicht für Tausende Wetten
const ADMIN = (process.env.WB_ADMIN || 'rafael').toLowerCase(); // darf Geld verteilen

// enrich(bets): wertet Kopien offener Scheine mit bekannten Resultaten aus (vom Server), nur für die Anzeige.
export function accounts({ dataDir, enrich = (b) => b }) {
  const URL_ = process.env.UPSTASH_REDIS_REST_URL, TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  const remote = !!(URL_ && TOKEN);
  const file = path.join(dataDir, 'users.json');
  let local = null, timer = null;

  async function cmd(args) {
    const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
  }
  const store = () => {
    if (!local) { try { local = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { local = {}; } }
    return local;
  };
  const flush = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(local)); fs.renameSync(file + '.tmp', file); } catch (e) { console.log('Profile speichern fehlgeschlagen:', e.message); }
    }, 500);
  };
  async function get(k) {
    if (remote) { const v = await cmd(['GET', 'wb:' + k]); return v ? JSON.parse(v) : null; }
    return store()[k] ?? null;
  }
  // Viele Profile auf einmal (Upstash: MGET in Paketen statt einer Anfrage pro Profil)
  async function getMany(keys) {
    if (!remote) return keys.map((k) => store()[k] ?? null);
    const out = [];
    for (let i = 0; i < keys.length; i += 100) {
      const vals = await cmd(['MGET', ...keys.slice(i, i + 100).map((k) => 'wb:' + k)]);
      for (const v of vals) { try { out.push(v ? JSON.parse(v) : null); } catch { out.push(null); } }
    }
    return out;
  }
  async function set(k, v) {
    if (remote) return cmd(['SET', 'wb:' + k, JSON.stringify(v)]);
    store()[k] = v; flush();
  }
  async function del(k) {
    if (remote) return cmd(['DEL', 'wb:' + k]);
    delete store()[k]; flush();
  }

  // Pro Profil eine Warteschlange, damit zwei Geräte sich nicht gegenseitig überschreiben.
  const locks = new Map();
  const locked = (key, fn) => {
    const run = (locks.get(key) || Promise.resolve()).then(fn, fn);
    locks.set(key, run.catch(() => {}));
    return run;
  };

  const keyOf = (name) => String(name || '').trim().toLowerCase().normalize('NFC');
  const hash = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
  const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const newToken = () => crypto.randomBytes(24).toString('base64url');

  // Gegen Durchprobieren von Passwörtern: höchstens 8 Fehlversuche pro Name in 10 Minuten.
  const fails = new Map();
  const blocked = (k) => (fails.get(k) || []).filter((t) => t > Date.now() - 10 * 6e4).length >= 8;
  const fail = (k) => fails.set(k, [...(fails.get(k) || []).filter((t) => t > Date.now() - 10 * 6e4), Date.now()]);

  const err = (status, msg) => Object.assign(new Error(msg), { status });
  const checkName = (name) => {
    const n = String(name || '').trim();
    if (n.length < 2 || n.length > 20) throw err(400, 'Der Name braucht 2 bis 20 Zeichen.');
    if (/[<>"]/.test(n)) throw err(400, 'Der Name enthält ungültige Zeichen.');
    return n;
  };
  const checkState = (s) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw err(400, 'Ungültiger Spielstand.');
    if (JSON.stringify(s).length > MAX_STATE) throw err(413, 'Spielstand zu gross.');
    return s;
  };

  // Nach einer Namensänderung zeigt der alte Name auf den neuen (bleibt reserviert,
  // damit Anmeldungen auf anderen Geräten weiter funktionieren).
  async function resolve(k) {
    let u = k && await get('user:' + k);
    for (let i = 0; u?.moved && i < 5; i++) { k = u.moved; u = await get('user:' + k); }
    return u && !u.moved ? [k, u] : [k, null];
  }

  async function user(token) {
    if (!token || typeof token !== 'string' || token.length > 64) throw err(401, 'Bitte neu anmelden.');
    const k0 = await get('tok:' + token);
    const [k, u] = await resolve(k0);
    if (!u) throw err(401, 'Bitte neu anmelden.');
    if (k !== k0) await set('tok:' + token, k);
    return [k, u];
  }

  // Rangliste aller Profile: Gewinn = Guthaben + offene Einsätze - Startbudget. 60 s zwischengespeichert.
  let board = null;
  const WEEK = 7 * 864e5;
  // live: ausgewertete Kopien. Schon entschiedene, beim Besitzer noch nicht ausbezahlte Scheine
  // (pend) zählen hier bereits mit, damit Rangliste und Podest stimmen.
  const summary = (u, live) => {
    const s = u.state || {};
    let bets = Array.isArray(s.bets) ? s.bets : [], extra = 0;
    const pend = new Map((live || []).filter((b) => b.pend).map((b) => [b.id + '|' + b.t, b]));
    if (pend.size) {
      bets = bets.map((b) => pend.get(b.id + '|' + b.t) || b);
      extra = [...pend.values()].reduce((x, b) => x + (b.payout || 0), 0);
    }
    const open = bets.filter((b) => b.status === 'open');
    const start = +s.start || 500, bal = Math.round(((+s.bal || 0) + extra) * 100) / 100;
    const stakeOpen = open.reduce((x, b) => x + (+b.stake || 0), 0);
    const recent = bets.filter((b) => b.status !== 'open' && playAt(b) > Date.now() - WEEK);
    return {
      name: u.name, start, bal, open: open.length, resets: u.resets || 0,
      // Geld in offenen Wetten und was sie höchstens auszahlen (Einsatz × Quote)
      stakeOpen: Math.round(stakeOpen * 100) / 100,
      maxWin: Math.round(open.reduce((x, b) => x + winOf(b), 0) * 100) / 100,
      profit: Math.round((bal + stakeOpen - start) * 100) / 100,
      won: bets.filter((b) => b.status === 'won').length, lost: bets.filter((b) => b.status === 'lost').length,
      week: Math.round(recent.reduce((x, b) => x + (b.payout || 0) - b.stake, 0) * 100) / 100,
    };
  };

  // Trends der letzten 7 Tage über alle Spieler: meistgewettete Ligen und Teams, spannende Ereignisse.
  function trendsOf(all, people = []) {
    const now = Date.now(), r2 = (v) => Math.round(v * 100) / 100;
    const lg = new Map(), tm = new Map();
    const add = (m, k, x) => {
      if (!k) return;
      const r = m.get(k) || { k, n: 0, h: 0, who: new Set(), w: 0, l: 0, sp: x.sp, net: 0, best: 0, bestWho: '', stake: 0, odds: 0 };
      r.n++; r.who.add(x.who); r.odds += x.o || 0;
      if (x.t > now - 2 * 864e5) r.h++;
      if (x.res === 'won') r.w++; else if (x.res === 'lost') r.l++;
      // Geld: Ein Schein wird zu gleichen Teilen auf seine Tipps verteilt (Kombi mit 4 Tipps: je ¼)
      r.net += x.net; r.stake += x.stake;
      if (x.win > r.best) { r.best = x.win; r.bestWho = x.who; }
      m.set(k, r);
    };
    for (const b of all) {
      const legs = b.legs || [], parts = legs.length || 1;
      const settled = b.status === 'won' || b.status === 'lost';
      const net = settled ? ((b.payout || 0) - b.stake) / parts : 0;
      const win = b.status === 'won' ? (b.payout || 0) - b.stake : 0;
      for (const l of legs) {
        const x = { sp: l.sp, t: b.t, who: b.who, res: l.res, o: +l.o || 0, net, stake: settled ? b.stake / parts : 0, win };
        add(lg, l.lg, x);
        // Team: das getippte Team, sonst (Tore, Handicap …) beide Teams des Spiels
        const sides = String(l.match || '').split(' – ').filter(Boolean);
        for (const s of sides.includes(l.pick) ? [l.pick] : sides) add(tm, s, x);
      }
    }
    // Ganze Tabelle (höchstens 200), sortiert nach Anzahl Tipps
    const top = (m) => [...m.values()].sort((a, b) => b.n - a.n || b.h - a.h).slice(0, 200)
      .map((r) => ({ k: r.k, n: r.n, h: r.h, p: r.who.size, w: r.w, l: r.l, sp: r.sp, net: r2(r.net), roi: r.stake ? Math.round(r.net / r.stake * 100) : null, best: r2(r.best), bestWho: r.bestWho, avg: r2(r.odds / r.n) }));

    const done = all.filter((b) => b.status === 'won' || b.status === 'lost');
    const won = done.filter((b) => b.status === 'won'), lost = done.filter((b) => b.status === 'lost');
    const max = (arr, f) => arr.reduce((m, b) => (!m || f(b) > f(m) ? b : m), null);
    const ev = [];
    // Der ganze Schein kommt mit, damit man per Klick sieht, welche Spiele es waren.
    const push = (icon, title, b, val, text) => b && ev.push({ icon, title, who: b.who, val, text, t: playAt(b), bet: b });
    const legTxt = (b) => b.legs.length > 1 ? b.legs.map((l) => l.pick).join(' + ') : `«${b.legs[0].pick}» in ${b.legs[0].match}`;
    let b = max(won, (x) => x.payout - x.stake);
    push('💰', 'Grösster Gewinn', b, b && `+CHF ${r2(b.payout - b.stake).toFixed(2)}`, b && legTxt(b));
    b = max(won, (x) => x.payout / x.stake);
    push('🎯', 'Höchste Quote getroffen', b, b && (b.payout / b.stake).toFixed(2), b && legTxt(b));
    b = max(won.filter((x) => x.legs.length > 1), (x) => x.legs.length * 100 + x.payout / x.stake);
    push('🧩', 'Grösste Kombi getroffen', b, b && `${b.legs.length} Tipps`, b && `Quote ${(b.payout / b.stake).toFixed(2)}`);
    // Bitterste Niederlage: Kombi, bei der nur ein einziger Tipp danebenging
    b = max(lost.filter((x) => x.legs.length > 2 && x.legs.filter((l) => l.res === 'lost').length === 1 && x.legs.every((l) => l.res === 'won' || l.res === 'lost')), oddsOf);
    const miss = b?.legs.find((l) => l.res === 'lost');
    push('😖', 'Bitterste Niederlage', b, b && `Quote ${oddsOf(b).toFixed(2)}`, b && `nur «${miss.pick}» falsch (${miss.match})`);
    b = max(lost.filter((x) => !x.ins), (x) => x.stake);
    push('💸', 'Grösster Verlust', b, b && `−CHF ${r2(b.stake).toFixed(2)}`, b && legTxt(b));
    const openBets = all.filter((x) => x.status === 'open');
    b = max(openBets, winOf);
    push('⏳', 'Grösster offener Schein', b, b && `bis CHF ${r2(winOf(b)).toFixed(2)}`, b && legTxt(b));
    // Spieler-Rekorde
    const per = new Map();
    for (const x of all) { const p = per.get(x.who) || { n: 0, w: 0, d: 0 }; p.n++; if (x.status === 'won') p.w++; if (x.status === 'won' || x.status === 'lost') p.d++; per.set(x.who, p); }
    const busy = [...per.entries()].sort((a, c) => c[1].n - a[1].n)[0];
    if (busy) ev.push({ icon: '🏃', title: 'Fleissigster Spieler', who: busy[0], val: `${busy[1].n} Wetten`, text: 'in den letzten 7 Tagen' });
    const sharp = [...per.entries()].filter(([, p]) => p.d >= 5).sort((a, c) => c[1].w / c[1].d - a[1].w / a[1].d)[0];
    if (sharp) ev.push({ icon: '🧠', title: 'Beste Trefferquote', who: sharp[0], val: `${Math.round(sharp[1].w / sharp[1].d * 100)} %`, text: `${sharp[1].w} von ${sharp[1].d} Wetten gewonnen` });
    // Heissestes Team: am meisten Tipps in den letzten 48 Stunden
    const hot = [...tm.values()].sort((a, c) => c.h - a.h)[0];
    if (hot?.h >= 2) ev.push({ icon: '🔥', title: 'Heissestes Team', who: hot.k, val: `${hot.h} Tipps`, text: `in den letzten 48 Stunden, von ${hot.who.size} Spieler${hot.who.size === 1 ? '' : 'n'}` });
    // Liga-Rekorde (mindestens 5 entschiedene Tipps, damit Zufall nicht zu stark zählt)
    const L = [...lg.values()].filter((r) => r.w + r.l >= 5);
    const sharpL = L.slice().sort((a, c) => c.w / (c.w + c.l) - a.w / (a.w + a.l) || (c.w + c.l) - (a.w + a.l))[0];
    if (sharpL) ev.push({ icon: '🏹', title: 'Treffsicherste Liga', who: sharpL.k, val: `${Math.round(sharpL.w / (sharpL.w + sharpL.l) * 100)} % richtig`, text: `${sharpL.w} von ${sharpL.w + sharpL.l} Tipps` });
    const richL = [...lg.values()].filter((r) => r.net > 0).sort((a, c) => c.net - a.net)[0];
    if (richL) ev.push({ icon: '🤑', title: 'Lukrativste Liga', who: richL.k, val: `+CHF ${r2(richL.net).toFixed(2)}`, text: `Gewinn aller Spieler, ${richL.n} Tipps` });
    const poorL = [...lg.values()].filter((r) => r.net < 0).sort((a, c) => a.net - c.net)[0];
    if (poorL) ev.push({ icon: '🕳️', title: 'Teuerste Liga', who: poorL.k, val: `−CHF ${r2(-poorL.net).toFixed(2)}`, text: `Verlust aller Spieler, ${poorL.n} Tipps` });
    // Mutigster Spieler: höchste durchschnittliche Quote (mindestens 3 Scheine)
    const brave = [...new Set(all.map((x) => x.who))].map((w) => { const l = all.filter((x) => x.who === w); return [w, l.length, l.reduce((s, x) => s + oddsOf(x), 0) / l.length]; })
      .filter((x) => x[1] >= 3).sort((a, c) => c[2] - a[2])[0];
    if (brave) ev.push({ icon: '🦁', title: 'Mutigster Spieler', who: brave[0], val: `Ø Quote ${brave[2].toFixed(2)}`, text: `über ${brave[1]} Scheine` });

    // Kopfzahlen der Woche: was gesetzt und ausbezahlt wurde, und wie die Spieler gegen die Bank stehen
    const stake = done.reduce((s, x) => s + x.stake, 0), paid = won.reduce((s, x) => s + (x.payout || 0), 0);
    const totals = { bets: all.length, open: openBets.length, stake: r2(stake), paid: r2(paid), net: r2(paid - stake), hit: done.length ? Math.round(won.length / done.length * 100) : null };

    // Spieler der Woche: Gewinn/Verlust der abgerechneten Scheine
    const wk = new Map();
    for (const x of done) wk.set(x.who, (wk.get(x.who) || 0) + (x.payout || 0) - x.stake);
    const week = [...wk.entries()].map(([who, net]) => ({ who, net: r2(net) })).sort((a, c) => c.net - a.net);

    // Serien: ab 2 gleichen Ergebnissen in Folge
    const streaks = people.filter((p) => p.streak?.n >= 2).map((p) => ({ who: p.name, ...p.streak })).sort((a, c) => c.n - a.n).slice(0, 8);

    // Heisse Spiele: kommende Spiele, auf die mehrere Spieler tippen. Duell = verschiedene Tipps im selben Markt.
    const games = new Map();
    for (const x of openBets) for (const l of x.legs || []) {
      if (l.res || !(l.start > now)) continue;
      const g = games.get(l.ev) || { match: l.match, start: l.start, lg: l.lg, sp: l.sp, tips: [] };
      g.tips.push({ who: x.who, pick: l.pick, mk: l.mk, m: l.m, o: l.o });
      games.set(l.ev, g);
    }
    const hotGames = [...games.values()].map((g) => {
      const who = new Set(g.tips.map((t) => t.who));
      const byM = new Map();
      for (const t of g.tips) { const s = byM.get(t.m) || new Map(); s.set(t.pick, t.who); byM.set(t.m, s); }
      const duel = [...byM.values()].some((s) => s.size > 1 && new Set(s.values()).size > 1);
      return { ...g, players: who.size, duel };
    }).filter((g) => g.players >= 2 || g.tips.length >= 3).sort((a, c) => c.duel - a.duel || c.players - a.players || a.start - c.start).slice(0, 8);

    // Verteilung nach Sportart (Anzahl Tipps)
    const sp = new Map();
    for (const x of all) for (const l of x.legs || []) sp.set(l.sp || 'andere', (sp.get(l.sp || 'andere') || 0) + 1);
    const sports = [...sp.entries()].map(([k, n]) => ({ k, n })).sort((a, c) => c.n - a.n);

    return { leagues: top(lg), teams: top(tm), events: ev, bets: all.length, totals, week, streaks, hotGames, sports };
  }

  // Wochen-Statistik: abgerechnete Scheine aller Spieler der letzten WEEKS Wochen (Wochen ab Montag, Zürcher Zeit)
  const WEEKS = 12;
  const zOff = (t) => { const d = new Date(t); return Date.parse(d.toLocaleString('en-US', { timeZone: 'Europe/Zurich' }) + ' UTC') - Math.floor(t / 1000) * 1000; };
  const weekStart = (t) => {
    const z = new Date(t + zOff(t)), day = (z.getUTCDay() + 6) % 7;
    const s = Date.UTC(z.getUTCFullYear(), z.getUTCMonth(), z.getUTCDate() - day);
    return s - zOff(s);
  };
  const weekDay = (t) => (new Date(t + zOff(t)).getUTCDay() + 6) % 7;
  function weeksOf(hist) {
    const r2 = (v) => Math.round(v * 100) / 100;
    const now = Date.now(), cur = weekStart(now);
    const starts = [];
    for (let i = WEEKS - 1; i >= 0; i--) starts.push(weekStart(cur - i * 7 * 864e5 + 12 * 36e5));
    const W = starts.map((w) => ({ w, n: 0, won: 0, lost: 0, stake: 0, paid: 0, odds: 0, kombi: 0, who: new Map(), sp: new Map(), lg: new Map(),
      days: Array.from({ length: 7 }, () => ({ n: 0, won: 0, lost: 0, stake: 0, net: 0, best: 0, bestWho: '', who: new Set() })), items: [] }));
    // Sportart/Liga: jeder Schein wird gleichmässig auf seine Tipps verteilt (wie bei den Trends)
    const tally = (m, k, extra, l, part, net, stake) => {
      const r = m.get(k) || { k, ...extra, n: 0, w: 0, l: 0, net: 0, stake: 0, odds: 0 };
      r.n++; r.net += net * part; r.stake += stake * part; r.odds += +l.o || 0;
      if (l.res === 'won') r.w++; else if (l.res === 'lost') r.l++;
      m.set(k, r);
    };
    const idx = new Map(starts.map((w, i) => [w, i]));
    const txt = (b) => (b.legs.length > 1 ? `${b.legs.length}er-Kombi` : `«${b.legs[0].pick}» · ${b.legs[0].match}`);
    const rec = (b, extra) => b && { who: b.who, o: r2(b.o), stake: r2(b.stake), net: r2((b.payout || 0) - b.stake), txt: txt(b), t: b.at, bet: b, ...extra };
    const B = [[1, 1.5], [1.5, 2], [2, 3], [3, 5], [5, 10], [10, Infinity]].map(([a, c]) => ({ a, c, n: 0, w: 0, exp: 0, net: 0 }));
    const per = new Map();
    for (const b of hist) {
      const i = idx.get(weekStart(b.at));
      if (i == null) continue;
      const x = W[i], net = (b.payout || 0) - b.stake;
      x.n++; x.stake += b.stake; x.paid += b.payout || 0; x.odds += b.o;
      if (b.status === 'won') x.won++; else x.lost++;
      if (b.legs.length > 1) x.kombi++;
      x.who.set(b.who, (x.who.get(b.who) || 0) + net);
      const d = x.days[weekDay(b.at)]; d.n++; d.net += net; d.stake += b.stake; d.who.add(b.who);
      if (b.status === 'won') { d.won++; if (b.o > d.best) { d.best = b.o; d.bestWho = b.who; } } else d.lost++;
      for (const l of b.legs) { tally(x.sp, l.sp || 'andere', {}, l, 1 / b.legs.length, net, b.stake); if (l.lg) tally(x.lg, l.lg, { sp: l.sp }, l, 1 / b.legs.length, net, b.stake); }
      x.items.push(b);
      const k = B.find((y) => b.o >= y.a && b.o < y.c) || B[0];
      k.n++; k.exp += 1 / b.o; k.net += net; if (b.status === 'won') k.w++;
      const p = per.get(b.who) || Array(WEEKS).fill(null);
      p[i] = (p[i] || 0) + net; per.set(b.who, p);
    }
    const max = (arr, f) => arr.reduce((m, b) => (!m || f(b) > f(m) ? b : m), null);
    const row = (r) => ({ k: r.k, sp: r.sp, n: r.n, w: r.w, l: r.l, net: r2(r.net), roi: r.stake ? Math.round(r.net / r.stake * 100) : null, avg: r2(r.odds / r.n) });
    const weeks = W.map((x) => {
      const won = x.items.filter((b) => b.status === 'won'), lost = x.items.filter((b) => b.status === 'lost');
      const ranked = [...x.who.entries()].sort((a, c) => c[1] - a[1]);
      return {
        w: x.w, n: x.n, won: x.won, lost: x.lost, stake: r2(x.stake), paid: r2(x.paid), net: r2(x.paid - x.stake),
        hit: x.n ? Math.round(x.won / x.n * 100) : null, avgO: x.n ? r2(x.odds / x.n) : null,
        kombi: x.n ? Math.round(x.kombi / x.n * 100) : null, players: x.who.size,
        days: x.days.map((d) => ({ n: d.n, won: d.won, lost: d.lost, stake: r2(d.stake), net: r2(d.net), best: r2(d.best), bestWho: d.bestWho, players: d.who.size })),
        sports: [...x.sp.values()].map(row).sort((a, c) => c.n - a.n),
        leagues: [...x.lg.values()].map(row).sort((a, c) => c.n - a.n || c.net - a.net).slice(0, 30),
        best: rec(max(won, (b) => b.o)), low: rec(max(lost, (b) => -b.o)), longMiss: rec(max(lost, (b) => b.o)),
        big: rec(max(won, (b) => b.payout - b.stake)), loss: rec(max(lost.filter((b) => !b.ins), (b) => b.stake)),
        top: ranked.length && ranked[0][1] > 0 ? { who: ranked[0][0], net: r2(ranked[0][1]) } : null,
        flop: ranked.length && ranked[ranked.length - 1][1] < 0 ? { who: ranked[ranked.length - 1][0], net: r2(ranked[ranked.length - 1][1]) } : null,
      };
    });
    const act = weeks.filter((x) => x.n);
    const mean = (f) => (act.length ? r2(act.reduce((s, x) => s + f(x), 0) / act.length) : null);
    const avg = { n: mean((x) => x.n), stake: mean((x) => x.stake), net: mean((x) => x.net), hit: mean((x) => x.hit), avgO: mean((x) => x.avgO), players: mean((x) => x.players), weeks: act.length };
    const buckets = B.map((k) => ({ k: k.c === Infinity ? `ab ${k.a}` : `${k.a}–${k.c}`, n: k.n, w: k.w, hit: k.n ? Math.round(k.w / k.n * 100) : null, exp: k.n ? Math.round(k.exp / k.n * 100) : null, net: r2(k.net) }));
    const matrix = [...per.entries()].map(([who, cells]) => ({ who, cells: cells.map((v) => (v == null ? null : r2(v))), sum: r2(cells.reduce((s, v) => s + (v || 0), 0)) }))
      .sort((a, c) => c.sum - a.sum).slice(0, 15);
    // Alle Wochen zusammen: beste und schlechteste Quoten
    const done = hist.filter((b) => idx.has(weekStart(b.at)));
    const won = done.filter((b) => b.status === 'won'), lost = done.filter((b) => b.status === 'lost');
    const records = {
      best: rec(max(won, (b) => b.o)), low: rec(max(lost, (b) => -b.o)),
      big: rec(max(won, (b) => b.payout - b.stake)), loss: rec(max(lost.filter((b) => !b.ins), (b) => b.stake)),
      bestWeek: max(act, (x) => x.net) && { w: max(act, (x) => x.net).w, net: max(act, (x) => x.net).net },
      worstWeek: max(act, (x) => -x.net) && { w: max(act, (x) => -x.net).w, net: max(act, (x) => -x.net).net },
    };
    return { weeks, avg, buckets, matrix, records, cur };
  }

  // Chat: die letzten 300 Nachrichten in einem Schlüssel, im Speicher gehalten (ein Server).
  // Nachricht: { id, t, n Name, x Text, q Frage, re Antwort auf id }
  let chat = null;
  const lastPost = new Map();
  const chatAll = async () => (chat ??= (await get('chat')) || []);
  const chatPost = (name, x, extra = {}) => locked('chat', async () => {
    const list = await chatAll();
    const m = { id: crypto.randomBytes(6).toString('base64url'), t: Date.now(), n: name, x, ...extra };
    list.push(m);
    if (list.length > 300) list.splice(0, list.length - 300);
    await set('chat', list);
    return m;
  });

  return {
    remote,
    chatPost,
    async chatGet(token, since) {
      await user(token);
      const list = await chatAll(), s = +since || 0;
      return { list: s ? list.filter((m) => m.t > s) : list.slice(-150), now: Date.now() };
    },
    async chatSend(token, body) {
      const [k, u] = await user(token);
      const x = String(body?.x || '').replace(/\s+$/g, '').trim();
      if (!x) throw err(400, 'Leere Nachricht.');
      if (x.length > 500) throw err(400, 'Höchstens 500 Zeichen.');
      if (Date.now() - (lastPost.get(k) || 0) < 2000) throw err(429, 'Nicht so schnell.');
      lastPost.set(k, Date.now());
      const list = await chatAll();
      const re = typeof body?.re === 'string' && list.some((m) => m.id === body.re) ? body.re : undefined;
      return chatPost(u.name, x, { ...(body?.q ? { q: true } : {}), ...(re ? { re } : {}) });
    },
    async chatDel(token, id) {
      const [k, u] = await user(token);
      return locked('chat', async () => {
        const list = await chatAll(), i = list.findIndex((m) => m.id === id);
        if (i < 0) return { ok: true };
        if (list[i].n !== u.name && k !== ADMIN) throw err(403, 'Nur eigene Nachrichten löschen.');
        list.splice(i, 1);
        await set('chat', list);
        return { ok: true, del: id };
      });
    },
    async players(token) {
      const [me] = await user(token);
      const admin = me === ADMIN;
      if (board && Date.now() - board.at < 60e3) return { list: board.list, upcoming: board.upcoming, recent: board.recent, trends: board.trends, weeks: board.weeks, onEv: board.onEv, admin };
      // Alle Profile: in Upstash per SCAN über «wb:user:*», lokal alle Schlüssel der Datei.
      const keys = [];
      if (remote) {
        let cur = '0';
        do { const [next, found] = await cmd(['SCAN', cur, 'MATCH', 'wb:user:*', 'COUNT', '200']); cur = String(next); keys.push(...found.map((x) => x.slice(3))); } while (cur !== '0' && keys.length < 5000);
      } else keys.push(...Object.keys(store()).filter((x) => x.startsWith('user:')));
      const list = [], next = [], last = [], all = [], people = [], hist = [], onEv = {};
      const now = Date.now();
      // Nächster Anpfiff eines Scheins: frühester Start der noch offenen Tipps
      const kick = (b) => Math.min(...(b.legs || []).filter((l) => !l.res).map((l) => +l.start || Infinity), Infinity);
      for (const u of await getMany(keys)) {
        if (!u || u.moved) continue;
        const bets = Array.isArray(u.state?.bets) ? u.state.bets : [];
        // Kopien: offene Scheine und alles der letzten 7 Tage, offene mit bekannten Resultaten ausgewertet
        const mine = enrich(bets.filter((b) => b.status === 'open' || playAt(b) > now - WEEK).map((b) => ({ ...structuredClone(b), who: u.name })));
        list.push(summary(u, mine));
        for (const b of mine) {
          all.push(b);
          if (b.status === 'open') next.push({ ...b, k: kick(b) });
          // Wer auf welches Spiel getippt hat (offene Tipps), für die Anzeige in der Spielliste
          if (b.status === 'open') for (const l of b.legs || []) {
            if (l.res || !l.ev) continue;
            const arr = (onEv[l.ev] ||= []);
            let x = arr.find((y) => y.n === u.name);
            if (!x) arr.push((x = { n: u.name, t: [] }));
            if (x.t.length < 4) x.t.push({ p: l.pick || l.p, o: l.o, k: (b.legs || []).length > 1 ? (b.sys ? 'System' : 'Kombi') : '' });
          }
          else if (b.status === 'won' || b.status === 'lost') last.push(b);
        }
        // Aktuelle Serie: gleiche Ergebnisse in Folge, neueste zuerst (ungültige zählen nicht)
        const settled = [...bets.filter((b) => b.status === 'won' || b.status === 'lost'), ...mine.filter((b) => b.pend && b.status !== 'void')]
          .sort((a, b) => playAt(b) - playAt(a));
        let n = 0;
        while (n < settled.length && settled[n].status === settled[0].status) n++;
        people.push({ name: u.name, streak: n ? { kind: settled[0].status, n } : null });
        // Für die Wochen-Statistik: alle abgerechneten Scheine der letzten Wochen (inkl. schon feststehender offener)
        const since = now - (WEEKS + 1) * 7 * 864e5;
        for (const b of settled) {
          const at = playAt(b);
          if (at < since || !Array.isArray(b.legs) || !b.legs.length || !(+b.stake > 0)) continue;
          hist.push({ ...(b.who ? b : { ...structuredClone(b), who: u.name }), at, o: oddsOf(b) });
        }
      }
      // Rangliste nach Geld (Guthaben), bei Gleichstand nach Gewinn
      list.sort((a, b) => b.bal - a.bal || b.profit - a.profit);
      // Offene Wetten aller Spieler, die nächste zuerst (höchstens 60)
      const upcoming = next.sort((a, b) => a.k - b.k || a.t - b.t).slice(0, 60).map(({ k, ...b }) => b);
      // Zuletzt abgerechnete Siege und Niederlagen aller Spieler, neueste zuerst
      const recent = last.sort((a, b) => playAt(b) - playAt(a)).slice(0, 40);
      const trends = trendsOf(all, people);
      const weeks = weeksOf(hist);
      board = { at: Date.now(), list, upcoming, recent, trends, weeks, onEv };
      return { list, upcoming, recent, trends, weeks, onEv, admin };
    },
    // Nur der Admin (Rafael) kann anderen Geld geben. Das Startbudget steigt mit, damit es nicht als Gewinn zählt.
    async gift(token, { name, amount }) {
      const [me] = await user(token);
      if (me !== ADMIN) throw err(403, 'Nur der Admin kann Geld verteilen.');
      const x = Math.round(+amount * 100) / 100;
      if (!Number.isFinite(x) || x <= 0 || x > 100000) throw err(400, 'Betrag zwischen 0.01 und 100 000 CHF.');
      const [tk] = await resolve(keyOf(name));
      return locked(tk, async () => {
        const u = await get('user:' + tk);
        if (!u || u.moved) throw err(404, 'Diesen Spieler gibt es nicht.');
        const s = u.state || {};
        const r = (v) => Math.round(v * 100) / 100;
        u.state = { ...s, bal: r((+s.bal || 0) + x), start: r((+s.start || 500) + x), gifts: [...(s.gifts || []), { t: Date.now(), x }] };
        u.rev++; u.at = Date.now();
        await set('user:' + tk, u);
        board = null;
        return { name: u.name, bal: u.state.bal };
      });
    },
    // Nur Admin: ein Profil auf CHF 500 Start umrechnen. Alle Einsätze und Auszahlungen werden
    // im selben Verhältnis verkleinert (Start 2000 → Faktor 0.25: CHF 500 Einsatz werden CHF 125).
    // Geschenktes Geld bleibt, wie es ist.
    async rescale(token, { name }) {
      const [me] = await user(token);
      if (me !== ADMIN) throw err(403, 'Nur der Admin kann das.');
      const [tk] = await resolve(keyOf(name));
      return locked(tk, async () => {
        const u = await get('user:' + tk);
        if (!u || u.moved) throw err(404, 'Diesen Spieler gibt es nicht.');
        const s = u.state || {}, r = (v) => Math.round(v * 100) / 100;
        const gifts = (s.gifts || []).reduce((x, g) => x + (+g.x || 0), 0);
        const base = (+s.start || 500) - gifts;
        if (base <= 0 || Math.abs(base - 500) < 0.01) throw err(400, 'Dieses Profil startet schon mit CHF 500.');
        const f = 500 / base;
        const bets = (s.bets || []).map((b) => ({ ...b, stake: r(b.stake * f), ...(b.payout != null ? { payout: r(b.payout * f) } : {}) }));
        u.state = { ...s, bets, bal: r(((+s.bal || 0) - gifts) * f + gifts), start: r(500 + gifts), rescaled: [...(s.rescaled || []), { t: Date.now(), from: base }] };
        u.rev++; u.at = Date.now();
        await set('user:' + tk, u);
        board = null;
        return { name: u.name, bal: u.state.bal, f: r(f) };
      });
    },
    // Nur Admin: einen vertippten Schein löschen. Er verschwindet ganz (niemand sieht ihn mehr),
    // der Einsatz kommt zurück. War er schon gewonnen, wird die Auszahlung abgezogen.
    async voidBet(token, { name, id, t }) {
      const [me] = await user(token);
      if (me !== ADMIN) throw err(403, 'Nur der Admin kann das.');
      const [tk] = await resolve(keyOf(name));
      return locked(tk, async () => {
        const u = await get('user:' + tk);
        if (!u || u.moved) throw err(404, 'Diesen Spieler gibt es nicht.');
        const s = u.state || {}, r = (v) => Math.round(v * 100) / 100;
        const bets = Array.isArray(s.bets) ? s.bets : [];
        const i = bets.findIndex((b) => String(b.id) === String(id) && +b.t === +t);
        if (i < 0) throw err(404, 'Diesen Schein gibt es nicht (mehr).');
        const b = bets[i];
        // Offen/verloren: Einsatz zurück. Gewonnen/ungültig/versichert: was schon ausbezahlt wurde, wieder abziehen.
        const delta = b.stake - (b.status === 'open' ? 0 : b.payout || 0);
        u.state = { ...s, bets: bets.filter((_, j) => j !== i), bal: r((+s.bal || 0) + delta) };
        u.rev++; u.at = Date.now();
        await set('user:' + tk, u);
        board = null;
        return { name: u.name, bal: u.state.bal, delta: r(delta) };
      });
    },
    async player(token, name) {
      await user(token);
      const [, u] = await resolve(keyOf(name));
      if (!u) throw err(404, 'Diesen Spieler gibt es nicht.');
      // Alle Wetten, neueste zuerst (die App zeigt den letzten Tag offen, den Rest im Archiv)
      const bets = enrich((u.state?.bets || []).slice()
        .sort((a, b) => playAt(b) - playAt(a)).slice(0, 400).map((b) => structuredClone(b)));
      const gifts = (u.state?.gifts || []).reduce((x, g) => x + (+g.x || 0), 0);
      return { ...summary(u, bets), bets, base: Math.round(((+u.state?.start || 500) - gifts) * 100) / 100 };
    },
    async free(name) {
      return { free: !(await get('user:' + keyOf(name))) };
    },
    async register({ name, pw, state }) {
      const n = checkName(name);
      if (String(pw || '').length < 4) throw err(400, 'Das Passwort braucht mindestens 4 Zeichen.');
      checkState(state);
      const k = keyOf(n);
      return locked(k, async () => {
        if (await get('user:' + k)) throw err(409, 'Diesen Namen gibt es schon. Melde dich an oder wähle einen anderen.');
        const salt = crypto.randomBytes(16).toString('hex');
        const token = newToken();
        // Alle starten mit CHF 500, egal was das Gerät schickt
        await set('user:' + k, { name: n, salt, hash: hash(pw, salt), rev: 1, state: { ...state, name: n, bal: 500, start: 500, bets: [], gifts: [] }, at: Date.now() });
        await set('tok:' + token, k);
        board = null;
        return { token, name: n, rev: 1 };
      });
    },
    // Bot-Konto (Clauder): kein Passwort, niemand kann sich anmelden. Der Server bucht die Tipps
    // aus clauder.json, sobald das Spiel Quoten hat, und rechnet die Scheine selbst ab.
    // legOf(tipp) -> fertiger Tipp mit aktueller Quote, 'gone' (Spiel vorbei/fehlt) oder null (noch warten).
    async botRun(cfg, { legOf, settle, auto }) {
      const n = checkName(cfg?.name || 'Clauder'), k = keyOf(n), MAXSTAKE = 50;
      return locked(k, async () => {
        let u = await get('user:' + k);
        if (u && !u.bot) return { error: 'Name gehört einem echten Spieler' };
        if (!u) u = { name: n, bot: true, rev: 1, state: { name: n, bal: 500, start: 500, bets: [], gifts: [], skipped: [] }, at: Date.now() };
        const s = u.state;
        s.skipped ||= [];
        let changed = !u.at || u.rev === 1;
        const fresh = [];
        const known = (id) => s.bets.some((b) => b.id === id) || s.skipped.includes(id);
        // true = erledigt (gebucht oder verworfen), false = wartet noch auf Quote
        const book = (p, id) => {
          if (known(id)) return true;
          const legs = (p.legs || [p]).map(legOf);
          if (legs.some((l) => l === 'gone')) { s.skipped.push(id); changed = true; return true; }
          if (legs.some((l) => !l)) return false;
          // pro Spiel höchstens CHF 50 (Einsätze aller Scheine auf dasselbe Spiel zusammengezählt)
          const evs = new Set(legs.map((l) => l.ev));
          const onGame = s.bets.filter((b) => b.legs.some((l) => evs.has(l.ev))).reduce((x, b) => x + b.stake, 0);
          const stake = Math.min(+p.stake || 0, MAXSTAKE - onGame, s.bal);
          if (!(stake >= 0.5)) { s.skipped.push(id); changed = true; return true; }
          s.bets.push({ id, t: Date.now(), stake: Math.round(stake * 100) / 100, legs, status: 'open', payout: 0, ...(p.note ? { note: String(p.note).slice(0, 300) } : {}) });
          fresh.push(`${legs.map((l) => `${l.pick} (${l.match}) @ ${l.o}`).join(' + ')} · CHF ${Math.round(stake)}`);
          s.bal = Math.round((s.bal - stake) * 100) / 100;
          changed = true;
          return true;
        };
        let waiting = false;
        for (const p of cfg.picks || []) if (!book(p, 'c-' + p.id)) waiting = true;
        for (const p of s.auto || []) if (!book(p, p.id)) waiting = true;
        // Abrechnen: wie beim Besitzer in der App, nur hier auf dem Server
        for (const b of s.bets) {
          if (b.status !== 'open') continue;
          const out = settle(b);
          if (!out) continue;
          Object.assign(b, { status: out.status, payout: out.payout, done: Date.now() }, out.ins ? { ins: true } : {}, out.capped ? { capped: true } : {});
          s.bal = Math.round((s.bal + out.payout) * 100) / 100;
          changed = true;
        }
        // Neue Runde: erst wenn alles getippt und abgerechnet ist, dann 1 Tag Pause
        const now = Date.now(), last = Math.max(0, ...s.bets.map((b) => b.done || b.t || 0));
        if (auto && !waiting && !s.bets.some((b) => b.status === 'open') && now - last >= 864e5 && now >= (s.nextTry || 0)) {
          const picks = auto(s) || [];
          s.auto = picks;
          s.nextTry = now + 6 * 36e5; // nichts Gutes gefunden: in 6 Stunden nochmals suchen
          for (const p of picks) book(p, p.id);
          changed = true;
        }
        if (changed) { u.rev++; u.at = Date.now(); await set('user:' + k, u); board = null; }
        // Clauder meldet neue Tipps im Chat (gesammelt, nicht als Flut)
        if (fresh.length) await chatPost(n, `🤖 Neu getippt:\n${fresh.slice(0, 12).join('\n')}${fresh.length > 12 ? `\n… und ${fresh.length - 12} weitere` : ''}`, { bot: true }).catch(() => {});
        return { name: n, bal: s.bal, open: s.bets.filter((b) => b.status === 'open').length, bets: s.bets.length };
      });
    },
    async login({ name, pw }) {
      const k = keyOf(name);
      if (blocked(k)) throw err(429, 'Zu viele Versuche. Warte 10 Minuten.');
      const [rk, u] = await resolve(k);
      if (!u || u.bot || !same(hash(pw || '', u.salt), u.hash)) { fail(k); throw err(403, 'Name oder Passwort stimmt nicht.'); }
      const token = newToken();
      await set('tok:' + token, rk);
      return { token, name: u.name, rev: u.rev, state: u.state };
    },
    async rename(token, name) {
      const n = checkName(name);
      const [k] = await user(token);
      const nk = keyOf(n);
      return locked(k, async () => {
        const u = await get('user:' + k);
        if (!u || u.moved) throw err(409, 'Bitte nochmals versuchen.');
        if (nk !== k) {
          const there = await get('user:' + nk);
          // frei, oder ein früherer eigener Name, der hierher zeigt
          if (there && there.moved !== k) throw err(409, 'Diesen Namen gibt es schon.');
        }
        u.name = n; u.rev++; u.state = { ...u.state, name: n }; u.at = Date.now();
        await set('user:' + nk, u);
        if (nk !== k) { await set('user:' + k, { moved: nk }); await set('tok:' + token, nk); }
        board = null;
        return { name: n, rev: u.rev, state: u.state };
      });
    },
    async logout(token) {
      if (token && typeof token === 'string' && token.length <= 64) await del('tok:' + token);
      return { ok: true };
    },
    async load(token, rev) {
      const [, u] = await user(token);
      return +rev === u.rev ? { rev: u.rev } : { rev: u.rev, state: u.state };
    },
    async save(token, { base, state }) {
      checkState(state);
      const [k] = await user(token);
      return locked(k, async () => {
        const u = await get('user:' + k);
        // Anderes Gerät war schneller: dessen Stand zurückgeben, nichts überschreiben.
        if (+base !== u.rev) return { conflict: true, rev: u.rev, state: u.state };
        // Verschwinden abgegebene Wetten (Konto zurückgesetzt), zählt der Server das mit.
        // Die Zahl liegt ausserhalb des Spielstands, das Gerät kann sie nicht ändern.
        const ids = (s) => (Array.isArray(s?.bets) ? s.bets : []).map((b) => b.id + '|' + b.t);
        const now = new Set(ids(state));
        const reset = ids(u.state).some((x) => !now.has(x));
        if (reset) u.resets = (u.resets || 0) + 1;
        // Startbudget nur über den Server: Neustart immer mit CHF 500, sonst bleibt der Start, wie er ist.
        // Will ein Gerät mehr Startgeld eintragen, wird das Guthaben um die Differenz gekürzt.
        const oldStart = +u.state?.start || 500, want = +state.start || 500;
        const allowed = reset ? 500 : oldStart;
        const clamp = want > allowed + 0.001;
        if (clamp) state = { ...state, start: allowed, bal: Math.round(((+state.bal || 0) - (want - allowed)) * 100) / 100 };
        if (reset) state = { ...state, gifts: [] };
        u.rev++; u.state = { ...state, name: u.name }; u.at = Date.now();
        await set('user:' + k, u);
        board = null;
        // Gekürzt: das Gerät soll den Stand vom Server übernehmen
        return clamp ? { conflict: true, rev: u.rev, state: u.state } : { rev: u.rev };
      });
    },
  };
}
