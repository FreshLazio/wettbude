// Profile mit Name und Passwort, damit man am Handy und am PC dasselbe Konto hat.
// Speicher: Upstash (dieselbe Datenbank wie Kirchenfeldl, Schlüssel mit Präfix «wb:»), wenn
// UPSTASH_REDIS_REST_URL und UPSTASH_REDIS_REST_TOKEN gesetzt sind; sonst die Datei data/users.json.
// Passwörter werden nur als scrypt-Hash mit Salz gespeichert.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { betOdds, capWin } from './public/settle.js';

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
    const recent = bets.filter((b) => b.status !== 'open' && (b.done || b.t) > Date.now() - WEEK);
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
      const r = m.get(k) || { k, n: 0, h: 0, who: new Set(), w: 0, l: 0, sp: x.sp };
      r.n++; r.who.add(x.who);
      if (x.t > now - 2 * 864e5) r.h++;
      if (x.res === 'won') r.w++; else if (x.res === 'lost') r.l++;
      m.set(k, r);
    };
    for (const b of all) for (const l of b.legs || []) {
      const x = { sp: l.sp, t: b.t, who: b.who, res: l.res };
      add(lg, l.lg, x);
      // Team: das getippte Team, sonst (Tore, Handicap …) beide Teams des Spiels
      const sides = String(l.match || '').split(' – ').filter(Boolean);
      for (const s of sides.includes(l.pick) ? [l.pick] : sides) add(tm, s, x);
    }
    const top = (m) => [...m.values()].sort((a, b) => b.n - a.n || b.h - a.h).slice(0, 10)
      .map((r) => ({ k: r.k, n: r.n, h: r.h, p: r.who.size, w: r.w, l: r.l, sp: r.sp }));

    const done = all.filter((b) => b.status === 'won' || b.status === 'lost');
    const won = done.filter((b) => b.status === 'won'), lost = done.filter((b) => b.status === 'lost');
    const max = (arr, f) => arr.reduce((m, b) => (!m || f(b) > f(m) ? b : m), null);
    const ev = [];
    // Der ganze Schein kommt mit, damit man per Klick sieht, welche Spiele es waren.
    const push = (icon, title, b, val, text) => b && ev.push({ icon, title, who: b.who, val, text, t: b.done || b.t, bet: b });
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

  return {
    remote,
    async players(token) {
      const [me] = await user(token);
      const admin = me === ADMIN;
      if (board && Date.now() - board.at < 60e3) return { list: board.list, upcoming: board.upcoming, recent: board.recent, trends: board.trends, admin };
      // Alle Profile: in Upstash per SCAN über «wb:user:*», lokal alle Schlüssel der Datei.
      const keys = [];
      if (remote) {
        let cur = '0';
        do { const [next, found] = await cmd(['SCAN', cur, 'MATCH', 'wb:user:*', 'COUNT', '200']); cur = String(next); keys.push(...found.map((x) => x.slice(3))); } while (cur !== '0' && keys.length < 5000);
      } else keys.push(...Object.keys(store()).filter((x) => x.startsWith('user:')));
      const list = [], next = [], last = [], all = [], people = [];
      const now = Date.now();
      // Nächster Anpfiff eines Scheins: frühester Start der noch offenen Tipps
      const kick = (b) => Math.min(...(b.legs || []).filter((l) => !l.res).map((l) => +l.start || Infinity), Infinity);
      for (const u of await getMany(keys)) {
        if (!u || u.moved) continue;
        const bets = Array.isArray(u.state?.bets) ? u.state.bets : [];
        // Kopien: offene Scheine und alles der letzten 7 Tage, offene mit bekannten Resultaten ausgewertet
        const mine = enrich(bets.filter((b) => b.status === 'open' || (b.done || b.t) > now - WEEK).map((b) => ({ ...structuredClone(b), who: u.name })));
        list.push(summary(u, mine));
        for (const b of mine) {
          all.push(b);
          if (b.status === 'open') next.push({ ...b, k: kick(b) });
          else if (b.status === 'won' || b.status === 'lost') last.push(b);
        }
        // Aktuelle Serie: gleiche Ergebnisse in Folge, neueste zuerst (ungültige zählen nicht)
        const settled = [...bets.filter((b) => b.status === 'won' || b.status === 'lost'), ...mine.filter((b) => b.pend && b.status !== 'void')]
          .sort((a, b) => (b.done || b.t) - (a.done || a.t));
        let n = 0;
        while (n < settled.length && settled[n].status === settled[0].status) n++;
        people.push({ name: u.name, streak: n ? { kind: settled[0].status, n } : null });
      }
      // Rangliste nach Geld (Guthaben), bei Gleichstand nach Gewinn
      list.sort((a, b) => b.bal - a.bal || b.profit - a.profit);
      // Offene Wetten aller Spieler, die nächste zuerst (höchstens 60)
      const upcoming = next.sort((a, b) => a.k - b.k || a.t - b.t).slice(0, 60).map(({ k, ...b }) => b);
      // Zuletzt abgerechnete Siege und Niederlagen aller Spieler, neueste zuerst
      const recent = last.sort((a, b) => (b.done || b.t) - (a.done || a.t)).slice(0, 40);
      const trends = trendsOf(all, people);
      board = { at: Date.now(), list, upcoming, recent, trends };
      return { list, upcoming, recent, trends, admin };
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
    async player(token, name) {
      await user(token);
      const [, u] = await resolve(keyOf(name));
      if (!u) throw err(404, 'Diesen Spieler gibt es nicht.');
      const since = Date.now() - WEEK;
      // Nur Wetten der letzten 7 Tage (abgerechnet oder noch offen), neueste zuerst.
      const bets = enrich((u.state?.bets || []).filter((b) => (b.done || b.t) > since || b.status === 'open')
        .sort((a, b) => (b.done || b.t) - (a.done || a.t)).slice(0, 200).map((b) => structuredClone(b)));
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
    async login({ name, pw }) {
      const k = keyOf(name);
      if (blocked(k)) throw err(429, 'Zu viele Versuche. Warte 10 Minuten.');
      const [rk, u] = await resolve(k);
      if (!u || !same(hash(pw || '', u.salt), u.hash)) { fail(k); throw err(403, 'Name oder Passwort stimmt nicht.'); }
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
