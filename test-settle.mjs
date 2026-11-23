import assert from 'node:assert/strict';
import { evalLeg, settleBet } from './public/settle.js';

const ev = (sh, sa, x = {}) => ({ done: true, void: false, et: false, sh, sa, ...x });
const leg = (m, p, line) => ({ m, p, line, o: 2 });

assert.equal(evalLeg(leg('1x2', '1'), ev(2, 1)), 'won');
assert.equal(evalLeg(leg('1x2', 'X'), ev(2, 1)), 'lost');
assert.equal(evalLeg(leg('1x2', 'X'), ev(1, 1)), 'won');
assert.equal(evalLeg(leg('1x2', '1'), ev(3, 2, { et: true })), 'lost');
assert.equal(evalLeg(leg('1x2', 'X'), ev(3, 2, { et: true })), 'won');
assert.equal(evalLeg(leg('dc', '1X'), ev(0, 0)), 'won');
assert.equal(evalLeg(leg('dc', '12'), ev(0, 0)), 'lost');
assert.equal(evalLeg(leg('dc', 'X2'), ev(0, 1)), 'won');
assert.equal(evalLeg(leg('ou', 'O', 2.5), ev(2, 1)), 'won');
assert.equal(evalLeg(leg('ou', 'U', 2.5), ev(2, 1)), 'lost');
assert.equal(evalLeg(leg('ou', 'O', 3), ev(2, 1)), 'void');
assert.equal(evalLeg(leg('ou', 'O', 2.5), ev(2, 2, { et: true })), 'void');
assert.equal(evalLeg(leg('hc', '1', -1.5), ev(2, 1)), 'lost');
assert.equal(evalLeg(leg('hc', '2', -1.5), ev(2, 1)), 'won');
assert.equal(evalLeg(leg('hc', '1', -8.5), ev(120, 110)), 'won');
assert.equal(evalLeg(leg('hc', '1', -1), ev(2, 1)), 'void');
assert.equal(evalLeg(leg('ml', '2'), ev(110, 120)), 'won');
assert.equal(evalLeg(leg('ml', '1'), ev(1, 2, { win: '1' })), 'won');
assert.equal(evalLeg(leg('1x2', '1'), ev(0, 0, { done: false })), null);
assert.equal(evalLeg(leg('1x2', '1'), { void: true, done: false }), 'void');

// neue Märkte
const g = (m, t, n, og = false) => ({ m, t, n, og });
const full = ev(2, 1, { h1: [1, 0], goals: [g(12, '1', 'Luca Müller'), g(60, '2', 'Eigen Tor', true), g(88, '1', 'Ana Pérez')] });
assert.equal(evalLeg(leg('ou2.5', 'O', 2.5), full), 'won');
assert.equal(evalLeg(leg('ou3.5', 'O', 3.5), full), 'lost');
assert.equal(evalLeg(leg('h1', '1'), full), 'won');
assert.equal(evalLeg(leg('h1', 'X'), full), 'lost');
assert.equal(evalLeg(leg('h1ou0.5', 'O', 0.5), full), 'won');
assert.equal(evalLeg(leg('h1ou1.5', 'O', 1.5), full), 'lost');
assert.equal(evalLeg(leg('h1', '1'), ev(2, 1)), 'void');
assert.equal(evalLeg(leg('btts', 'J'), full), 'won');
assert.equal(evalLeg(leg('btts', 'N'), ev(2, 0)), 'won');
assert.equal(evalLeg(leg('th1.5', 'O', 1.5), full), 'won');
assert.equal(evalLeg(leg('ta0.5', 'U', 0.5), full), 'lost');
assert.equal(evalLeg(leg('cs', '2:1'), full), 'won');
assert.equal(evalLeg(leg('cs', '1:2'), full), 'lost');
assert.equal(evalLeg(leg('dnb', '1'), full), 'won');
assert.equal(evalLeg(leg('dnb', '1'), ev(1, 1)), 'void');
assert.equal(evalLeg(leg('gsa', 'Ana Perez'), full), 'won');
assert.equal(evalLeg(leg('gsa', 'Eigen Tor'), full), 'lost');
assert.equal(evalLeg(leg('gsf', 'Luca Müller'), full), 'won');
assert.equal(evalLeg(leg('gsf', 'Ana Pérez'), full), 'lost');
assert.equal(evalLeg(leg('gsa', 'Ana Pérez'), ev(2, 1)), 'void');
assert.equal(evalLeg(leg('ou', 'O', 210.5), ev(110, 105)), 'won');

// Eishockey: 3:2 nach Verlängerung -> nach 60 Minuten 2:2. 1X2 unentschieden, Sieger-Markt Heimteam.
const ice = { done: true, sh: 3, sa: 2, ot: true, win: '1' };
assert.equal(evalLeg({ m: '1x2', p: 'X' }, ice), 'won');
assert.equal(evalLeg({ m: '1x2', p: '1' }, ice), 'lost');
assert.equal(evalLeg({ m: 'ml', p: '1' }, ice), 'won');
assert.equal(evalLeg({ m: 'ou4.5', p: 'U', line: 4.5 }, ice), 'won');
assert.equal(evalLeg({ m: 'hc', p: '2', line: -1.5 }, ice), 'won');
assert.equal(evalLeg({ m: '1x2', p: '1' }, { ...ice, ot: false }), 'won');

const bet = (stake, ...legs) => ({ stake, legs: legs.map(([o, res]) => ({ o, res })) });
assert.deepEqual(settleBet(bet(10, [2, 'won'], [1.5, 'won'])), { status: 'won', payout: 30 });
assert.deepEqual(settleBet(bet(10, [2, 'won'], [1.5, 'void'])), { status: 'won', payout: 20 });
assert.deepEqual(settleBet(bet(10, [2, 'lost'], [1.5, null])), { status: 'lost', payout: 0 });
assert.equal(settleBet(bet(10, [2, 'won'], [1.5, null])), null);
assert.deepEqual(settleBet(bet(10, [2, 'void'])), { status: 'void', payout: 10 });
console.log('settle.js: alle Prüfungen bestanden');
