// Optional: Chrome puts keyboard focus in the address bar on a new-tab page.
// A tiny in-page navigation hands focus to the page instead, so Tab works at
// once, but the address bar then shows the extension's url. Off by default
// (settings → general → grab focus). main.js skips that first, throwaway load.
try {
  const cfg = JSON.parse(localStorage.getItem('hp.config'));
  if (cfg?.grabFocus && location.search !== '?f') {
    window.hpRedirecting = true;
    location.replace(location.pathname + '?f');
  }
} catch (e) {}

// Paint the wallpaper's average colour before anything loads, so there is no flash.
try {
  const tint = localStorage.getItem('hp.tint');
  if (tint) document.documentElement.style.setProperty('--fallback', tint);
  const box = JSON.parse(localStorage.getItem('hp.box'));   // last box colour, see ui.js
  if (box?.rgb) {
    document.documentElement.style.setProperty('--box-rgb', box.rgb);
    document.documentElement.style.setProperty('--box-alpha', box.alpha);
    if (box.light) document.documentElement.classList.add('box-light');
  }
} catch (e) {}
