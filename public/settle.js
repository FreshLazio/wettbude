// Abrechnung: wird von der Oberfläche und vom Test (test-settle.mjs) benutzt.

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const overUnder = (total, leg) => (total === leg.line ? 'void' : (total > leg.line) === (leg.p === 'O') ? 'won' : 'lost');
const result = (h, a) => (h > a ? '1' : h < a ? '2' : 'X');

// Ergebnis eines einzelnen Tipps: 'won', 'lost', 'void' oder null (Spiel noch offen).
export function evalLeg(leg, ev) {
  if (ev.void) return 'void';
  if (!ev.done) return null;
  let h = ev.sh, a = ev.sa;
  const m = leg.m;
  if (m === 'ml') {
    const w = ev.win || (h > a ? '1' : a > h ? '2' : null);
    if (!w) return 'void';
    return w === leg.p ? 'won' : 'lost';
  }
  // Eishockey nach Verlängerung/Penaltyschiessen: der Sieger bekam dort genau ein Tor dazu.
  // Alle anderen Märkte zählen nach 60 Minuten, also unentschieden mit dem tieferen Wert.
  if (ev.ot && h != null && a != null) h = a = Math.min(h, a);
  if (h == null || a == null) return 'void';

  // 1. Halbzeit: braucht den Halbzeitstand, sonst ungültig.
  if (m === 'h1' || m.startsWith('h1ou')) {
    if (!ev.h1) return 'void';
    const [hh, ha] = ev.h1;
    return m === 'h1' ? (result(hh, ha) === leg.p ? 'won' : 'lost') : overUnder(hh + ha, leg);
  }
  // Torschützen: nur Tore der regulären Spielzeit, Eigentore zählen nicht.
  if (m === 'gsa' || m === 'gsf') {
    if (!ev.goals) return 'void';
    const goals = ev.goals.filter((g) => !g.og && g.m <= 90);
    const who = norm(leg.p);
    if (m === 'gsa') return goals.some((g) => norm(g.n) === who) ? 'won' : 'lost';
    return goals.length && norm(goals[0].n) === who ? 'won' : 'lost';
  }

  // Fussball nach Verlängerung oder Penaltyschiessen: nach 90 Minuten stand es unentschieden,
  // das genaue Resultat nach 90 Minuten ist aber nicht bekannt.
  const res = ev.et ? 'X' : result(h, a);
  if (m === '1x2') return res === leg.p ? 'won' : 'lost';
  if (m === 'dc') return leg.p.includes(res) ? 'won' : 'lost';
  if (m === 'dnb') return res === 'X' ? 'void' : res === leg.p ? 'won' : 'lost';
  if (ev.et) return 'void';
  if (m.startsWith('ou')) return overUnder(h + a, leg);
  if (m.startsWith('th')) return overUnder(h, leg);
  if (m.startsWith('ta')) return overUnder(a, leg);
  if (m === 'btts') return (h > 0 && a > 0) === (leg.p === 'J') ? 'won' : 'lost';
  if (m === 'cs') return `${h}:${a}` === leg.p ? 'won' : 'lost';
  if (m === 'hc') {
    const d = leg.p === '1' ? h + leg.line - a : a - leg.line - h;
    return d === 0 ? 'void' : d > 0 ? 'won' : 'lost';
  }
  return 'void';
}

// Gesamtquote eines Scheins. gf = Korrektur pro Spiel bei mehreren Tipps aus demselben Spiel
// (Wettbauer); sie gilt nur, wenn alle Tipps dieses Spiels gewonnen haben.
// Systemwette «k aus n» wie bei Interwetten: jede Auswahl von k Tipps ist eine eigene Kombi-Reihe,
// der Einsatz wird gleichmässig auf alle Reihen verteilt. Reihen mit einem falschen Tipp verlieren,
// die anderen zahlen aus. So bekommt man auch etwas, wenn nicht alles stimmt.
export function sysRows(n, k) {
  const out = [], acc = [];
  const rec = (s) => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = s; i <= n - (k - acc.length); i++) { acc.push(i); rec(i + 1); acc.pop(); }
  };
  rec(0);
  return out;
}
export const nRows = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); };

export function betOdds(bet, settled = false) {
  if (bet.sys) {
    // «Quote» = Auszahlung pro CHF Gesamteinsatz (Mittel über alle Reihen)
    const rows = sysRows(bet.legs.length, bet.sys);
    const val = (l) => (!settled ? l.o : l.res === 'won' ? l.o : l.res === 'void' ? 1 : 0);
    return rows.reduce((s, r) => s + r.reduce((p, i) => p * val(bet.legs[i]), 1), 0) / rows.length;
  }
  let odds = bet.legs.reduce((p, l) => p * (!settled || l.res === 'won' ? l.o : 1), 1);
  for (const [ev, f] of Object.entries(bet.gf || {})) {
    const legs = bet.legs.filter((l) => l.ev === ev);
    if (!settled || (legs.length > 1 && legs.every((l) => l.res === 'won'))) odds *= f;
  }
  // Kombi-Boost: der Reingewinn (Auszahlung minus Einsatz) wird um pct Prozent erhöht
  const pct = boostPct(bet, settled);
  return pct ? 1 + (odds - 1) * (1 + pct / 100) : odds;
}

// Kombi-Boost wie bet365 «ACCA Boost»: ab 3 Spielen mit Quote ab 1.30 gibt es Prozente auf den
// Gewinn, pro weiteres Spiel 5 % mehr (3 Spiele 5 %, 4 Spiele 10 % … höchstens 50 %).
// Spiele unter 1.30 zählen nicht mit, also lohnen viele Mini-Quoten nichts. Ungültige Spiele fallen weg.
export const BOOST = { minOdds: 1.3, from: 3, step: 5, max: 50 };
export function boostPct(bet, settled = false) {
  if (bet.sys || !bet.legs || bet.legs.length < 2) return 0;
  const g = gameOdds(bet, settled ? bet.legs.filter((l) => l.res !== 'void') : bet.legs);
  const n = [...g.values()].filter((o) => o >= BOOST.minOdds - 1e-9).length;
  return n >= BOOST.from ? Math.min(BOOST.max, (n - BOOST.from + 1) * BOOST.step) : 0;
}

// Frühe Abrechnung wie bei bet365 («early settlement»): Steht ein Tipp während des Spiels schon
// sicher fest, wird er sofort gewertet (Über 5.5 bei 5:2 ist gewonnen, Unter 5.5 verloren).
// Nur in Spielphasen, in denen keine Verlängerung läuft, deren Tore bei Über/Unter nicht zählen:
// Fussball 1. Halbzeit, Pause, 2. Halbzeit; Eishockey 1.–3. Drittel und Pausen.
// Basketball und American Football: die Linien gelten inklusive Verlängerung, also immer.
const SAFE = { fussball: [12, 13, 38], eishockey: [14, 15, 16, 46] };
export function evalLegEarly(leg, ev) {
  if (!ev || ev.state !== 'in' || ev.void || ev.sh == null || ev.sa == null) return null;
  const sp = ev.sport;
  if (SAFE[sp] ? !SAFE[sp].includes(ev.ph) : !['basketball', 'amfootball'].includes(sp)) return null;
  const h = +ev.sh, a = +ev.sa, m = leg.m;
  const line = leg.line ?? parseFloat(m.replace(/^[a-z]+/, ''));
  const over = (x) => (Number.isFinite(line) && x > line ? (leg.p === 'O' ? 'won' : 'lost') : null);
  if (/^ou/.test(m)) return over(h + a);
  if (/^th/.test(m)) return over(h);
  if (/^ta/.test(m)) return over(a);
  if (m === 'btts') return h > 0 && a > 0 ? (leg.p === 'J' ? 'won' : 'lost') : null;
  if (m === 'cs') { const [ch, ca] = String(leg.p).split(':').map(Number); return h > ch || a > ca ? 'lost' : null; }
  return null;
}
export const earlyText = (e) => `${e.sh}:${e.sa} · früh abgerechnet, Spiel lief noch`;

// Resultat-Text eines Tipps. Nach Verlängerung/Penaltys steht der Endstand dabei,
// z. B. «2:2 · n. P. 2:3» (Eishockey: 2:2 nach 60 Minuten, im Penaltyschiessen 2:3).
export const scoreText = (e) => (e.void ? 'abgesagt' : `${e.sh}:${e.sa}` + (/^n\. [VP]\./.test(e.txt || '') ? ` · ${e.txt}` : ''));

// Kombi-Versicherung wie bei echten Buchmachern (Betfair «Acca Edge», Betvictor u. a.):
// Ist bei einer grossen Kombi genau ein Spiel falsch, gibt es den Einsatz zurück.
// Bedingungen gegen Ausnutzen mit vielen kleinen Quoten: mindestens 5 verschiedene Spiele,
// jedes Spiel mit Quote ab 1.30, Rückzahlung höchstens CHF 50.
export const INS = { games: 5, minOdds: 1.3, max: 50 };
// Quote pro Spiel (mehrere Tipps aus demselben Spiel zusammen, mit Wettbauer-Korrektur)
function gameOdds(bet, legs = bet.legs) {
  const g = new Map();
  for (const l of legs) g.set(l.ev, (g.get(l.ev) || 1) * l.o);
  for (const [ev, f] of Object.entries(bet.gf || {})) if (g.has(ev)) g.set(ev, g.get(ev) * f);
  return g;
}
export function insured(bet) {
  if (bet.legs.length < 2 || bet.sys) return false;
  const g = gameOdds(bet);
  return g.size >= INS.games && [...g.values()].every((o) => o >= INS.minOdds - 1e-9);
}

// Höchstgewinn pro Schein wie bei echten Buchmachern: Kombis aus hohen Quoten (z. B. mehrere
// exakte Resultate à 501) ergäben sonst Millionen. Mehr als das wird nicht ausbezahlt.
export const MAX_WIN = 10000;
export const capWin = (x) => Math.min(x, MAX_WIN);

// Ergebnis eines Scheins, sobald es feststeht. Ungültige Tipps zählen mit Quote 1.
export function settleBet(bet) {
  const out = settleRaw(bet);
  return out && out.payout > MAX_WIN ? { ...out, payout: MAX_WIN, capped: true } : out;
}
function settleRaw(bet) {
  if (bet.sys) {
    const lost = bet.legs.filter((l) => l.res === 'lost').length;
    // Mehr falsche Tipps als n - k: jede Reihe enthält einen falschen, alles verloren
    if (lost > bet.legs.length - bet.sys) return { status: 'lost', payout: 0 };
    if (bet.legs.some((l) => !l.res)) return null;
    if (bet.legs.every((l) => l.res === 'void')) return { status: 'void', payout: bet.stake };
    const payout = Math.round(bet.stake * betOdds(bet, true) * 100) / 100;
    return { status: payout > 0 ? 'won' : 'lost', payout };
  }
  const lostGames = new Set(bet.legs.filter((l) => l.res === 'lost').map((l) => l.ev));
  if (lostGames.size === 1 && insured(bet)) {
    // Versichert: warten, bis alle anderen Spiele entschieden sind
    if (bet.legs.some((l) => !l.res)) return null;
    // Nach ungültigen Spielen müssen immer noch 5 Spiele zählen
    const counted = gameOdds(bet, bet.legs.filter((l) => l.res !== 'void'));
    if (counted.size >= INS.games) return { status: 'lost', payout: Math.round(Math.min(bet.stake, INS.max) * 100) / 100, ins: true };
  }
  if (lostGames.size) return { status: 'lost', payout: 0 };
  if (bet.legs.some((l) => !l.res)) return null;
  const odds = betOdds(bet, true);
  const allVoid = bet.legs.every((l) => l.res === 'void');
  return { status: allVoid ? 'void' : 'won', payout: Math.round(bet.stake * odds * 100) / 100 };
}
