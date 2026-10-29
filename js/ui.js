export const $ = (sel) => document.querySelector(sel);

export const idle = (fn) =>
  (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(fn, { timeout: 4000 });

let toastTimer;
export function toast(msg, ms = 1800) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ctrl/shift/middle → new tab, otherwise this tab
export function go(url, newTab = false) {
  if (newTab) window.open(url, '_blank', 'noopener');
  else location.href = url;
}

/* ── look: clock position and the boxes behind home-screen text ── */

let look, wallTint = null;
try { wallTint = localStorage.getItem('hp.ctint') || localStorage.getItem('hp.tint'); } catch {}

// wall.js calls this whenever a new wallpaper is shown.
export function setWallTint(tint) {
  wallTint = tint;
  if (look) paintBox();
}

const hslRgb = (h, s, l) => {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h % 2) - 1)), m = l - c / 2;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h) % 6];
  return [r, g, b].map((v) => Math.round((v + m) * 255)).join(', ');
};

// Box colour from the wallpaper's average colour, always low in saturation.
//   wallpaper: same hue, always dark      match: light on bright, dark on dark
//   invert:    opposite hue and opposite lightness (dark on bright, light on dark)
export function boxColour(tint, mode) {
  if (mode === 'neutral' || !tint) return { rgb: '16, 19, 21', light: false };
  const [r, g, b] = tint.match(/\d+/g).map((n) => n / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const h = d ? (max === r ? (g - b) / d + 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) % 6 : 0;
  const bright = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.38;
  let H = h, S = Math.min(s, 0.35) * 0.42, L = 0.1 + l * 0.12;
  if (mode === 'match') L = bright ? 0.8 + l * 0.1 : 0.1 + l * 0.15;
  if (mode === 'invert') { H = (h + 3) % 6; S = Math.min(s, 0.35) * 0.5; L = bright ? 0.1 + (1 - l) * 0.1 : 0.86 - l * 0.15; }
  return { rgb: hslRgb(H, S, L), light: L > 0.5 };
}

function paintBox() {
  const { rgb, light } = boxColour(wallTint, look.boxTint);
  const a = look.boxOpacity / 100;
  const alpha = light ? 0.45 + a * 0.55 : a;     // a light box behind dark text needs more body
  const root = document.documentElement;
  root.style.setProperty('--box-rgb', rgb);
  root.style.setProperty('--box-alpha', alpha);
  root.classList.toggle('box-light', light);
  try { localStorage.setItem('hp.box', JSON.stringify({ rgb, alpha, light })); } catch {}
}

export function applyLook(l) {
  look = l;
  const s = document.documentElement.style;
  s.setProperty('--clock-shift', `${l.clockShift}vh`);
  s.setProperty('--box-radius', `${l.boxRadius}px`);
  s.setProperty('--box-blur', `${l.boxBlur}px`);
  paintBox();
  const box = (sel, on) => $(sel).classList.toggle('boxed', on);
  box('#clock', l.box === 'single');
  box('#time', l.box === 'separate');
  box('#date', l.box === 'separate');
  box('#quote', l.boxQuote);
  box('#links', l.boxLinks);
}
