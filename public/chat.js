// Chat für alle Spieler: Nachrichten, Fragen (❓) und Antworten. Eigenständig, liest das Profil aus localStorage.
const LS = 'wettbude.v1', SEEN = 'wettbude.chatSeen';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const me = () => { try { const s = JSON.parse(localStorage.getItem(LS) || '{}'); return { tok: s.tok, name: s.name }; } catch { return {}; } };
const C = { open: false, list: [], re: null, q: false, only: false, admin: false, busy: false, err: '' };

const fab = document.createElement('button');
fab.id = 'chatFab'; fab.title = 'Chat'; fab.innerHTML = '💬<b></b>';
const box = document.createElement('section');
box.id = 'chat'; box.hidden = true;
document.body.append(fab, box);

const seen = () => +localStorage.getItem(SEEN) || 0;
const time = (t) => {
  const d = new Date(t), today = new Date().toDateString() === d.toDateString();
  return (today ? '' : d.toLocaleDateString('de-CH', { day: 'numeric', month: 'numeric' }) + ' ') + d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
};
// Links klickbar, Zeilenumbrüche behalten
const fmt = (x) => esc(x).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`).replace(/\n/g, '<br>');

function badge() {
  const { name } = me(), n = C.list.filter((m) => m.t > seen() && m.n !== name).length;
  fab.querySelector('b').textContent = n ? (n > 9 ? '9+' : n) : '';
  fab.hidden = !me().tok;
}

function render() {
  const { name, tok } = me();
  if (!tok) { box.innerHTML = '<header><b>Chat</b><button data-c="close">×</button></header><p class="cEmpty">Melde dich mit einem Profil an, um mitzuschreiben.</p>'; return; }
  const byId = new Map(C.list.map((m) => [m.id, m]));
  const answers = (id) => C.list.filter((m) => m.re === id).length;
  const shown = C.only ? C.list.filter((m) => m.q || (m.re && byId.get(m.re)?.q)) : C.list;
  const reTo = C.re && byId.get(C.re);
  const msgs = shown.map((m) => {
    const mine = m.n === name, parent = m.re && byId.get(m.re);
    return `<div class="cMsg${mine ? ' mine' : ''}${m.q ? ' q' : ''}${m.bot ? ' bot' : ''}" data-id="${esc(m.id)}">
      <div class="cHead"><b>${esc(m.n)}</b><span>${time(m.t)}</span>${m.q ? '<em>Frage</em>' : ''}</div>
      ${parent ? `<div class="cQuote">↪ <b>${esc(parent.n)}</b>: ${esc(parent.x.slice(0, 80))}${parent.x.length > 80 ? '…' : ''}</div>` : ''}
      <div class="cText">${fmt(m.x)}</div>
      <div class="cAct"><button data-c="re" data-id="${esc(m.id)}">Antworten${m.q && answers(m.id) ? ` (${answers(m.id)})` : ''}</button>${mine || C.admin ? `<button data-c="del" data-id="${esc(m.id)}">Löschen</button>` : ''}</div>
    </div>`;
  }).join('');
  box.innerHTML = `<header><b>Chat</b><label class="cOnly"><input type="checkbox" data-c="only"${C.only ? ' checked' : ''}> nur Fragen</label><button data-c="close" title="Schliessen">×</button></header>
    <div class="cList">${msgs || '<p class="cEmpty">Noch keine Nachrichten. Schreib die erste!</p>'}</div>
    ${reTo ? `<div class="cRe">Antwort an <b>${esc(reTo.n)}</b>: ${esc(reTo.x.slice(0, 60))} <button data-c="unre">×</button></div>` : ''}
    ${C.err ? `<p class="cErr">${esc(C.err)}</p>` : ''}
    <form class="cForm"><button type="button" class="cQ${C.q ? ' on' : ''}" data-c="q" title="Als Frage markieren">❓</button>
      <textarea maxlength="500" rows="1" placeholder="${C.q ? 'Frage an alle …' : 'Nachricht …'}"></textarea><button class="cSend" ${C.busy ? 'disabled' : ''}>Senden</button></form>`;
  const L = box.querySelector('.cList');
  L.scrollTop = L.scrollHeight;
}

async function load() {
  const { tok } = me();
  if (!tok) { C.list = []; badge(); return; }
  try {
    const r = await fetch('/api/acc/chat', { headers: { 'x-token': tok } });
    if (!r.ok) return;
    const j = await r.json(), before = C.list.at(-1)?.id, n = C.list.length;
    C.list = j.list || [];
    if (C.open) {
      localStorage.setItem(SEEN, String(Date.now()));
      // nur neu zeichnen, wenn sich etwas geändert hat (sonst geht der Text im Eingabefeld verloren)
      if (C.list.at(-1)?.id !== before || C.list.length !== n) keepInput(render);
    }
    badge();
  } catch { /* offline: später nochmals */ }
}
function keepInput(fn) {
  const t = box.querySelector('textarea'), v = t?.value || '', f = document.activeElement === t;
  fn();
  const n = box.querySelector('textarea');
  if (n) { n.value = v; if (f) n.focus(); }
}

async function send(x) {
  const { tok } = me();
  C.busy = true; C.err = '';
  try {
    const r = await fetch('/api/acc/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': tok }, body: JSON.stringify({ x, q: C.q, re: C.re }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Nicht gesendet');
    C.list.push(j); C.re = null; C.q = false;
    localStorage.setItem(SEEN, String(Date.now()));
    C.busy = false; render();
    box.querySelector('textarea')?.focus();
  } catch (e) { C.busy = false; C.err = e.message; keepInput(render); }
}

fab.addEventListener('click', () => {
  C.open = !C.open; box.hidden = !C.open; fab.classList.toggle('on', C.open);
  if (C.open) { localStorage.setItem(SEEN, String(Date.now())); render(); badge(); load(); box.querySelector('textarea')?.focus(); }
});
box.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-c]');
  if (!b) return;
  const c = b.dataset.c;
  if (c === 'close') { C.open = false; box.hidden = true; fab.classList.remove('on'); }
  else if (c === 're') { C.re = b.dataset.id; keepInput(render); box.querySelector('textarea').focus(); }
  else if (c === 'unre') { C.re = null; keepInput(render); }
  else if (c === 'q') { C.q = !C.q; keepInput(render); box.querySelector('textarea').focus(); }
  else if (c === 'only') { C.only = b.checked; keepInput(render); }
  else if (c === 'del') {
    if (!confirm('Nachricht löschen?')) return;
    const r = await fetch('/api/acc/chatdel', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': me().tok }, body: JSON.stringify({ id: b.dataset.id }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { C.list = C.list.filter((m) => m.id !== b.dataset.id); keepInput(render); } else { C.err = j.error || 'Nicht gelöscht'; keepInput(render); }
  }
});
box.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const t = box.querySelector('textarea'), x = t.value.trim();
  if (x && !C.busy) send(x);
});
box.addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'TEXTAREA' && ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); box.querySelector('form').requestSubmit(); }
});
box.addEventListener('input', (ev) => { if (ev.target.tagName === 'TEXTAREA') { ev.target.style.height = 'auto'; ev.target.style.height = Math.min(120, ev.target.scrollHeight) + 'px'; } });

// Admin sehen: aus der Spieler-Liste (falls angemeldet)
(async () => { const { tok } = me(); if (!tok) return; try { const r = await fetch('/api/acc/players', { headers: { 'x-token': tok } }); if (r.ok) C.admin = !!(await r.json()).admin; } catch { /* egal */ } })();

load();
// offen: alle 8 s, zu: jede Minute (für die Zahl neuer Nachrichten am Knopf)
let tick = 0;
setInterval(() => { tick++; if (document.visibilityState === 'visible' && (C.open || tick % 8 === 0)) load(); }, 8000);
// An- oder Abmelden in der App: Knopf ein-/ausblenden
window.addEventListener('storage', badge);
setInterval(badge, 3000);
