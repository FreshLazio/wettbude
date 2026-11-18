// Zweite Quelle für Ligen, die ESPN nicht führt: football-data.co.uk
// (Spielplan mit bet365-/Pinnacle-Quoten als CSV, Resultate in einer zweiten CSV).
export const FD = 'https://www.football-data.co.uk/';
export const FD_LEAGUES = [{ country: 'Switzerland', slug: 'sui.1', file: 'SWZ' }];

function rows(csv) {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => { const c = l.split(','); const o = {}; head.forEach((h, i) => { if (h) o[h.trim()] = (c[i] ?? '').trim(); }); return o; });
}

// Die Zeiten in den CSV sind britische Ortszeit.
export function londonToUTC(dmy, hm) {
  const [d, m, y] = dmy.split('/').map(Number);
  const [hh, mm] = (hm || '12:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const shown = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(guess);
  let off = shown - hh;
  if (off > 12) off -= 24; else if (off < -12) off += 24;
  return guess - off * 36e5;
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const fdId = (L, r) => `fd-${L.slug}-${r.Date.split('/').reverse().join('')}-${norm(r.Home)}-${norm(r.Away)}`;
const odd = (v) => { const x = parseFloat(v); return Number.isFinite(x) && x > 1.005 ? Math.round(x * 100) / 100 : null; };
const three = (r, p) => { const h = odd(r[p + 'H']), d = odd(r[p + 'D']), a = odd(r[p + 'A']); return h && d && a ? { w: { 1: h, X: d, 2: a } } : null; };

export function parseFixtures(csv, L) {
  const out = [];
  for (const r of rows(csv)) {
    if (r.Country !== L.country || !r.Date || !r.Home || !r.Away) continue;
    const src = {};
    const b = three(r, 'B365'), p = three(r, 'PS');
    if (b) src.b365 = b;
    if (p) src.pin = p;
    out.push({
      id: fdId(L, r), sport: 'fussball', lg: L.slug, start: londonToUTC(r.Date, r.Time), day: '', fd: true, nohalf: true,
      home: { n: r.Home, s: r.Home, l: '' }, away: { n: r.Away, s: r.Away, l: '' },
      state: 'pre', done: false, void: false, et: false, txt: '', sh: null, sa: null, src,
    });
  }
  return out;
}

export function parseResults(csv, L) {
  const out = new Map();
  for (const r of rows(csv)) {
    if (r.Country !== L.country || !r.Date) continue;
    const h = parseInt(r.HG, 10), a = parseInt(r.AG, 10);
    if (Number.isFinite(h) && Number.isFinite(a)) out.set(fdId(L, r), { sh: h, sa: a });
  }
  return out;
}
