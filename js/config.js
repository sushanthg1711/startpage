// All user-editable settings live here, as plain text where that is easiest
// to edit by hand. Stored in localStorage (synchronous, so first paint is instant).

const KEY = 'hp.config';

export const DEFAULTS = {
  user: 'susha',
  host: 'startpage',
  searchKey: 'g',            // shortcut used when the input matches nothing else
  seconds: false,            // show seconds on the clock
  grabFocus: false,          // take focus from the address bar (shows the extension url there)
  shortcuts: `# key | name | home url | search url (%s = your query)
g  | google         | https://www.google.com            | https://www.google.com/search?q=%s
y  | youtube        | https://www.youtube.com           | https://www.youtube.com/results?search_query=%s
gh | github         | https://github.com                | https://github.com/search?q=%s
m  | gmail          | https://mail.google.com           | https://mail.google.com/mail/u/0/#search/%s
d  | drive          | https://drive.google.com          | https://drive.google.com/drive/search?q=%s
s  | scholar        | https://scholar.google.com        | https://scholar.google.com/scholar?q=%s
a  | arxiv          | https://arxiv.org                 | https://arxiv.org/search/?query=%s&searchtype=all
w  | wikipedia      | https://en.wikipedia.org          | https://en.wikipedia.org/wiki/Special:Search?search=%s
c  | claude         | https://claude.ai                 | https://claude.ai/new?q=%s
so | stack overflow | https://stackoverflow.com         | https://stackoverflow.com/search?q=%s
r  | reddit         | https://www.reddit.com            | https://www.reddit.com/search/?q=%s
mp | maps           | https://www.google.com/maps       | https://www.google.com/maps/search/%s
t  | translate      | https://translate.google.com      | https://translate.google.com/?sl=auto&tl=en&text=%s`,
  links: `# name | url   (shown along the bottom)
mail    | https://mail.google.com
drive   | https://drive.google.com
github  | https://github.com
scholar | https://scholar.google.com
arxiv   | https://arxiv.org
youtube | https://www.youtube.com
claude  | https://claude.ai`,
  wall: {
    source: 'auto',          // auto | unsplash | wallhaven | picsum | custom | none
    refresh: 'tab',          // tab | hour | day
    likedShare: 25,          // % of new tabs that show one of your liked wallpapers
    mood: 30,                // 0–100: how much to soften (desaturate + dim) images
    unsplashKey: '',
    queries: `minimal landscape
fog mountains
misty forest
calm sea
nordic architecture
minimal desert
still lake`,
    custom: '',
  },
  look: {
    clockShift: -6,          // vh; negative moves the clock and date up
    box: 'single',           // none | single (clock + date together) | separate
    boxTint: 'wallpaper',    // wallpaper (calm dark tint) | match | invert | neutral — see boxColour in ui.js
    boxOpacity: 30,          // 0–100
    boxRadius: 18,           // px
    boxBlur: 12,             // px of frosted-glass blur behind the box
    boxQuote: false,
    boxLinks: false,
  },
  quotes: {
    builtin: true,
    topics: [],              // e.g. ['philosophy', 'abstract']; empty = everything
    keywords: '',            // free words or #tags, matched against text, author and tags
    extra: `# one per line:  text — author  #optional #tags`,
  },
};

function merge(base, over) {
  const out = { ...base };
  for (const k in over) {
    out[k] = base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? merge(base[k], over[k] || {}) : over[k];
  }
  return out;
}

export function loadConfig() {
  try {
    const cfg = merge(DEFAULTS, JSON.parse(localStorage.getItem(KEY)) || {});
    if (cfg.host === 'homepate') cfg.host = DEFAULTS.host;   // the project's old name
    return cfg;
  }
  catch { return structuredClone(DEFAULTS); }
}

export function saveConfig(cfg) {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

// "a | b | c" lines → arrays, skipping blanks and # comments
export function rows(text) {
  return (text || '').split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.split('|').map(s => s.trim()));
}

export function parseShortcuts(text) {
  return rows(text)
    .filter(r => r[0] && r[2])
    .map(([key, name, home, search]) => ({ key: key.toLowerCase(), name: name || key, home, search: search || '' }));
}

export function parseLinks(text) {
  return rows(text).filter(r => r[0] && r[1]).map(([name, url]) => ({ name, url }));
}
