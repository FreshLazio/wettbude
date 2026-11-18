// Profile mit Name und Passwort, damit man am Handy und am PC dasselbe Konto hat.
// Speicher: Upstash (dieselbe Datenbank wie Kirchenfeldl, Schlüssel mit Präfix «wb:»), wenn
// UPSTASH_REDIS_REST_URL und UPSTASH_REDIS_REST_TOKEN gesetzt sind; sonst die Datei data/users.json.
// Passwörter werden nur als scrypt-Hash mit Salz gespeichert.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_STATE = 1_500_000; // Zeichen; reicht für Tausende Wetten
const ADMIN = (process.env.WB_ADMIN || 'rafael').toLowerCase(); // darf Geld verteilen

export function accounts({ dataDir }) {
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
  const summary = (u) => {
    const s = u.state || {}, bets = Array.isArray(s.bets) ? s.bets : [];
    const open = bets.filter((b) => b.status === 'open');
    const start = +s.start || 500, bal = +s.bal || 0;
    const stakeOpen = open.reduce((x, b) => x + (+b.stake || 0), 0);
    const recent = bets.filter((b) => b.status !== 'open' && (b.done || b.t) > Date.now() - WEEK);
    return {
      name: u.name, start, bal, open: open.length,
      profit: Math.round((bal + stakeOpen - start) * 100) / 100,
      won: bets.filter((b) => b.status === 'won').length, lost: bets.filter((b) => b.status === 'lost').length,
      week: Math.round(recent.reduce((x, b) => x + (b.payout || 0) - b.stake, 0) * 100) / 100,
    };
  };

  return {
    remote,
    async players(token) {
      const [me] = await user(token);
      const admin = me === ADMIN;
      if (board && Date.now() - board.at < 60e3) return { list: board.list, admin };
      // Alle Profile: in Upstash per SCAN über «wb:user:*», lokal alle Schlüssel der Datei.
      const keys = [];
      if (remote) {
        let cur = '0';
        do { const [next, found] = await cmd(['SCAN', cur, 'MATCH', 'wb:user:*', 'COUNT', '200']); cur = String(next); keys.push(...found.map((x) => x.slice(3))); } while (cur !== '0' && keys.length < 5000);
      } else keys.push(...Object.keys(store()).filter((x) => x.startsWith('user:')));
      const list = [];
      for (const k of keys) { const u = await get(k); if (u && !u.moved) list.push(summary(u)); }
      // Rangliste nach Geld (Guthaben), bei Gleichstand nach Gewinn
      list.sort((a, b) => b.bal - a.bal || b.profit - a.profit);
      board = { at: Date.now(), list };
      return { list, admin };
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
    async player(token, name) {
      await user(token);
      const [, u] = await resolve(keyOf(name));
      if (!u) throw err(404, 'Diesen Spieler gibt es nicht.');
      const since = Date.now() - WEEK;
      // Nur Wetten der letzten 7 Tage (abgerechnet oder noch offen), neueste zuerst.
      const bets = (u.state?.bets || []).filter((b) => (b.status === 'open' ? b.t : b.done || b.t) > since || b.status === 'open')
        .sort((a, b) => (b.done || b.t) - (a.done || a.t)).slice(0, 200);
      return { ...summary(u), bets };
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
        await set('user:' + k, { name: n, salt, hash: hash(pw, salt), rev: 1, state: { ...state, name: n }, at: Date.now() });
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
        u.rev++; u.state = { ...state, name: u.name }; u.at = Date.now();
        await set('user:' + k, u);
        board = null;
        return { rev: u.rev };
      });
    },
  };
}
