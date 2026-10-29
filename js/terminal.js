// A small read-only shell over folders you grant via the File System Access API.
// "~" is a virtual root whose children are your mounted places (desktop, mtech, …).

import * as db from './db.js';
import { esc } from './ui.js';
import { parseShortcuts } from './config.js';

const SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '$RECYCLE.BIN']);
const HIST_KEY = 'hp.thist';

let el, out, inp, promptEl;
let cfg, runPalette;
let places = [];           // [{ name, handle }]
let cwd = [];              // path from ~ : [{ name, handle }]
let lastDir = [];
let hist = [], hIdx = 0;
let placeCycle = -1;

/* ── open / close ────────────────────────────────────── */

export async function openTerm(config, execute) {
  cfg = config; runPalette = execute;
  if (!el) build();
  el.hidden = false;
  document.body.classList.add('overlay');
  places = (await db.all('places')) || [];
  if (!out.childElementCount) greet();
  renderPrompt();
  inp.focus();
}

function close() {
  el.hidden = true;
  document.body.classList.remove('overlay');
}

function build() {
  el = document.createElement('div');
  el.id = 'term';
  el.innerHTML = `
    <div class="term-bar"><span class="dots"></span><span>terminal</span><span>esc · close</span></div>
    <div id="term-out"></div>
    <div class="term-line"><span class="prompt"></span><input id="term-input" spellcheck="false" autocomplete="off"></div>`;
  document.body.append(el);
  out = el.querySelector('#term-out');
  inp = el.querySelector('#term-input');
  promptEl = el.querySelector('.prompt');
  try { hist = JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch {}
  hIdx = hist.length;

  inp.addEventListener('keydown', onKey);
  el.addEventListener('mouseup', () => { if (!getSelection().toString()) inp.focus(); });
  out.addEventListener('click', (e) => {
    const a = e.target.closest('[data-path]');
    if (!a) return;
    const p = quote(a.dataset.path);
    submit(a.dataset.kind === 'directory' ? `cd ${p}` : `open ${p}`);
  });
}

/* ── output ──────────────────────────────────────────── */

function print(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  out.append(d);
  out.scrollTop = out.scrollHeight;
}
const line = (text, cls = '') => print(cls ? `<span class="${cls}">${esc(text)}</span>` : esc(text));
const err = (text) => line(text, 't-err');

const pathStr = (p = cwd) => '~' + p.map((n) => '/' + n.name).join('');
function promptHtml() {
  return `<span class="u">${esc(cfg.user)}@${esc(cfg.host)}</span> <span class="p">${esc(pathStr())}</span> <span class="s">›</span>`;
}
const renderPrompt = () => { promptEl.innerHTML = promptHtml(); };

function entryHtml(name, kind, abs) {
  const cls = kind === 'directory' ? 't-dir' : 't-file';
  return `<span class="${cls} t-link" data-kind="${kind}" data-path="${esc(abs)}" title="${esc(abs)}">${esc(name)}${kind === 'directory' ? '/' : ''}</span>`;
}

function greet() {
  print(`<span class="t-dim">homepate shell — type</span> help <span class="t-dim">for commands. esc closes.</span>`);
  if (places.length) print(`<span class="t-dim">places:</span> ${places.map((p) => entryHtml(p.name, 'directory', '~/' + p.name)).join('  ')}`);
  else print(`<span class="t-dim">no places yet — run</span> <span class="t-ok">mount</span> <span class="t-dim">and pick a folder (Desktop, MTech, …).</span>`);
}

/* ── input handling ──────────────────────────────────── */

function onKey(e) {
  if (e.key !== 'Tab') placeCycle = -1;
  if (e.key === 'Escape') { e.preventDefault(); close(); }
  else if (e.key === 'Enter') { e.preventDefault(); submit(inp.value); }
  else if (e.key === 'Tab') { e.preventDefault(); complete(e.shiftKey); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (hIdx > 0) inp.value = hist[--hIdx]; }
  else if (e.key === 'ArrowDown') { e.preventDefault(); hIdx = Math.min(hist.length, hIdx + 1); inp.value = hist[hIdx] || ''; }
  else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); out.innerHTML = ''; }
  else if (e.key === 'c' && e.ctrlKey && !getSelection().toString()) { e.preventDefault(); print(promptHtml() + ' ' + esc(inp.value) + '<span class="t-dim">^C</span>'); inp.value = ''; }
}

async function submit(raw) {
  const text = raw.trim();
  print(promptHtml() + ' ' + esc(raw));
  inp.value = '';
  if (!text) return;
  if (hist[hist.length - 1] !== text) hist.push(text);
  hist = hist.slice(-200);
  hIdx = hist.length;
  localStorage.setItem(HIST_KEY, JSON.stringify(hist));

  const [cmd, ...args] = tokenize(text);
  try {
    if (CMDS[cmd]) await CMDS[cmd].run(args);
    else if (parseShortcuts(cfg.shortcuts).some((s) => s.key === cmd.toLowerCase()) || cmd.startsWith(':')) runPalette(text);
    else if (!args.length && (await tryResolve(cmd))?.kind === 'directory') await CMDS.cd.run([cmd]);
    else err(`${cmd}: command not found — try help`);
  } catch (ex) {
    err(String(ex?.message || ex));
  }
  renderPrompt();
}

// split on spaces, honouring "quotes" and backslash-escaped spaces
function tokenize(s) {
  const out = []; let cur = '', q = null, any = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; else cur += c; }
    else if (c === '"' || c === "'") { q = c; any = true; }
    else if (c === '\\' && s[i + 1] === ' ') { cur += ' '; i++; }
    else if (/\s/.test(c)) { if (cur || any) out.push(cur); cur = ''; any = false; }
    else cur += c;
  }
  if (cur || any) out.push(cur);
  return out;
}
const quote = (p) => p.replace(/ /g, '\\ ');

/* ── paths ───────────────────────────────────────────── */

async function ensurePerm(handle) {
  if ((await handle.queryPermission({ mode: 'read' })) === 'granted') return;
  if ((await handle.requestPermission({ mode: 'read' })) !== 'granted') throw new Error('permission denied — allow access when the browser asks');
}

async function child(dir, name) {
  try { return await dir.getDirectoryHandle(name); } catch {}
  try { return await dir.getFileHandle(name); } catch {}
  const low = name.toLowerCase();
  for await (const [n, h] of dir.entries()) if (n.toLowerCase() === low) return h;
  return null;
}

// → { path: [{name, handle}], handle (null for ~), kind }
async function resolvePath(p = '') {
  let path = [...cwd];
  if (p === '-') path = [...lastDir], p = '';
  if (p.startsWith('~') || p.startsWith('/')) { path = []; p = p.replace(/^~?\/?/, ''); }
  for (const seg of p.split(/[\\/]+/).filter(Boolean)) {
    if (seg === '.') continue;
    if (seg === '..') { path.pop(); continue; }
    const last = path[path.length - 1];
    if (!last) {
      const pl = places.find((x) => x.name.toLowerCase() === seg.toLowerCase());
      if (!pl) throw new Error(`no such place: ${seg} (places: ${places.map((x) => x.name).join(', ') || 'none — run mount'})`);
      await ensurePerm(pl.handle);
      path.push({ name: pl.name, handle: pl.handle });
      continue;
    }
    if (last.handle.kind !== 'directory') throw new Error(`not a directory: ${last.name}`);
    const h = await child(last.handle, seg);
    if (!h) throw new Error(`no such file or directory: ${seg}`);
    path.push({ name: h.name, handle: h });
  }
  if (path[0]) await ensurePerm(places.find((x) => x.name === path[0].name)?.handle || path[0].handle);
  const last = path[path.length - 1];
  return { path, handle: last?.handle || null, kind: last ? last.handle.kind : 'directory' };
}
const tryResolve = (p) => resolvePath(p).catch(() => null);

async function listDir(r) {
  if (!r.handle) return places.map((p) => ({ name: p.name, kind: 'directory', handle: p.handle }));
  const items = [];
  for await (const [name, h] of r.handle.entries()) items.push({ name, kind: h.kind, handle: h });
  return items.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.kind === 'directory' ? -1 : 1));
}

const fmtSize = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} K` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} M` : `${(n / 1073741824).toFixed(2)} G`;
const fmtDate = (t) => { const d = new Date(t); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

/* ── commands ────────────────────────────────────────── */

const CMDS = {
  help: { desc: 'this list', run() {
    const rows = Object.entries(CMDS).map(([k, v]) => `  <span class="t-ok">${k.padEnd(8)}</span><span class="t-dim">${esc(v.desc)}</span>`);
    print(rows.join('\n'));
    print(`<span class="t-dim">\n  tab completes names · tab on an empty line cycles your places\n  click a name to cd / open it · ↑↓ history · ctrl+l clear\n  shortcut keys work here too:  g cats,  y lofi,  gh repo</span>`);
  } },

  ls: { desc: 'list a folder  (ls -l for sizes & dates)', async run(args) {
    const long = args.includes('-l');
    const r = await resolvePath(args.find((a) => a !== '-l') || '');
    if (r.kind !== 'directory') return print(entryHtml(r.handle.name, 'file', pathStr(r.path)));
    const items = (await listDir(r)).filter((i) => !i.name.startsWith('.'));
    const base = pathStr(r.path);
    if (!items.length) return line('(empty)', 't-dim');
    if (!long) return print(`<div class="t-grid">${items.map((i) => entryHtml(i.name, i.kind, `${base}/${i.name}`)).join('')}</div>`);
    const rows = await Promise.all(items.slice(0, 500).map(async (i) => {
      if (i.kind === 'directory') return `<span class="t-dim">${'—'.padStart(9)}  ${''.padEnd(16)}</span>  ${entryHtml(i.name, i.kind, `${base}/${i.name}`)}`;
      const f = await i.handle.getFile();
      return `<span class="t-dim">${fmtSize(f.size).padStart(9)}  ${fmtDate(f.lastModified)}</span>  ${entryHtml(i.name, i.kind, `${base}/${i.name}`)}`;
    }));
    print(rows.join('\n'));
  } },

  cd: { desc: 'change folder  (cd, cd .., cd -, cd ~/mtech)', async run(args) {
    const r = await resolvePath(args[0] || '~');
    if (r.kind !== 'directory') throw new Error(`not a directory: ${args[0]}`);
    lastDir = cwd; cwd = r.path;
  } },

  pwd: { desc: 'print current folder', run() { line(pathStr()); } },

  cat: { desc: 'print a text file', async run(args) {
    if (!args[0]) throw new Error('usage: cat <file>');
    const r = await resolvePath(args[0]);
    if (r.kind !== 'file') throw new Error(`is a directory: ${args[0]}`);
    const f = await r.handle.getFile();
    if (f.size > 512 * 1024) throw new Error(`too large to print (${fmtSize(f.size)}) — use open`);
    const text = await f.text();
    if (text.slice(0, 2000).includes('\u0000')) throw new Error('binary file — use open');
    line(text);
  } },

  open: { desc: 'open a file in a new tab (pdf, images, text…)', async run(args) {
    if (!args[0]) throw new Error('usage: open <file>');
    const r = await resolvePath(args[0]);
    if (r.kind === 'directory') { lastDir = cwd; cwd = r.path; return CMDS.ls.run([]); }
    const f = await r.handle.getFile();
    window.open(URL.createObjectURL(f), '_blank');
    line(`opened ${f.name}`, 't-ok');
  } },

  find: { desc: 'search names below this folder  (find report, find *.pdf)', async run(args) {
    if (!args[0]) throw new Error('usage: find <name or *.glob>');
    const pat = args[0].toLowerCase();
    const re = pat.includes('*') ? new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$') : null;
    const test = (n) => (re ? re.test(n.toLowerCase()) : n.toLowerCase().includes(pat));
    const roots = cwd.length ? [{ handle: cwd[cwd.length - 1].handle, base: pathStr() }]
      : await Promise.all(places.map(async (p) => { await ensurePerm(p.handle); return { handle: p.handle, base: '~/' + p.name }; }));
    let hits = 0, seen = 0;
    line('searching…', 't-dim');
    for (const root of roots) {
      for await (const it of walk(root.handle, root.base, 8)) {
        if (++seen > 40000 || hits >= 150) break;
        if (test(it.name)) { hits++; print(entryHtml(it.path.slice(root.base.length + 1), it.kind, it.path)); }
      }
    }
    line(hits ? `${hits} match${hits > 1 ? 'es' : ''}${hits >= 150 ? ' (stopped at 150)' : ''}` : 'nothing found', 't-dim');
  } },

  tree: { desc: 'show folder tree  (tree 3)', async run(args) {
    const depth = Math.min(+args[0] || 2, 6);
    const r = await resolvePath('');
    if (!r.handle) throw new Error('cd into a place first');
    const lines = [];
    async function rec(dir, prefix, d, base) {
      const items = (await listDir({ handle: dir })).filter((i) => !i.name.startsWith('.') && !SKIP.has(i.name));
      for (let k = 0; k < items.length && lines.length < 400; k++) {
        const i = items[k], lastOne = k === items.length - 1;
        lines.push(`<span class="t-dim">${prefix}${lastOne ? '└─ ' : '├─ '}</span>${entryHtml(i.name, i.kind, `${base}/${i.name}`)}`);
        if (i.kind === 'directory' && d > 1) await rec(i.handle, prefix + (lastOne ? '   ' : '│  '), d - 1, `${base}/${i.name}`);
      }
    }
    await rec(r.handle, '', depth, pathStr());
    print(lines.join('\n') || '<span class="t-dim">(empty)</span>');
  } },

  mount: { desc: 'add a folder as a place  (mount, mount mtech)', async run(args) {
    if (!window.showDirectoryPicker) throw new Error('folder access is off in this browser. In Brave enable brave://flags/#file-system-access-api, then restart.');
    const handle = await window.showDirectoryPicker({ id: 'homepate', mode: 'read' });
    const name = (args[0] || handle.name).toLowerCase().replace(/\s+/g, '-');
    await db.set('places', name, { name, handle });
    places = await db.all('places');
    line(`mounted ${handle.name} as ~/${name}`, 't-ok');
  } },

  umount: { desc: 'remove a place  (umount mtech)', async run(args) {
    if (!places.some((p) => p.name === args[0])) throw new Error(`no such place: ${args[0] || ''}`);
    await db.del('places', args[0]);
    places = await db.all('places');
    if (cwd[0]?.name === args[0]) cwd = [];
    line(`removed ~/${args[0]}`, 't-ok');
  } },

  places: { desc: 'list mounted places', run() {
    print(places.length ? places.map((p) => entryHtml(p.name, 'directory', '~/' + p.name)).join('  ') : '<span class="t-dim">none — run mount</span>');
  } },

  history: { desc: 'recent commands', run() { line(hist.slice(-30).map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join('\n'), 't-dim'); } },
  clear: { desc: 'clear the screen', run() { out.innerHTML = ''; } },
  date: { desc: 'current date & time', run() { line(new Date().toString()); } },
  whoami: { desc: 'you', run() { line(cfg.user); } },
  echo: { desc: 'print text', run(args) { line(args.join(' ')); } },
  web: { desc: 'run a palette search  (web g transformers)', run(args) { runPalette(args.join(' ')); } },
  exit: { desc: 'close the terminal', run() { close(); } },
};

async function* walk(dir, base, depth) {
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith('.') || SKIP.has(name)) continue;
    const path = `${base}/${name}`;
    yield { name, kind: h.kind, path };
    if (h.kind === 'directory' && depth > 0) yield* walk(h, path, depth - 1);
  }
}

/* ── tab completion ──────────────────────────────────── */

async function complete(back) {
  const v = inp.value;

  // empty line (or still cycling): step through "cd <place>"
  if (!v.trim() || placeCycle >= 0) {
    if (!places.length) return line('no places yet — run mount', 't-dim');
    placeCycle = (placeCycle + (back ? -1 : 1) + places.length) % places.length;
    inp.value = `cd ${quote(places[placeCycle].name)}`;
    return;
  }

  const m = v.match(/^(.*?)((?:\\ |[^\s])*)$/);   // [before, last token]
  const before = m[1], partial = m[2].replace(/\\ /g, ' ');

  if (!before.trim()) {                              // completing the command name
    const opts = Object.keys(CMDS).filter((c) => c.startsWith(partial));
    if (opts.length === 1) inp.value = opts[0] + ' ';
    else if (opts.length) line(opts.join('  '), 't-dim');
    return;
  }

  const slash = partial.lastIndexOf('/');
  const dirPart = slash >= 0 ? partial.slice(0, slash + 1) : '';
  const base = partial.slice(slash + 1).toLowerCase();
  const r = await tryResolve(dirPart || '');
  if (!r || r.kind !== 'directory') return;
  const dirsOnly = /^cd\s/.test(before);
  const opts = (await listDir(r)).filter((i) => i.name.toLowerCase().startsWith(base) && (!dirsOnly || i.kind === 'directory') && (base.startsWith('.') || !i.name.startsWith('.')));
  if (!opts.length) return;
  if (opts.length === 1) {
    const o = opts[0];
    inp.value = before + quote(dirPart + o.name) + (o.kind === 'directory' ? '/' : ' ');
    return;
  }
  let common = opts[0].name;
  for (const o of opts) while (!o.name.toLowerCase().startsWith(common.toLowerCase())) common = common.slice(0, -1);
  if (common.length > base.length) inp.value = before + quote(dirPart + common);
  else print(`<div class="t-grid">${opts.slice(0, 120).map((o) => entryHtml(o.name, o.kind, `${pathStr(r.path)}/${o.name}`)).join('')}</div>`);
}
