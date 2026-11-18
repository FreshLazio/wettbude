// Wettbauer: mehrere Tipps aus demselben Fussballspiel in einer Kombi.
// Die Tipps hängen zusammen (Heimsieg und über 2.5 Tore treten oft gemeinsam auf), darum
// wird nicht einfach multipliziert. Aus der 1X2- und Über/Unter-Linie des Buchmachers
// berechnet ein Poisson-Modell, wie wahrscheinlich alle Tipps zusammen eintreten, und
// korrigiert das Produkt der Quoten um diesen Zusammenhang (plus 5 % Marge wie beim Buchmacher).

const N = 11;
const FACT = [1]; for (let i = 1; i <= N; i++) FACT[i] = FACT[i - 1] * i;
const pois = (k, l) => Math.exp(-l) * l ** k / FACT[k];
const grid = (lh, la) => Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => pois(i, lh) * pois(j, la)));
const sum = (g, f) => { let s = 0; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (f(i, j)) s += g[i][j]; return s; };
const bisect = (f, lo, hi) => { for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (f(m) > 0) hi = m; else lo = m; } return (lo + hi) / 2; };
const pOver = (mu, line) => { let u = 0; for (let k = 0; k < 2 * N; k++) { if (k < line) u += Math.exp(-mu) * mu ** k / (FACT[k] ?? Infinity); } return 1 - u; };

// Erwartete Tore aus 1X2 und (falls vorhanden) Über/Unter 2.5
function lambdas(e) {
  const w = e.m?.['1x2'];
  if (!w?.[1] || !w.X || !w[2]) return null;
  const i1 = 1 / w[1].o, iX = 1 / w.X.o, i2 = 1 / w[2].o, s = i1 + iX + i2;
  const d = (i1 - i2) / s;
  const ou = e.m['ou2.5'];
  let mu = 2.6;
  if (ou?.O && ou?.U) { const po = (1 / ou.O.o) / (1 / ou.O.o + 1 / ou.U.o); mu = bisect((m) => pOver(m, 2.5) - po, 0.3, 8); }
  const share = bisect((x) => { const g = grid(mu * x, mu * (1 - x)); return sum(g, (i, j) => i > j) - sum(g, (i, j) => i < j) - d; }, 0.03, 0.97);
  return grid(mu * share, mu * (1 - share));
}

// Bedingung eines Tipps auf das Endresultat (i Heimtore, j Auswärtstore); null = nicht kombinierbar
export function cond(m, p, line) {
  const L = line ?? parseFloat(m.replace(/^[a-z]+/, ''));
  if (m === '1x2') return p === '1' ? (i, j) => i > j : p === '2' ? (i, j) => i < j : (i, j) => i === j;
  if (m === 'dc') return p === '1X' ? (i, j) => i >= j : p === 'X2' ? (i, j) => i <= j : (i, j) => i !== j;
  if (m === 'btts') return p === 'J' ? (i, j) => i > 0 && j > 0 : (i, j) => !(i > 0 && j > 0);
  if (m === 'cs') { const [h, a] = String(p).split(':').map(Number); return Number.isFinite(h) ? (i, j) => i === h && j === a : null; }
  if (/^ou\d/.test(m)) return p === 'O' ? (i, j) => i + j > L : (i, j) => i + j < L;
  if (/^th\d/.test(m)) return p === 'O' ? (i) => i > L : (i) => i < L;
  if (/^ta\d/.test(m)) return p === 'O' ? (i, j) => j > L : (i, j) => j < L;
  return null;
}
export const combinable = (e, m) => e?.sport === 'fussball' && !!cond(m, m === 'cs' ? '0:0' : 'O');

// legs: [{ m, p, line, o }] desselben Spiels. Ergebnis: { odds, f } oder { err }
export function groupOdds(e, legs) {
  const prod = legs.reduce((x, l) => x * l.o, 1);
  const fs = legs.map((l) => cond(l.m, l.p, l.line));
  if (fs.some((f) => !f)) return { err: 'Diese Tipps lassen sich nicht im gleichen Spiel kombinieren.' };
  const g = lambdas(e);
  if (!g) return { err: 'Für dieses Spiel gibt es keine Kombi im gleichen Spiel.' };
  const joint = sum(g, (i, j) => fs.every((f) => f(i, j)));
  if (joint < 0.003) return { err: 'Diese Tipps schliessen sich aus.' };
  const single = fs.reduce((x, f) => x * sum(g, f), 1);
  const odds = Math.max(1.01, Math.round(prod * single / joint * 0.95 * 100) / 100);
  return { odds, f: odds / prod };
}
