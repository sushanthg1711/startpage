// Wallpapers: fetched in the background, resized to the screen, softened once
// (baked into the pixels, so it costs nothing at display time), and cached in
// IndexedDB. A new tab only ever decodes one screen-sized local JPEG.

import * as db from './db.js';
import { $, idle, toast } from './ui.js';

const QUEUE_SIZE = 2;
const SEEN_MAX = 5000;
const DOWN_FOR = 6 * 3600e3;               // skip an unreachable source for 6 h
const SOFT_COLORS = ['424153', '999999', '336600', '666600', '66cccc']; // wallhaven palette

let cfg;
let current = null;
let shownUrl = null;

/* ── display ─────────────────────────────────────────── */

export async function initWall(config) {
  cfg = config.wall;
  bindButtons();
  if (cfg.source === 'none') return;

  current = await db.get('kv', 'current');
  if (!current || isDue(await db.get('kv', 'shownAt'))) {
    current = (await advance()) || current;
  }
  if (current) await show(current);
  else {
    // first run: nothing cached yet, fetch one right now
    const e = await fetchOne();
    if (e) { await setCurrent(e); await show(e); }
  }
  idle(refill);
}

async function show(entry) {
  const url = URL.createObjectURL(entry.blob);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { URL.revokeObjectURL(url); return; }
  const wall = $('#wall');
  wall.style.backgroundImage = `url("${url}")`;
  wall.classList.add('ready');
  if (shownUrl) URL.revokeObjectURL(shownUrl);
  shownUrl = url;

  if (entry.tint) try { localStorage.setItem('hp.tint', entry.tint); } catch {}
  const credit = $('#wall-credit');
  credit.textContent = entry.credit || '';
  credit.href = entry.page || '#';
  credit.hidden = !entry.page;
  $('#wall-like').classList.toggle('on', !!(await db.get('liked', entry.id)));
}

function isDue(shownAt) {
  if (!shownAt || cfg.refresh === 'tab') return true;
  if (cfg.refresh === 'hour') return Date.now() - shownAt > 3600e3;
  return new Date(shownAt).toDateString() !== new Date().toDateString();
}

async function setCurrent(e) {
  current = e;
  await db.set('kv', 'current', e);
  await db.set('kv', 'shownAt', Date.now());
}

// Pick the next wallpaper: sometimes a liked one, otherwise the next fresh one.
async function advance() {
  return navigator.locks.request('hp-advance', async () => {
    const liked = await db.keys('liked');
    const pool = liked.filter((id) => id !== current?.id);
    if (pool.length && Math.random() * 100 < cfg.likedShare) {
      const e = await db.get('liked', pool[(Math.random() * pool.length) | 0]);
      await setCurrent(e);
      return e;
    }
    const queue = (await db.get('kv', 'queue')) || [];
    const e = queue.shift();
    if (!e) return null;
    await db.set('kv', 'queue', queue);
    await setCurrent(e);
    return e;
  });
}

async function refill() {
  await navigator.locks.request('hp-refill', { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    let queue = (await db.get('kv', 'queue')) || [];
    while (queue.length < QUEUE_SIZE) {
      const e = await fetchOne();
      if (!e) break;
      queue = (await db.get('kv', 'queue')) || [];
      queue.push(e);
      await db.set('kv', 'queue', queue);
    }
  });
}

/* ── actions (hover buttons, palette commands) ───────── */

export async function nextWall() {
  let e = await advance();
  if (!e) {
    toast('fetching a new wallpaper…', 8000);
    e = await fetchOne();
    if (!e) return toast('could not reach any wallpaper source');
    await setCurrent(e);
  }
  await show(e);
  toast('');
  idle(refill);
}

export async function toggleLike() {
  if (!current) return;
  if (await db.get('liked', current.id)) {
    await db.del('liked', current.id);
    $('#wall-like').classList.remove('on');
    toast('removed from liked');
  } else {
    await db.set('liked', current.id, { ...current, thumb: await thumb(current.blob), likedAt: Date.now() });
    $('#wall-like').classList.add('on');
    toast('liked — it will come back now and then');
  }
}

export async function dislikeWall() {
  if (!current) return;
  await db.del('liked', current.id);
  toast('gone for good');
  await nextWall();
}

export const listLiked = () => db.all('liked');
export const removeLiked = (id) => db.del('liked', id);
export async function flushQueue(config) {
  cfg = config.wall;
  await db.set('kv', 'queue', []);
  await db.set('kv', 'down', {});
  idle(refill);
}

function bindButtons() {
  $('#wall-like').onclick = toggleLike;
  $('#wall-dislike').onclick = dislikeWall;
  $('#wall-next').onclick = nextWall;
}

/* ── fetching ────────────────────────────────────────── */

const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const lines = (t) => (t || '').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));

async function timed(url, opts = {}, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r;
  } finally { clearTimeout(t); }
}

const SOURCES = {
  async unsplash() {
    if (!cfg.unsplashKey) return null;
    const auth = { headers: { Authorization: `Client-ID ${cfg.unsplashKey}` } };
    const q = encodeURIComponent(pick(lines(cfg.queries)) || 'minimal landscape');
    const p = await (await timed(`https://api.unsplash.com/photos/random?orientation=landscape&content_filter=high&query=${q}`, auth)).json();
    fetch(p.links.download_location, auth).catch(() => {});   // required by Unsplash API terms
    return {
      id: 'us:' + p.id,
      img: `${p.urls.raw}&w=${target().w}&q=82&fm=jpg&fit=max`,
      page: `${p.links.html}?utm_source=startpage&utm_medium=referral`,
      credit: p.user?.name || 'unsplash',
    };
  },

  async wallhaven() {
    const q = encodeURIComponent(pick(lines(cfg.queries)) || 'minimalism');
    const base = `https://wallhaven.cc/api/v1/search?q=${q}&categories=100&purity=100&ratios=16x9,16x10&atleast=1920x1080&sorting=random`;
    let data = (await (await timed(`${base}&colors=${pick(SOFT_COLORS)}`)).json()).data;
    if (!data?.length) data = (await (await timed(base)).json()).data;
    const seen = new Set((await db.get('kv', 'seen')) || []);
    const w = data?.find((d) => !seen.has('wh:' + d.id));
    return w && { id: 'wh:' + w.id, img: w.path, page: w.url, credit: 'wallhaven' };
  },

  async picsum() {
    const { w, h } = target();
    const r = await timed(`https://picsum.photos/${w}/${h}`, {}, 30000);
    const id = r.url.match(/\/id\/(\d+)\//)?.[1] || String(Date.now());
    const blob = await r.blob();
    let page = 'https://picsum.photos', credit = 'picsum';
    try {
      const info = await (await timed(`https://picsum.photos/id/${id}/info`)).json();
      page = info.url; credit = info.author;
    } catch {}
    return { id: 'ps:' + id, blob, page, credit };
  },

  async custom() {
    const url = pick(lines(cfg.custom));
    return url && { id: 'cu:' + url, img: url, page: url, credit: new URL(url).hostname };
  },
};

function order() {
  switch (cfg.source) {
    case 'auto': return ['unsplash', 'wallhaven', 'picsum'];
    case 'picsum': return ['picsum'];
    case 'custom': return ['custom'];
    default: return [cfg.source, 'picsum'];
  }
}

async function fetchOne() {
  const down = (await db.get('kv', 'down')) || {};
  const seen = (await db.get('kv', 'seen')) || [];
  for (const name of order()) {
    if (down[name] > Date.now()) continue;
    for (let tries = 0; tries < 3; tries++) {
      try {
        const meta = await SOURCES[name]();
        if (!meta) break;
        if (name !== 'custom' && seen.includes(meta.id)) continue;
        const raw = meta.blob || (await (await timed(meta.img, {}, 45000)).blob());
        const { blob, tint } = await soften(raw);
        seen.push(meta.id);
        await db.set('kv', 'seen', seen.slice(-SEEN_MAX));
        return { id: meta.id, page: meta.page, credit: meta.credit, blob, tint, source: name };
      } catch (err) {
        console.warn('[startpage] wallpaper', name, err);
        if (err.name === 'AbortError' || err instanceof TypeError) {
          down[name] = Date.now() + DOWN_FOR;
          await db.set('kv', 'down', down);
          break;
        }
      }
    }
  }
  return null;
}

/* ── image processing ────────────────────────────────── */

function target() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.min(2560, Math.round(screen.width * dpr));
  return { w, h: Math.round((w * screen.height) / screen.width) };
}

// Resize to cover the screen and bake in the soft, slightly desaturated look.
async function soften(raw) {
  const bmp = await createImageBitmap(raw);
  const { w, h } = target();
  const s = Math.max(w / bmp.width, h / bmp.height);
  const sw = w / s, sh = h / s;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const m = (cfg.mood ?? 30) / 100;
  ctx.filter = `saturate(${1 - m * 0.5}) brightness(${1 - m * 0.28}) contrast(${1 - m * 0.1})`;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, w, h);
  bmp.close();

  const px = new OffscreenCanvas(1, 1).getContext('2d');
  px.drawImage(canvas, 0, 0, 1, 1);
  const [r, g, b] = px.getImageData(0, 0, 1, 1).data;

  return { blob: await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 }), tint: `rgb(${r},${g},${b})` };
}

async function thumb(blob) {
  const bmp = await createImageBitmap(blob, { resizeWidth: 320, resizeQuality: 'medium' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}
