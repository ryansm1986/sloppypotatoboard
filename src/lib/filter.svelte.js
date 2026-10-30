// Which buttons are on screen: current board tab + tag chip + search text.
import { app } from './store.svelte.js';
import { keyLabel } from './keys.js';

export const TAGS = {
  announcement: ['📢', 'Announcements'],
  captain: ['🧑‍✈️', 'Captain'],
  attendant: ['💁', 'Flight attendant'],
  gate: ['🛫', 'Gate'],
  chime: ['🔔', 'Chimes'],
  'lock-on': ['🎯', 'Lock-on'],
  alert: ['🚨', 'Alerts'],
  radio: ['📻', 'Radio'],
  voice: ['🗣️', 'Voice'],
  effect: ['💥', 'Effects'],
};
export const HOTKEY_FILTER = '#hotkey';

export const tagEmoji = (t) => TAGS[t]?.[0] ?? '#';
export const tagName = (t) => TAGS[t]?.[1] ?? t;

export const tokensOf = (q) => q.trim().toLowerCase().split(/\s+/).filter(Boolean);

function inTab(s) {
  if (app.tab === 'all') return true;
  if (app.tab === 'favorites') return s.favorite;
  return s.category === app.tab;
}

function matches(s, tokens, boards) {
  if (!tokens.length) return true;
  const tags = s.tags || [];
  const hay = [
    s.name.toLowerCase(),
    boards.get(s.category) || '',
    s.hotkey ? keyLabel(s.hotkey).toLowerCase() : '',
    ...tags,
    ...tags.map((t) => tagName(t).toLowerCase()),
  ];
  return tokens.every((tok) => hay.some((h) => h.includes(tok)));
}

const scoped = $derived(app.library.sounds.filter(inTab));

const results = $derived.by(() => {
  const tokens = tokensOf(app.search);
  const boards = new Map(app.library.categories.map((c) => [c.id, c.name.toLowerCase()]));
  const tag = app.tagFilter;
  return scoped.filter(
    (s) => (!tag || (tag === HOTKEY_FILTER ? !!s.hotkey : s.tags?.includes(tag))) && matches(s, tokens, boards),
  );
});

const tagCounts = $derived.by(() => {
  const counts = new Map();
  for (const s of scoped) for (const t of s.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  const known = Object.keys(TAGS);
  const rank = (t) => (known.includes(t) ? known.indexOf(t) : known.length);
  return [...counts].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1]);
});

export const view = {
  get scoped() {
    return scoped;
  },
  get sounds() {
    return results;
  },
  get tags() {
    return tagCounts;
  },
  get hotkeyCount() {
    return scoped.filter((s) => s.hotkey).length;
  },
  get filtering() {
    return !!app.search.trim() || !!app.tagFilter;
  },
};

export function clearFilters() {
  app.search = '';
  app.tagFilter = null;
  app.cursor = 0;
}

/** Split a name into plain / matched pieces for highlighting. */
export function highlight(text, query) {
  const tokens = tokensOf(query);
  if (!tokens.length) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const marks = new Array(text.length).fill(false);
  for (const tok of tokens) {
    for (let i = lower.indexOf(tok); i !== -1; i = lower.indexOf(tok, i + 1)) {
      for (let k = i; k < i + tok.length; k++) marks[k] = true;
    }
  }
  const parts = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.hit === marks[i]) last.text += text[i];
    else parts.push({ text: text[i], hit: marks[i] });
  }
  return parts;
}
