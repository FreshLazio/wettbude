// Tormodell (Poisson): rechnet aus der 1X2- und Über/Unter-Linie eines Buchmachers
// die erwarteten Tore beider Teams zurück und leitet daraus weitere Tormärkte ab.
const N = 11;
const FACT = [1]; for (let i = 1; i < N + 2; i++) FACT[i] = FACT[i - 1] * i;
const pois = (k, l) => Math.exp(-l) * l ** k / FACT[k];
const r2 = (x) => Math.round(x * 100) / 100;

function grid(lh, la) {
  const g = [];
  for (let i = 0; i < N; i++) { g[i] = []; for (let j = 0; j < N; j++) g[i][j] = pois(i, lh) * pois(j, la); }
  return g;
}
function sum(g, f) { let s = 0; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (f(i, j)) s += g[i][j]; return s; }
function bisect(f, lo, hi) { for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (f(m) > 0) hi = m; else lo = m; } return (lo + hi) / 2; }

// Wahrscheinlichkeit «über Linie» bei mu erwarteten Toren; bei ganzer Linie ohne den Push-Fall.
function pOver(mu, line) {
  let under = 0, push = 0;
  for (let k = 0; k < 2 * N; k++) { const p = Math.exp(-mu) * mu ** k / fact(k); if (k < line) under += p; else if (k === line) push = p; }
  return (1 - under - push) / (1 - push);
}
function fact(k) { let f = 1; for (let i = 2; i <= k; i++) f *= i; return f; }

// w = {1, X, 2} Dezimalquoten, ou = {line, O, U} oder null -> erwartete Tore { lh, la }
export function fit(w, ou) {
  const i1 = 1 / w[1], iX = 1 / w.X, i2 = 1 / w[2], s = i1 + iX + i2;
  const d = (i1 - i2) / s;
  let mu = 2.6;
  if (ou) { const po = (1 / ou.O) / (1 / ou.O + 1 / ou.U); mu = bisect((m) => pOver(m, ou.line) - po, 0.3, 8); }
  const share = bisect((x) => { const g = grid(mu * x, mu * (1 - x)); return sum(g, (i, j) => i > j) - sum(g, (i, j) => i < j) - d; }, 0.03, 0.97);
  return { lh: mu * share, la: mu * (1 - share) };
}

// Erwartete Tore aus Tabellenwerten (für Ligen ohne Buchmacherquoten).
export function fromTable(home, away, avg = 1.3, hf = 1.12, af = 0.9, max = 3.5) {
  const rate = (t, k) => {
    const n = +t?.played || 0;
    return ((+t?.[k] || 0) + avg * 4) / (n + 4); // zum Ligaschnitt hin gedämpft
  };
  const lh = rate(home, 'gf') * rate(away, 'ga') / avg * hf;
  const la = rate(away, 'gf') * rate(home, 'ga') / avg * af;
  return { lh: Math.min(max, Math.max(0.4, lh)), la: Math.min(max, Math.max(0.35, la)) };
}

// Stärkewerte aus allen Resultaten der Saison: Angriff und Abwehr jedes Teams, gegnerbereinigt,
// neuere Spiele zählen mehr (Halbwertszeit), zum Ligaschnitt hin gedämpft. Ein Team, das gegen
// alle verliert (z. B. Arosa in der Swiss League), bekommt so tiefe Werte, und seine Gegner tiefe Quoten.
export function ratings(games, now, { half = 45 * 864e5, prior = 3 } = {}) {
  const G = games.filter((g) => Number.isFinite(g.hs) && Number.isFinite(g.as)).map((g) => ({ ...g, w: 0.5 ** (Math.max(0, now - g.ts) / half) }));
  if (G.length < 6) return null;
  let W = 0, HG = 0, AG = 0;
  for (const g of G) { W += g.w; HG += g.w * g.hs; AG += g.w * g.as; }
  const avg = (HG + AG) / (2 * W);
  const hr = Math.min(1.45, Math.max(1, (HG + 0.5) / (AG + 0.5)));
  const hm = Math.sqrt(hr), am = 1 / hm;
  const att = new Map(), def = new Map();
  for (const g of G) for (const t of [g.home, g.away]) { att.set(t, 1); def.set(t, 1); }
  for (let it = 0; it < 30; it++) {
    const na = new Map(), nd = new Map();
    for (const t of att.keys()) { na.set(t, [prior * avg, prior * avg]); nd.set(t, [prior * avg, prior * avg]); }
    for (const g of G) {
      const eh = avg * hm, ea = avg * am;
      na.get(g.home)[0] += g.w * g.hs; na.get(g.home)[1] += g.w * eh * def.get(g.away);
      na.get(g.away)[0] += g.w * g.as; na.get(g.away)[1] += g.w * ea * def.get(g.home);
      nd.get(g.home)[0] += g.w * g.as; nd.get(g.home)[1] += g.w * ea * att.get(g.away);
      nd.get(g.away)[0] += g.w * g.hs; nd.get(g.away)[1] += g.w * eh * att.get(g.home);
    }
    let mean = 0;
    for (const [t, [x, y]] of na) { att.set(t, x / y); mean += x / y; }
    mean /= att.size;
    for (const t of att.keys()) att.set(t, att.get(t) / mean);
    for (const [t, [x, y]] of nd) def.set(t, x / y);
  }
  return { att, def, avg, hm, am };
}

// k < 1 dämpft die Werte: Resultate einer halben Saison übertreiben Unterschiede, Buchmacher
// sind vorsichtiger (geeicht an echten Quoten, z. B. Arosa–Basel 9.00 / 6.00 / 1.25).
export function fromRatings(R, home, away, max = 3.5, k = 0.8) {
  const a = (t) => (R.att.get(t) ?? 0.9) ** k, d = (t) => (R.def.get(t) ?? 1.1) ** k; // Unbekannte (Aufsteiger) eher schwach
  const lh = R.avg * R.hm * a(home) * d(away), la = R.avg * R.am * a(away) * d(home);
  return { lh: Math.min(max, Math.max(0.3, lh)), la: Math.min(max, Math.max(0.25, la)) };
}

// Eishockey: aus einer 2-Weg-Quote (Sieger inkl. Verlängerung) und der Tor-Linie die erwarteten Tore zurückrechnen.
export function hockeyFit(w, ou) {
  const p = (1 / w[1]) / (1 / w[1] + 1 / w[2]);
  let mu = 6;
  if (ou) {
    const po = (1 / ou.O) / (1 / ou.O + 1 / ou.U);
    mu = bisect((m) => { const g = grid(m / 2, m / 2); return sum(g, (i, j) => i + j + (i === j ? 1 : 0) > ou.line) - po; }, 2, 10);
  }
  const share = bisect((x) => { const g = grid(mu * x, mu * (1 - x)); return sum(g, (i, j) => i > j) + 0.5 * sum(g, (i, j) => i === j) - p; }, 0.05, 0.95);
  return { lh: mu * share, la: mu * (1 - share) };
}

// Eishockey: 1X2 nach regulärer Spielzeit (60 Minuten, Unentschieden möglich) und Tor-Linien (Endstand).
export function hockey({ lh, la }) {
  const g = grid(lh, la);
  // Poisson unterschätzt Unentschieden nach 60 Minuten (Teams spielen bei Gleichstand vorsichtiger).
  const raw1 = sum(g, (i, j) => i > j), rawX = sum(g, (i, j) => i === j);
  const pX = Math.min(0.3, rawX * 1.3), p1 = raw1 * (1 - pX) / (1 - rawX);
  const out = { w: { 1: price(p1, 1.06), X: price(pX, 1.06), 2: price(1 - p1 - pX, 1.06) }, ous: [] };
  for (const L of [4.5, 5.5, 6.5]) {
    const pO = sum(g, (i, j) => i + j > L); // Tore nach 60 Minuten, wie bei Flashscore/bet365
    if (pO > 0.05 && pO < 0.95) out.ous.push({ line: L, O: price(pO, 1.07), U: price(1 - pO, 1.07) });
  }
  return out;
}

const price = (p, margin) => Math.min(101, Math.max(1.01, r2(1 / (p * margin))));
function market(probs, book, margin = 1.07, min = 0.03) {
  const vals = Object.values(probs);
  if (vals.some((p) => !(p >= min))) return null;
  return Object.fromEntries(Object.entries(probs).map(([k, p]) => [k, { o: price(p, margin), b: book }]));
}

export function oneXtwo({ lh, la }, book) {
  const g = grid(lh, la);
  return market({ 1: sum(g, (i, j) => i > j), X: sum(g, (i, j) => i === j), 2: sum(g, (i, j) => i < j) }, book, 1.07, 0.01);
}

// Alle abgeleiteten Märkte. half = false lässt die Halbzeitmärkte weg (Quelle ohne Halbzeitstand).
export function derive({ lh, la }, book, { half = true, skipOu = null } = {}) {
  const m = {};
  const g = grid(lh, la);
  const two = (key, line, pO) => { const x = market({ O: pO, U: 1 - pO }, book); if (x) m[key] = { line, ...x }; };
  for (const L of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]) if (L !== skipOu) two('ou' + L, L, sum(g, (i, j) => i + j > L));
  const bt = market({ J: sum(g, (i, j) => i > 0 && j > 0), N: sum(g, (i, j) => i === 0 || j === 0) }, book);
  if (bt) m.btts = bt;
  for (const L of [0.5, 1.5, 2.5]) { two('th' + L, L, sum(g, (i) => i > L)); two('ta' + L, L, sum(g, (i, j) => j > L)); }
  const p1 = sum(g, (i, j) => i > j), p2 = sum(g, (i, j) => i < j);
  const dnb = market({ 1: p1 / (p1 + p2), 2: p2 / (p1 + p2) }, book, 1.06);
  if (dnb) m.dnb = dnb;
  const cs = {};
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) if (g[i][j] >= 0.012) cs[`${i}:${j}`] = { o: price(g[i][j], 1.15), b: book };
  if (Object.keys(cs).length >= 4) m.cs = cs;
  if (half) {
    const h = grid(lh * 0.45, la * 0.45);
    const hr = market({ 1: sum(h, (i, j) => i > j), X: sum(h, (i, j) => i === j), 2: sum(h, (i, j) => i < j) }, book);
    if (hr) m.h1 = hr;
    for (const L of [0.5, 1.5, 2.5]) two('h1ou' + L, L, sum(h, (i, j) => i + j > L));
  }
  return m;
}
