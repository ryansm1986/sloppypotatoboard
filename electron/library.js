const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate');
const { JsonStore } = require('./store');

const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.oga', '.flac', '.m4a', '.aac', '.webm', '.opus']);
const PACK_EXT = new Set(['.potatopack', '.zip']);
const MAX_BYTES = 40 * 1024 * 1024;

const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#b197fc', '#f783ac', '#e599f7'];
const EMOJIS = ['🥔', '🔊', '💥', '🎺', '🤡', '🦆', '🚨', '🎉', '👀', '😂', '🔥', '💀', '🐸', '🍟', '🎸', '🥁', '📣', '🧨', '🫠', '🤌'];

// Clips from the show aren't bundled (they're Netflix's), so these are ready-made
// empty slots: drop a clip on one, paste a link, or hit "Find it" to search for it.
const ITYSL_SLOTS = [
  ['We\'re All Trying to Find the Guy Who Did This', '🌭', '#ffd43b', 'trying to find the guy who did this'],
  ['Sloppy Steaks', '🥩', '#ff6b6b', 'sloppy steaks'],
  ['Coffin Flop', '⚰️', '#b197fc', 'coffin flop'],
  ['Dan Flashes', '👔', '#f783ac', 'dan flashes'],
  ['Little Buff Boys', '💪', '#ffa94d', 'little buff boys'],
];

const cleanTags = (tags) =>
  Array.isArray(tags)
    ? [...new Set(tags.map((t) => String(t).toLowerCase().trim().slice(0, 24)).filter(Boolean))].slice(0, 8)
    : [];

const soundKey = (pack, s) => `${pack.id}/${s.id || s.file}`;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const newId = () => crypto.randomBytes(6).toString('hex');

function slug(s) {
  return (
    String(s)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '-')
      .slice(0, 40) || 'sound'
  );
}

/** "y2mate_coffin-flop_sRzY6rh.mp3" -> "Coffin flop" */
function prettyName(file) {
  let s = path.basename(file, path.extname(file));
  s = s.replace(/_[A-Za-z0-9]{7}$/, ''); // django-style dedupe suffix (myinstants)
  s = s.replace(/\b(y2mate|mp3cut|audiotrimmer|com|net|online|audio|trim(med)?|cut)\b/gi, ' ');
  s = s.replace(/[_\-.+]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return 'New sound';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

class Library extends EventEmitter {
  constructor(userDir, resourcesDir, { trash } = {}) {
    super();
    this.soundsDir = path.join(userDir, 'sounds');
    this.resourcesDir = resourcesDir;
    this.trash = trash || ((p) => fsp.unlink(p));
    this.store = new JsonStore(path.join(userDir, 'library.json'), { version: 1, categories: [], sounds: [] });
    this.watcher = null;
    this.scanTimer = null;
    this.busy = 0; // imports in flight; folder scans wait for them
  }

  async guarded(fn) {
    this.busy++;
    try {
      return await fn();
    } finally {
      this.busy--;
    }
  }

  get data() {
    return this.store.data;
  }

  async init() {
    await fsp.mkdir(this.soundsDir, { recursive: true });
    this.fresh = !this.store.load();
    if (this.fresh) this.store.data = { version: 2, installedSounds: [], categories: [], sounds: [] };
    const packs = await this.bundledPacks();
    this.migrate(packs);
    this.newPacks = await this.installBundledSounds(packs);
    if (this.fresh) this.addSlots();
    this.ensureCategory('mine', 'My Sounds', '🥔');
    this.store.save(true);
    await this.scan();
    this.watch();
  }

  changed() {
    this.store.save();
    this.emit('change', this.data);
  }

  ensureCategory(id, name, emoji) {
    if (!this.data.categories.some((c) => c.id === id)) this.data.categories.push({ id, name, emoji });
  }

  /** Bring older libraries up to date. */
  migrate(packs) {
    const d = this.data;
    if (!Array.isArray(d.installedSounds)) {
      // 1.0 libraries only ever had the airplane pack: count all of it as seen, even sounds deleted since
      const hadAirplane = d.sounds.some((s) => s.file?.startsWith('airplane-')) || d.categories.some((c) => c.id === 'airplane');
      const airplane = packs.find((p) => p.id === 'airplane');
      d.installedSounds = hadAirplane && airplane ? airplane.sounds.map((s) => soundKey(airplane, s)) : [];
    }
    delete d.installedPacks;
    for (const s of d.sounds) s.tags = cleanTags(s.tags);
    d.version = 2;
  }

  async bundledPacks() {
    const root = path.join(this.resourcesDir, 'packs');
    const packs = [];
    for (const dir of await fsp.readdir(root).catch(() => [])) {
      try {
        const pack = JSON.parse(await fsp.readFile(path.join(root, dir, 'pack.json'), 'utf8'));
        packs.push({ ...pack, id: pack.id || dir, dir: path.join(root, dir) });
      } catch {
        /* not a pack */
      }
    }
    return packs.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  }

  /**
   * Adds every bundled sound this library hasn't seen yet, so app updates can ship new
   * sounds (even into an existing pack). Anything already seen is never re-added, so
   * sounds the user deleted stay deleted.
   */
  async installBundledSounds(packs) {
    const d = this.data;
    const seen = new Set(d.installedSounds);
    const taken = new Set(d.sounds.map((s) => s.hotkey?.toLowerCase()).filter(Boolean));
    const added = [];
    for (const pack of packs) {
      this.backfillTags(pack);
      const fresh = pack.sounds.filter((s) => !seen.has(soundKey(pack, s)));
      if (!fresh.length) continue;
      const category = pack.category || pack.id;
      if (!d.categories.some((c) => c.id === category)) {
        const cat = { id: category, name: pack.name, emoji: pack.emoji || '📦' };
        const before = d.categories.findIndex((c) => c.id === 'itysl' || c.id === 'mine');
        if (before === -1) d.categories.push(cat);
        else d.categories.splice(before, 0, cat);
      }
      // keep a board's sounds together in the "All" view
      const last = d.sounds.findLastIndex((s) => s.category === category);
      let at = last === -1 ? d.sounds.length : last + 1;
      let count = 0;
      for (const s of fresh) {
        const file = `${pack.id}-${s.file}`;
        try {
          await fsp.copyFile(path.join(pack.dir, s.file), path.join(this.soundsDir, file));
        } catch (err) {
          console.error(`Could not install ${pack.id}/${s.file}`, err);
          continue;
        }
        d.installedSounds.push(soundKey(pack, s));
        // a redone take swaps in where the old one sits, keeping its hotkey, volume and favorite
        const old = (s.replaces || []).map((id) => d.sounds.find((x) => x.file === `${pack.id}-${id}.flac`)).find(Boolean);
        if (old) {
          await fsp.unlink(path.join(this.soundsDir, old.file)).catch(() => {}); // before the folder scan sees it
          Object.assign(old, { file, name: s.name, emoji: s.emoji, color: s.color, tags: cleanTags(s.tags) });
          continue;
        }
        const hotkey = s.hotkey && !taken.has(s.hotkey.toLowerCase()) ? s.hotkey : null;
        if (hotkey) taken.add(hotkey.toLowerCase());
        d.sounds.splice(at++, 0, this.makeSound({ ...s, file, hotkey, category }));
        count++;
      }
      if (count) added.push({ id: pack.id, name: pack.name, category, count });
    }
    // two packs can feed one board ("Airplane" + its second batch): report boards, not packs
    const byBoard = new Map();
    for (const a of added) {
      const prev = byBoard.get(a.category);
      byBoard.set(a.category, prev ? { ...prev, count: prev.count + a.count } : a);
    }
    return [...byBoard.values()];
  }

  backfillTags(pack) {
    for (const s of pack.sounds) {
      const mine = this.data.sounds.find((x) => x.file === `${pack.id}-${s.file}`);
      if (mine && !mine.tags.length && s.tags?.length) mine.tags = cleanTags(s.tags);
    }
  }

  addSlots() {
    const before = this.data.categories.findIndex((c) => c.id === 'mine');
    const cat = { id: 'itysl', name: 'I Think You Should Leave', emoji: '🌭' };
    if (before === -1) this.data.categories.push(cat);
    else this.data.categories.splice(before, 0, cat);
    for (const [name, emoji, color, search] of ITYSL_SLOTS) {
      this.data.sounds.push(this.makeSound({ name, emoji, color, search, file: null, category: 'itysl' }));
    }
  }

  makeSound(s) {
    return {
      id: newId(),
      name: s.name || 'New sound',
      emoji: s.emoji || pick(EMOJIS),
      color: s.color || pick(COLORS),
      category: s.category || 'mine',
      file: s.file ?? null,
      volume: typeof s.volume === 'number' ? s.volume : 1,
      hotkey: s.hotkey || null,
      favorite: !!s.favorite,
      search: s.search || null,
      tags: cleanTags(s.tags),
    };
  }

  find(id) {
    return this.data.sounds.find((s) => s.id === id);
  }

  filePath(sound) {
    return sound?.file ? path.join(this.soundsDir, sound.file) : null;
  }

  async readSound(id) {
    const p = this.filePath(this.find(id));
    if (!p) throw new Error('This slot has no clip yet');
    return fsp.readFile(p);
  }

  update(id, patch) {
    const s = this.find(id);
    if (!s) return;
    for (const key of ['name', 'emoji', 'color', 'category', 'volume', 'hotkey', 'favorite']) {
      if (key in patch) s[key] = patch[key];
    }
    if ('tags' in patch) s.tags = cleanTags(patch.tags);
    if (typeof s.name === 'string') s.name = s.name.slice(0, 80);
    if (typeof s.volume === 'number') s.volume = Math.max(0, Math.min(2, s.volume));
    this.changed();
  }

  /** Remove a hotkey from every sound that uses it (except `exceptId`). Returns names that lost it. */
  releaseHotkey(accel, exceptId) {
    const lost = [];
    for (const s of this.data.sounds) {
      if (s.id !== exceptId && s.hotkey && s.hotkey.toLowerCase() === accel.toLowerCase()) {
        s.hotkey = null;
        lost.push(s.name);
      }
    }
    return lost;
  }

  async remove(id) {
    const s = this.find(id);
    if (!s) return;
    this.data.sounds = this.data.sounds.filter((x) => x.id !== id);
    this.changed();
    const p = this.filePath(s);
    if (p && !this.data.sounds.some((x) => x.file === s.file)) await this.trash(p).catch(() => {});
  }

  /** Reorder a (possibly filtered) subset of sounds; everything else keeps its slot. */
  reorder(ids) {
    const set = new Set(ids);
    const slots = [];
    this.data.sounds.forEach((s, i) => set.has(s.id) && slots.push(i));
    const byId = new Map(this.data.sounds.map((s) => [s.id, s]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    if (ordered.length !== slots.length) return;
    slots.forEach((slotIndex, k) => (this.data.sounds[slotIndex] = ordered[k]));
    this.changed();
  }

  // ------------------------------------------------------------------ categories

  addCategory({ name, emoji }) {
    const id = `${slug(name)}-${newId().slice(0, 4)}`;
    this.data.categories.push({ id, name: name || 'New board', emoji: emoji || '📁' });
    this.changed();
    return id;
  }

  updateCategory(id, patch) {
    const c = this.data.categories.find((x) => x.id === id);
    if (!c) return;
    if (patch.name) c.name = String(patch.name).slice(0, 40);
    if (patch.emoji) c.emoji = patch.emoji;
    this.changed();
  }

  async removeCategory(id) {
    if (id === 'mine') return;
    const doomed = this.data.sounds.filter((s) => s.category === id);
    this.data.categories = this.data.categories.filter((c) => c.id !== id);
    this.data.sounds = this.data.sounds.filter((s) => s.category !== id);
    this.changed();
    for (const s of doomed) {
      const p = this.filePath(s);
      if (p) await this.trash(p).catch(() => {});
    }
  }

  // ------------------------------------------------------------------ importing

  async copyIn(srcPath, name) {
    const ext = path.extname(srcPath).toLowerCase();
    const file = `${slug(name)}-${newId().slice(0, 5)}${ext}`;
    await fsp.copyFile(srcPath, path.join(this.soundsDir, file));
    return file;
  }

  async writeIn(buffer, name, ext) {
    const file = `${slug(name)}-${newId().slice(0, 5)}${ext}`;
    await fsp.writeFile(path.join(this.soundsDir, file), buffer);
    return file;
  }

  fillSlotOrAdd(file, name, { category, slotId } = {}) {
    const slot = slotId && this.find(slotId);
    if (slot) {
      const old = slot.file;
      slot.file = file;
      this.changed();
      if (old && old !== file) this.trash(path.join(this.soundsDir, old)).catch(() => {});
      return slot.id;
    }
    const valid = this.data.categories.some((c) => c.id === category);
    const s = this.makeSound({ name, file, category: valid ? category : 'mine' });
    this.data.sounds.push(s);
    this.changed();
    return s.id;
  }

  importFiles(paths, opts = {}) {
    return this.guarded(() => this._importFiles(paths, opts));
  }

  async _importFiles(paths, opts) {
    const result = { added: [], packs: [], errors: [] };
    let slotId = opts.slotId;
    for (const p of paths) {
      const ext = path.extname(p).toLowerCase();
      try {
        if (PACK_EXT.has(ext)) {
          result.packs.push(await this._importPack(p));
        } else if (AUDIO_EXT.has(ext)) {
          const stat = await fsp.stat(p);
          if (stat.size > MAX_BYTES) throw new Error('is bigger than 40 MB');
          const name = prettyName(p);
          const file = await this.copyIn(p, name);
          result.added.push(this.fillSlotOrAdd(file, name, { category: opts.category, slotId }));
          slotId = null; // only the first file fills a slot
        } else {
          throw new Error('is not an audio file');
        }
      } catch (err) {
        result.errors.push(`${path.basename(p)} ${err.message}`);
      }
    }
    return result;
  }

  importBuffer(buffer, { name, ext }, opts = {}) {
    if (buffer.length > MAX_BYTES) throw new Error('That file is bigger than 40 MB');
    return this.guarded(async () => this.fillSlotOrAdd(await this.writeIn(buffer, name, ext), name, opts));
  }

  importPack(zipPath) {
    return this.guarded(() => this._importPack(zipPath));
  }

  async _importPack(zipPath) {
    const files = unzipSync(new Uint8Array(await fsp.readFile(zipPath)));
    const manifestKey = Object.keys(files).find((k) => k.split('/').pop() === 'pack.json');
    let manifest = null;
    if (manifestKey) manifest = JSON.parse(strFromU8(files[manifestKey]));
    const base = manifestKey ? manifestKey.slice(0, -'pack.json'.length) : '';

    // A plain zip of audio files works too.
    const entries = manifest?.sounds?.length
      ? manifest.sounds.map((s) => ({ ...s, key: base + s.file }))
      : Object.keys(files)
          .filter((k) => AUDIO_EXT.has(path.extname(k).toLowerCase()) && !k.startsWith('__MACOSX'))
          .map((k) => ({ key: k, name: prettyName(k) }));
    if (!entries.length) throw new Error('No sounds found in that pack');

    const packName = manifest?.name || prettyName(zipPath);
    let catName = packName;
    for (let n = 2; this.data.categories.some((c) => c.name === catName); n++) catName = `${packName} ${n}`;
    const category = `${slug(catName)}-${newId().slice(0, 4)}`;
    this.data.categories.push({ id: category, name: catName, emoji: manifest?.emoji || '📦' });

    let count = 0;
    for (const e of entries) {
      const bytes = files[e.key];
      if (!bytes) {
        if (!e.file) this.data.sounds.push(this.makeSound({ ...e, category, hotkey: null, file: null }));
        continue;
      }
      const ext = path.extname(e.key).toLowerCase();
      if (!AUDIO_EXT.has(ext)) continue;
      const file = await this.writeIn(Buffer.from(bytes), e.name || prettyName(e.key), ext);
      this.data.sounds.push(this.makeSound({ ...e, file, category, hotkey: null, favorite: false }));
      count++;
    }
    this.changed();
    return { category, name: catName, count };
  }

  async exportPack(categoryId, destPath) {
    const cat = this.data.categories.find((c) => c.id === categoryId);
    const sounds = this.data.sounds.filter((s) => (categoryId === 'all' || s.category === categoryId) && s.file);
    const zip = {};
    const manifest = {
      format: 'sloppy-potato-pack',
      version: 1,
      name: cat ? cat.name : 'My Soundboard',
      emoji: cat ? cat.emoji : '🥔',
      sounds: [],
    };
    for (const s of sounds) {
      const file = `sounds/${s.file}`;
      zip[file] = [new Uint8Array(await fsp.readFile(this.filePath(s))), { level: 0 }];
      manifest.sounds.push({ name: s.name, emoji: s.emoji, color: s.color, volume: s.volume, tags: s.tags, file });
    }
    zip['pack.json'] = strToU8(JSON.stringify(manifest, null, 2));
    await fsp.writeFile(destPath, zipSync(zip));
    return { count: sounds.length };
  }

  // ------------------------------------------------------------------ folder sync

  /** Pick up audio files dropped straight into the sounds folder, forget deleted ones. */
  async scan() {
    if (this.busy) {
      clearTimeout(this.scanTimer);
      this.scanTimer = setTimeout(() => this.scan(), 700);
      return;
    }
    let names;
    try {
      names = await fsp.readdir(this.soundsDir);
    } catch {
      return;
    }
    const present = new Set(names);
    const known = new Set(this.data.sounds.map((s) => s.file).filter(Boolean));
    let dirty = false;

    const before = this.data.sounds.length;
    this.data.sounds = this.data.sounds.filter((s) => !s.file || present.has(s.file));
    if (this.data.sounds.length !== before) dirty = true;

    for (const name of names) {
      if (known.has(name) || !AUDIO_EXT.has(path.extname(name).toLowerCase())) continue;
      this.data.sounds.push(this.makeSound({ name: prettyName(name), file: name, category: 'mine' }));
      dirty = true;
    }
    if (dirty) this.changed();
  }

  watch() {
    try {
      this.watcher = fs.watch(this.soundsDir, () => {
        clearTimeout(this.scanTimer);
        this.scanTimer = setTimeout(() => this.scan(), 700);
      });
    } catch (err) {
      console.error('watch failed', err);
    }
  }

  close() {
    this.watcher?.close();
    this.store.flush();
  }
}

module.exports = { Library, AUDIO_EXT, PACK_EXT, prettyName };
