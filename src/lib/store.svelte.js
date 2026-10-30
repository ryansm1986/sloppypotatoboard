import { AudioEngine } from './audio.js';
import { keyLabel } from './keys.js';

export const api = window.potato;
export const engine = new AudioEngine();

export const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#b197fc', '#f783ac', '#e599f7'];
export const EMOJIS = [
  '🥔', '🔊', '💥', '🎺', '🤡', '🦆', '🚨', '🎉', '👀', '😂', '🔥', '💀', '🐸', '🍟', '🌭', '🎸',
  '🥁', '📣', '🧨', '🫠', '🤌', '😤', '🙃', '😱', '🤖', '👻', '🐐', '🦖', '🍕', '🥩', '⚰️', '👔',
  '💪', '✈️', '🛎️', '🔔', '🧑‍✈️', '🛫', '🏆', '💩', '🎤', '🫡', '🤯', '🐟', '🐕', '⏰', '🚽', '🧀',
];

export const app = $state({
  ready: false,
  version: '',
  soundsDir: '',
  library: { categories: [], sounds: [] },
  settings: {},
  hotkeyFailures: [],
  tab: 'all',
  search: '',
  tagFilter: null, // a tag, or '#hotkey'
  cursor: 0, // highlighted result while filtering; Enter plays it
  gridCols: 1,
  playing: {}, // id -> { startedAt, duration, preview }
  peaks: {}, // id -> number[]
  durations: {},
  devices: { inputs: [], outputs: [] },
  status: { mic: null, micError: null, game: null, monitor: null, cable: false, cableMic: false },
  gate: { micLive: true, boardLive: false },
  listening: false,
  modal: null, // { type: 'edit'|'settings'|'setup'|'url'|'category', ... }
  toasts: [],
  maximized: false,
  update: { status: 'idle' }, // see electron/updater.js
  pulse: 0,
  triggers: {}, // id -> count, drives the "pop" animation
});

export const levels = $state({ mic: 0, game: 0, monitor: 0 });

// Handy for poking at things from DevTools (Ctrl+Shift+I isn't bound, but the debug harness uses it).
window.__potato = { app, engine };

export const cleanError = (err) =>
  String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

let toastId = 0;
export function toast(message, kind = 'info', ms = 3800, action = null) {
  const id = ++toastId;
  app.toasts.push({ id, message, kind, action });
  setTimeout(() => dismissToast(id), ms);
}

export function dismissToast(id) {
  app.toasts = app.toasts.filter((t) => t.id !== id);
}

export const findSound = (id) => app.library.sounds.find((s) => s.id === id);

// ---------------------------------------------------------------------------- boot

export async function init() {
  const data = await api.init();
  app.library = data.library;
  app.settings = data.settings;
  app.hotkeyFailures = data.hotkeyFailures;
  app.version = data.version;
  app.soundsDir = data.soundsDir;

  api.on('library:changed', (lib) => {
    app.library = lib;
    preload();
  });
  api.on('settings:changed', (s) => {
    app.settings = s;
    engine.apply($state.snapshot(s));
  });
  api.on('hotkeys:status', (f) => (app.hotkeyFailures = f));
  api.on('hotkey', onHotkey);
  api.on('app:toast', ({ message, kind }) => toast(message, kind));
  api.on('win:state', ({ maximized }) => (app.maximized = maximized));
  app.update = data.update;
  api.on('update:status', (u) => {
    if (u.status === 'ready' && app.update.status !== 'ready') {
      toast(`Sloppy Potato Board ${u.latest} is ready to install`, 'success', 12000, {
        label: 'Restart now',
        run: () => api.update.install(),
      });
    }
    app.update = u;
  });

  engine.on('playing', (map) => {
    const next = {};
    for (const [id, e] of map) next[id] = { startedAt: e.startedAt, duration: e.duration, preview: e.preview };
    app.playing = next;
  });
  engine.on('status', (s) => (app.status = { ...s }));
  engine.on('devices', (d) => (app.devices = structuredClone(d)));
  engine.on('gate', (g) => (app.gate = g));

  await engine.start($state.snapshot(app.settings), (id) => api.library.readSound(id));
  app.ready = true;
  if (!app.settings.setupDone) app.modal = { type: 'setup' };
  else if (data.whatsNew) showWhatsNew(data.whatsNew);

  preload();
  meterLoop();
}

// Decode every clip up front so the first press is instant and tiles get their waveforms.
function showWhatsNew({ from, version, packs }) {
  const added = packs.reduce((n, p) => n + p.count, 0);
  const where = packs.map((p) => `${p.name} +${p.count}`).join(', ');
  const head = from ? `Updated to ${version}!` : 'New sounds!';
  const body = added ? ` ${added} new sounds (${where}).` : '';
  const board = packs.find((p) => p.category !== 'airplane') || packs[0];
  toast(`${head}${body}`, 'success', 9000, board ? { label: 'Take a look', run: () => (app.tab = board.category) } : null);
}

let preloading = false;
let preloadAgain = false;
const published = new Map(); // sound id -> engine key whose waveform is on screen
async function preload() {
  if (preloading) {
    preloadAgain = true;
    return;
  }
  preloading = true;
  try {
    do {
      preloadAgain = false;
      for (const s of app.library.sounds) {
        if (!s.file) continue;
        const sound = $state.snapshot(s);
        const key = engine.key(sound);
        if (published.get(s.id) === key) continue;
        try {
          await engine.load(sound);
          publishMeta(sound);
        } catch (err) {
          console.warn('could not decode', s.name, err);
        }
      }
    } while (preloadAgain);
  } finally {
    preloading = false;
  }
}

function publishMeta(sound) {
  const meta = engine.metaFor(sound);
  if (!meta) return;
  published.set(sound.id, engine.key(sound));
  app.peaks[sound.id] = meta.peaks;
  app.durations[sound.id] = meta.duration;
}

function meterLoop() {
  let last = { mic: 0, game: 0, monitor: 0 };
  const tick = () => {
    const l = engine.levels();
    for (const k of ['mic', 'game', 'monitor']) {
      // fast attack, smooth release
      last[k] = l[k] > last[k] ? l[k] : last[k] * 0.86 + l[k] * 0.14;
      levels[k] = last[k];
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------- actions

function onHotkey(e) {
  if (e.type === 'play') playSound(e.id);
  else if (e.type === 'stopAll') stopAll();
  else if (e.type === 'toggleMute') toggleMute();
  else if (e.type === 'toggleMode') setSettings({ micMode: app.settings.micMode === 'swap' ? 'mix' : 'swap' });
}

export async function playSound(id, opts = {}) {
  const s = findSound(id);
  if (!s) return;
  if (!s.file) {
    if (!opts.quiet) toast(`"${s.name}" needs a clip. Drop one on it or paste a link.`, 'info');
    return;
  }
  app.triggers[id] = (app.triggers[id] || 0) + 1;
  app.pulse++;
  try {
    const sound = $state.snapshot(s);
    await engine.play(sound, opts);
    if (published.get(id) !== engine.key(sound)) publishMeta(sound);
  } catch (err) {
    toast(`Couldn't play "${s.name}": ${cleanError(err)}`, 'error');
  }
}

export const stopSound = (id) => engine.stop(id);
export const stopAll = () => engine.stopAll();

export function toggleMute() {
  setSettings({ micMuted: !app.settings.micMuted });
}

export async function setSettings(patch) {
  const { hotkeys, ...rest } = patch;
  Object.assign(app.settings, rest);
  if (hotkeys) app.settings.hotkeys = { ...app.settings.hotkeys, ...hotkeys };
  engine.apply($state.snapshot(app.settings));
  const { lost } = await api.settings.set($state.snapshot(patch));
  if (lost?.length) toast(`Took that hotkey from ${lost.join(', ')}`, 'info');
}

export async function updateSound(id, patch) {
  const s = findSound(id);
  if (s) Object.assign(s, patch);
  const { lost } = await api.library.update(id, $state.snapshot(patch));
  if (lost?.length) toast(`${keyLabel(patch.hotkey)} moved here from ${lost.join(', ')}`, 'info');
}

export async function removeSound(id) {
  engine.stop(id);
  await api.library.remove(id);
}

export function targetCategory() {
  return app.library.categories.some((c) => c.id === app.tab) ? app.tab : 'mine';
}

function reportImport(r) {
  if (!r) return;
  const n = r.added?.length || 0;
  if (n) toast(n === 1 ? 'Sound added' : `${n} sounds added`, 'success');
  for (const p of r.packs || []) {
    toast(`Added "${p.name}" with ${p.count} sounds`, 'success');
    app.tab = p.category;
  }
  for (const e of r.errors || []) toast(`Skipped ${e}`, 'error', 5000);
}

export async function importPaths(paths, opts = {}) {
  try {
    reportImport(await api.library.importFiles(paths, { category: targetCategory(), ...opts }));
  } catch (err) {
    toast(cleanError(err), 'error');
  }
}

export async function pickFiles(opts = {}) {
  try {
    reportImport(await api.library.pickFiles({ category: targetCategory(), ...opts }));
  } catch (err) {
    toast(cleanError(err), 'error');
  }
}

export async function importUrl(url, opts = {}) {
  const r = await api.library.importUrl(url, { category: targetCategory(), ...opts });
  toast(opts.slotId ? 'Clip added' : `Added "${r.name}"`, 'success');
  return r;
}

export async function setListening(on) {
  app.listening = await engine.setListening(on);
}
