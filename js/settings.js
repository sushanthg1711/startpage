import { DEFAULTS, saveConfig, loadConfig } from './config.js';
import { flushQueue, listLiked, removeLiked, nextWall } from './wall.js';
import * as db from './db.js';
import { esc, toast, applyLook } from './ui.js';
import { TOPICS, pickable } from './quotes.js';

let el, cfg, onSave, saveTimer, wallDirty = false;

export function openSettingsPanel(config, onSaved) {
  cfg = structuredClone(config);
  onSave = onSaved;
  el?.remove();
  el = document.createElement('aside');
  el.id = 'settings';
  el.tabIndex = -1;          // clicks inside keep focus here, so Esc always works
  el.innerHTML = template();
  document.body.append(el);
  document.body.classList.add('overlay', 'settings-open');
  bind();
  renderPlaces();
  renderLiked();
  countQuotes();
  el.querySelector('textarea, input').focus();
}

function close() {
  flush();
  el.remove();
  el = null;
  document.body.classList.remove('overlay', 'settings-open');
}

const W = () => cfg.wall;
const L = () => cfg.look;

function template() {
  const opt = (v, cur, label = v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  return `
  <div class="head"><h2>settings</h2><button class="btn" data-act="close">close · esc</button></div>
  <p class="note">changes save as you type.</p>

  <h3>general</h3>
  <div class="row"><label>name</label><input type="text" data-k="user" value="${esc(cfg.user)}"></div>
  <div class="row"><label>host</label><input type="text" data-k="host" value="${esc(cfg.host)}"></div>
  <div class="row"><label>default search key</label><input type="text" data-k="searchKey" value="${esc(cfg.searchKey)}"></div>
  <div class="row"><label>clock seconds</label><input type="checkbox" data-k="seconds" ${cfg.seconds ? 'checked' : ''}></div>
  <div class="row"><label>grab focus</label><input type="checkbox" data-k="grabFocus" ${cfg.grabFocus ? 'checked' : ''}></div>
  <p class="note">off: the address bar stays empty and focused, so you can type a search there; click the page (or press esc then tab) for the palette.
  on: tab opens the palette at once, but the address bar shows the extension's url.</p>

  <h3>layout</h3>
  <p class="note">the page stays visible on the left while you adjust these.</p>
  <div class="row"><label>clock height</label><input type="range" min="-20" max="20" step="1" data-k="look.clockShift" data-unit="vh" value="${L().clockShift}"><span class="val">${L().clockShift}vh</span></div>
  <div class="row"><label>clock box</label><select data-k="look.box">
    ${opt('none', L().box)}${opt('single', L().box, 'one box for clock + date')}${opt('separate', L().box, 'separate boxes')}</select></div>
  <div class="row"><label>box colour</label><select data-k="look.boxTint">
    ${opt('wallpaper', L().boxTint, 'calm tint from wallpaper')}${opt('neutral', L().boxTint, 'neutral dark')}</select></div>
  <div class="row"><label>box opacity</label><input type="range" min="0" max="100" step="5" data-k="look.boxOpacity" data-unit="%" value="${L().boxOpacity}"><span class="val">${L().boxOpacity}%</span></div>
  <div class="row"><label>corner rounding</label><input type="range" min="0" max="48" step="2" data-k="look.boxRadius" data-unit="px" value="${L().boxRadius}"><span class="val">${L().boxRadius}px</span></div>
  <div class="row"><label>background blur</label><input type="range" min="0" max="30" step="2" data-k="look.boxBlur" data-unit="px" value="${L().boxBlur}"><span class="val">${L().boxBlur}px</span></div>
  <div class="row"><label>box the quote</label><input type="checkbox" data-k="look.boxQuote" ${L().boxQuote ? 'checked' : ''}></div>
  <div class="row"><label>box the links</label><input type="checkbox" data-k="look.boxLinks" ${L().boxLinks ? 'checked' : ''}></div>

  <h3>shortcuts</h3>
  <p class="note">key | name | home url | search url. In the palette: <b>g</b>↵ opens google, <b>g cats</b>↵ searches it.</p>
  <textarea data-k="shortcuts" rows="12">${esc(cfg.shortcuts)}</textarea>

  <h3>bottom links</h3>
  <textarea data-k="links" rows="7">${esc(cfg.links)}</textarea>

  <h3>terminal places</h3>
  <p class="note">folders the terminal can browse. Tab on an empty prompt cycles through them.</p>
  <div id="places"></div>
  <div class="btns"><input type="text" id="place-name" placeholder="name (optional)" style="flex:1"><button class="btn primary" data-act="mount">add folder…</button></div>

  <h3>wallpaper</h3>
  <div class="row"><label>source</label><select data-k="wall.source">
    ${opt('auto', W().source, 'auto (unsplash → wallhaven → picsum)')}${opt('unsplash', W().source)}${opt('wallhaven', W().source)}
    ${opt('picsum', W().source)}${opt('custom', W().source, 'custom url list')}${opt('none', W().source, 'none (plain)')}</select></div>
  <div class="row"><label>change</label><select data-k="wall.refresh">
    ${opt('tab', W().refresh, 'every new tab')}${opt('hour', W().refresh, 'every hour')}${opt('day', W().refresh, 'once a day')}</select></div>
  <div class="row"><label>liked share</label><input type="range" min="0" max="100" step="5" data-k="wall.likedShare" data-unit="%" value="${W().likedShare}"><span class="val">${W().likedShare}%</span></div>
  <div class="row"><label>softening</label><input type="range" min="0" max="100" step="5" data-k="wall.mood" value="${W().mood}"><span class="val">${W().mood}</span></div>
  <p class="note">softening desaturates & dims new images (baked in once, so it costs no RAM).</p>
  <div class="row"><label>unsplash access key</label><input type="password" data-k="wall.unsplashKey" value="${esc(W().unsplashKey)}" placeholder="optional, free"></div>
  <p class="note">best quality: create a free app at unsplash.com/developers and paste its access key.</p>
  <p class="note">search themes (one per line, picked at random):</p>
  <textarea data-k="wall.queries" rows="6">${esc(W().queries)}</textarea>
  <p class="note">custom image urls (one per line, used when source = custom):</p>
  <textarea data-k="wall.custom" rows="3">${esc(W().custom)}</textarea>
  <div class="btns"><button class="btn" data-act="next">next wallpaper</button><button class="btn" data-act="refetch">refetch with new settings</button></div>
  <h3>liked wallpapers</h3>
  <div class="liked-grid" id="liked"></div>

  <h3>quotes</h3>
  <div class="row"><label>built-in quotes</label><input type="checkbox" data-k="quotes.builtin" ${cfg.quotes.builtin ? 'checked' : ''}></div>
  <p class="note">topics (pick none for everything):</p>
  <div class="chips" id="topics">${TOPICS.map((t) => `<button class="chip ${cfg.quotes.topics.includes(t) ? 'on' : ''}" data-topic="${t}">#${t}</button>`).join('')}</div>
  <div class="row"><label>keywords</label><input type="text" data-k="quotes.keywords" value="${esc(cfg.quotes.keywords)}" placeholder="e.g. feynman, stars, #zen"></div>
  <p class="note" id="quote-count"></p>
  <p class="note">your own quotes, one per line: <b>text — author #tag #tag</b>. Untagged ones always show.</p>
  <textarea data-k="quotes.extra" rows="5">${esc(cfg.quotes.extra)}</textarea>

  <h3>backup</h3>
  <p class="note">export here, import in another browser to copy your setup.</p>
  <div class="btns">
    <button class="btn" data-act="export">export</button>
    <button class="btn" data-act="import">import…</button>
    <button class="btn" data-act="reset">reset to defaults</button>
  </div>`;
}

function setPath(path, value) {
  const keys = path.split('.');
  let o = cfg;
  while (keys.length > 1) o = o[keys.shift()];
  o[keys[0]] = value;
}

function bind() {
  el.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    const t = e.target;
    const v = t.type === 'checkbox' ? t.checked : t.type === 'range' ? +t.value : t.value;
    setPath(k, v);
    if (t.type === 'range') t.nextElementSibling.textContent = v + (t.dataset.unit || '');
    if (k.startsWith('look.')) applyLook(cfg.look);
    if (k.startsWith('wall.') && k !== 'wall.likedShare' && k !== 'wall.refresh') wallDirty = true;
    if (k.startsWith('quotes.')) countQuotes();
    scheduleSave();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab' && e.target.tagName === 'TEXTAREA' && !e.shiftKey) {
      e.preventDefault(); document.execCommand('insertText', false, '  ');   // keeps undo history
    }
  });
  el.addEventListener('click', async (e) => {
    const act = e.target.dataset.act;
    const topic = e.target.dataset.topic;
    if (topic) {
      const on = e.target.classList.toggle('on');
      const ts = cfg.quotes.topics.filter((t) => t !== topic);
      cfg.quotes.topics = on ? [...ts, topic] : ts;
      countQuotes();
      scheduleSave();
    }
    else if (act === 'close') close();
    else if (act === 'next') nextWall();
    else if (act === 'refetch') { flush(); await flushQueue(cfg); toast('queue cleared — new images on the next tabs'); }
    else if (act === 'mount') mount();
    else if (act === 'export') exportCfg();
    else if (act === 'import') importCfg();
    else if (act === 'reset' && confirm('Reset all settings to defaults? (liked wallpapers and places are kept)')) {
      saveConfig(structuredClone(DEFAULTS)); location.reload();
    }
  });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 400);
}

function countQuotes() {
  const n = pickable(cfg.quotes).length;
  const all = pickable({ ...cfg.quotes, topics: [], keywords: '' }).length;
  el.querySelector('#quote-count').textContent = n === all
    ? `showing all ${all} quotes.`
    : n ? `${n} of ${all} quotes match.` : 'nothing matches — no quote will show. Loosen the topics or keywords.';
}

function flush() {
  clearTimeout(saveTimer);
  saveConfig(cfg);
  onSave(structuredClone(cfg));
  if (wallDirty) { wallDirty = false; flushQueue(cfg); }
}

async function renderPlaces() {
  const places = await db.all('places');
  const box = el.querySelector('#places');
  box.innerHTML = places.length
    ? places.map((p) => `<div class="place"><span><span class="n">~/${esc(p.name)}</span> <span class="t-dim">${esc(p.handle.name)}</span></span><button data-rm="${esc(p.name)}">remove</button></div>`).join('')
    : '<p class="note">none yet.</p>';
  box.onclick = async (e) => {
    const n = e.target.dataset.rm;
    if (n) { await db.del('places', n); renderPlaces(); }
  };
}

async function mount() {
  if (!window.showDirectoryPicker) return toast('folder access is off — in Brave enable brave://flags/#file-system-access-api', 5000);
  try {
    const handle = await window.showDirectoryPicker({ id: 'homepate', mode: 'read' });
    const input = el.querySelector('#place-name');
    const name = (input.value.trim() || handle.name).toLowerCase().replace(/\s+/g, '-');
    await db.set('places', name, { name, handle });
    input.value = '';
    renderPlaces();
  } catch {}
}

async function renderLiked() {
  const liked = (await listLiked()).sort((a, b) => b.likedAt - a.likedAt);
  const box = el.querySelector('#liked');
  box.innerHTML = '';
  if (!liked.length) { box.outerHTML = '<p class="note" id="liked">none yet — hover the bottom-right corner and press like.</p>'; return; }
  for (const w of liked) {
    const d = document.createElement('div');
    const url = URL.createObjectURL(w.thumb || w.blob);
    d.style.backgroundImage = `url("${url}")`;
    d.title = w.credit || '';
    d.onclick = async () => { await removeLiked(w.id); URL.revokeObjectURL(url); d.remove(); };
    box.append(d);
  }
}

function exportCfg() {
  flush();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(loadConfig(), null, 2)], { type: 'application/json' }));
  a.download = 'startpage-settings.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importCfg() {
  const f = document.createElement('input');
  f.type = 'file';
  f.accept = 'application/json,.json';
  f.onchange = async () => {
    try { saveConfig(JSON.parse(await f.files[0].text())); location.reload(); }
    catch { toast('not a valid settings file'); }
  };
  f.click();
}
