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
export function betOdds(bet, settled = false) {
  let odds = bet.legs.reduce((p, l) => p * (!settled || l.res === 'won' ? l.o : 1), 1);
  for (const [ev, f] of Object.entries(bet.gf || {})) {
    const legs = bet.legs.filter((l) => l.ev === ev);
    if (!settled || (legs.length > 1 && legs.every((l) => l.res === 'won'))) odds *= f;
  }
  return odds;
}

// Ergebnis eines Scheins, sobald es feststeht. Ungültige Tipps zählen mit Quote 1.
export function settleBet(bet) {
  if (bet.legs.some((l) => l.res === 'lost')) return { status: 'lost', payout: 0 };
  if (bet.legs.some((l) => !l.res)) return null;
  const odds = betOdds(bet, true);
  const allVoid = bet.legs.every((l) => l.res === 'void');
  return { status: allVoid ? 'void' : 'won', payout: Math.round(bet.stake * odds * 100) / 100 };
}
