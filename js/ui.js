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
