import { loadConfig, parseShortcuts, parseLinks } from './config.js';
import { pickable } from './quotes.js';
import { initWall, nextWall, toggleLike } from './wall.js';
import { $, esc, go, toast, applyLook } from './ui.js';
import { calc } from './calc.js';

let cfg = loadConfig();
let shortcuts = parseShortcuts(cfg.shortcuts);
let links = parseLinks(cfg.links);

/* ── clock ───────────────────────────────────────────── */

const pad = (n) => String(n).padStart(2, '0');
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

let clockTimer;
function tick() {
  const d = new Date();
  $('#time').innerHTML = `${pad(d.getHours())}<span class="sep">:</span>${pad(d.getMinutes())}`
    + (cfg.seconds ? `<span class="sec">${pad(d.getSeconds())}</span>` : '');
  $('#time').dateTime = d.toISOString();
  $('#date').innerHTML = `${DAYS[d.getDay()]}<span class="dot">·</span>${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
    + `<span class="dot">·</span><span class="meta">wk ${isoWeek(d)}</span>`;
  // wake only when the display actually changes
  const wait = cfg.seconds ? 1000 - d.getMilliseconds() : 60000 - d.getSeconds() * 1000 - d.getMilliseconds();
  clearTimeout(clockTimer);
  clockTimer = setTimeout(tick, wait + 15);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

/* ── quote (shuffle bag: no repeats until all are shown) ─ */

function showQuote() {
  const list = pickable(cfg.quotes);
  if (!list.length) return;
  // a changed filter (or edited quotes) starts a fresh bag
  const sig = `${list.length}|${list[0][0]}|${list.at(-1)[0]}`;
  let bag;
  try { bag = JSON.parse(localStorage.getItem('hp.qbag')); } catch {}
  if (!bag?.idx?.length || bag.sig !== sig) {
    const idx = [...list.keys()];
    for (let i = idx.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [idx[i], idx[j]] = [idx[j], idx[i]]; }
    bag = { sig, idx };
  }
  const [text, author] = list[bag.idx.pop()];
  localStorage.setItem('hp.qbag', JSON.stringify(bag));
  $('#quote-text').textContent = text;
  $('#quote-author').textContent = author;
  $('#quote').classList.add('ready');
}

/* ── bottom links ────────────────────────────────────── */

function renderLinks() {
  $('#links').innerHTML = links
    .map((l) => `<a href="${esc(l.url)}">${esc(l.name)}</a>`)
    .join('<span class="slash">/</span>');
}

/* ── command palette ─────────────────────────────────── */

const pal = $('#palette'), input = $('#palette-input'), list = $('#palette-list'), preview = $('#palette-preview');
const COMMANDS = [
  { key: ':next', name: 'next wallpaper', run: nextWall },
  { key: ':like', name: 'like wallpaper', run: toggleLike },
  { key: ':term', name: 'open terminal', run: () => openTerminal() },
  { key: ':settings', name: 'settings', run: () => openSettings() },
];
let items = [], sel = -1;

const URLISH = /^(https?:\/\/\S+|localhost(:\d+)?(\/\S*)?|[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?)$/i;

// Work out what Enter would do with this text.
export function resolve(raw) {
  const text = raw.trim();
  if (!text) return null;
  const cmd = COMMANDS.find((c) => c.key === text.toLowerCase());
  if (cmd) return { run: cmd.run, label: cmd.name };

  const value = calc(text.replace(/^=/, ''));
  if (value !== null) return { calc: value, label: `= ${value}` };

  const [first, ...rest] = text.split(/\s+/);
  const q = rest.join(' ');
  const sc = shortcuts.find((s) => s.key === first.toLowerCase());
  if (sc) {
    if (q && sc.search) return { url: sc.search.replace('%s', encodeURIComponent(q)), label: `${sc.name} › ${q}` };
    if (!q) return { url: sc.home, label: sc.name };
  }
  const link = links.find((l) => l.name.toLowerCase() === text.toLowerCase());
  if (link) return { url: link.url, label: link.name };
  if (URLISH.test(text)) {
    const url = /^https?:\/\//i.test(text) ? text : (text.startsWith('localhost') ? 'http://' : 'https://') + text;
    return { url, label: `open ${text}` };
  }
  const def = shortcuts.find((s) => s.key === cfg.searchKey) || shortcuts[0];
  return { url: def.search.replace('%s', encodeURIComponent(text)), label: `${def.name} › ${text}` };
}

export function execute(raw, newTab = false) {
  const r = resolve(raw);
  if (!r) return false;
  if (r.run) { closePalette(); r.run(); }
  else if (r.calc !== undefined) { navigator.clipboard?.writeText(String(r.calc)); toast(`copied ${r.calc}`); }
  else go(r.url, newTab);
  return true;
}

function suggest() {
  const text = input.value.trimStart();
  const token = text.split(/\s+/)[0].toLowerCase();
  const typingArgs = /\s/.test(text);
  if (text.startsWith(':')) items = COMMANDS.filter((c) => c.key.startsWith(token));
  else if (!token) items = shortcuts;
  else if (typingArgs) items = shortcuts.filter((s) => s.key === token);
  else items = [
    ...shortcuts.filter((s) => s.key.startsWith(token) || s.name.toLowerCase().includes(token)),
    ...links.filter((l) => l.name.toLowerCase().includes(token)).map((l) => ({ key: '↗', name: l.name, home: l.url })),
  ];
  list.innerHTML = items.slice(0, 16)
    .map((it, i) => `<li data-i="${i}" class="${i === sel ? 'sel' : ''}"><span class="k">${esc(it.key)}</span>${esc(it.name)}</li>`)
    .join('');
  const r = resolve(input.value);
  preview.innerHTML = r ? (r.calc !== undefined ? `<b>=</b> ${esc(r.calc)} <span style="opacity:.5">· enter to copy</span>` : `↵ <b>${esc(r.label)}</b>`) : '';
}

function cycle(dir) {
  if (!items.length) return;
  sel = (sel + dir + Math.min(items.length, 16)) % Math.min(items.length, 16);
  const it = items[sel];
  input.value = it.key === '↗' ? it.name : it.key.startsWith(':') ? it.key : it.key + ' ';
  suggest();
}

function openPalette() {
  pal.hidden = false;
  document.body.classList.add('overlay');
  input.value = ''; sel = -1;
  suggest();
  input.focus();
}
function closePalette() {
  pal.hidden = true;
  document.body.classList.remove('overlay');
  input.blur();
}

input.addEventListener('input', () => { sel = -1; suggest(); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  else if (e.key === 'Tab' || e.key === 'ArrowDown') { e.preventDefault(); cycle(e.shiftKey ? -1 : 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cycle(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); execute(input.value, e.ctrlKey || e.shiftKey); }
  else if (e.code === 'Backquote' && e.ctrlKey) { e.preventDefault(); closePalette(); openTerminal(); }
});
list.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const it = items[+li.dataset.i];
  if (it.run) { closePalette(); it.run(); } else go(it.home, e.ctrlKey);
});
pal.addEventListener('mousedown', (e) => { if (e.target === pal) closePalette(); });

/* ── lazily loaded panels (no cost until first use) ──── */

async function openTerminal() {
  const { openTerm } = await import('./terminal.js');
  openTerm(cfg, execute);
}
async function openSettings() {
  const { openSettingsPanel } = await import('./settings.js');
  openSettingsPanel(cfg, (next) => {          // called after save
    cfg = next;
    shortcuts = parseShortcuts(cfg.shortcuts);
    links = parseLinks(cfg.links);
    renderLinks(); tick(); applyLook(cfg.look);
  });
}
$('#open-settings').onclick = openSettings;

/* ── global keys ─────────────────────────────────────── */

const overlayOpen = () => !pal.hidden || document.querySelector('#term:not([hidden]), #settings:not([hidden])');

document.addEventListener('keydown', (e) => {
  if (overlayOpen()) return;
  const t = e.target;
  if (t.matches?.('input, textarea, select')) return;
  if ((e.code === 'Backquote' && e.ctrlKey) || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); openTerminal(); }
  else if (e.key === 'Tab' || e.key === '/') { e.preventDefault(); openPalette(); }
});

/* ── go ──────────────────────────────────────────────── */

if (!window.hpRedirecting) {   // see boot.js
  applyLook(cfg.look);
  tick();
  showQuote();
  renderLinks();
  initWall(cfg);
}
