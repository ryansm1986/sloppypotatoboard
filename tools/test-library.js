// Smoke test for electron/library.js (no Electron needed): node tools/test-library.js
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Library } = require('../electron/library');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'potato-lib-'));
  const res = path.join(__dirname, '..', 'resources');
  const lib = new Library(path.join(tmp, 'user'), res);
  await lib.init();
  const d = () => lib.data;

  const airplane = d().sounds.filter((s) => s.category === 'airplane');
  const slots = d().sounds.filter((s) => s.category === 'itysl');
  assert.equal(airplane.length, 41, 'seeds both airplane batches into one board');
  assert.equal(d().sounds.filter((s) => s.category === 'cockpit').length, 10, 'seeds the cockpit board');
  assert.deepEqual(d().categories.map((c) => c.id), ['airplane', 'cockpit', 'itysl', 'mine']);
  assert.equal(d().installedSounds.length, 19 + 22 + 10, 'remembers every bundled sound it installed');
  assert.ok(slots.length >= 5 && slots.every((s) => !s.file), 'seeds empty ITYSL slots');
  assert.equal(airplane[0].hotkey, 'num1');
  assert.deepEqual(airplane[0].tags, ['chime']);
  assert.ok(d().sounds.find((s) => s.name === 'Lock-On').tags.includes('lock-on'));

  // a fresh library restarted doesn't reinstall anything
  lib.close();
  const again = new Library(path.join(tmp, 'user'), res);
  await again.init();
  assert.equal(again.data.sounds.length, d().sounds.length, 'no duplicate packs on restart');
  again.close();

  // a sound the user deleted stays deleted; a sound new to an existing pack shows up
  {
    const doomed = d().sounds.find((s) => s.name === 'Tuna Sandwich');
    await lib.remove(doomed.id);
    d().installedSounds = d().installedSounds.filter((k) => k !== 'airplane-2/fasten-seatbelt');
    d().sounds = d().sounds.filter((s) => s.file !== 'airplane-2-fasten-seatbelt.flac');
    lib.store.save(true);
    lib.close();
    const re = new Library(path.join(tmp, 'user'), res);
    await re.init();
    assert.ok(!re.data.sounds.some((s) => s.name === 'Tuna Sandwich'), 'deleted pack sound is not re-added');
    assert.ok(re.data.sounds.some((s) => s.name === 'Fasten Seatbelt Sign'), 'new sound in an existing pack is added');
    assert.deepEqual(re.newPacks.map((p) => [p.category, p.count]), [['airplane', 1]]);
    re.close();
    await lib.init();
  }

  // a redone take swaps in for the old one: same spot, hotkey kept, old file gone, nothing duplicated
  {
    const redo = d().sounds.find((s) => s.file === 'airplane-2-rain-destination.flac');
    const at = d().sounds.indexOf(redo);
    fs.renameSync(path.join(lib.soundsDir, redo.file), path.join(lib.soundsDir, 'airplane-2-rain-monotone.flac'));
    Object.assign(redo, { file: 'airplane-2-rain-monotone.flac', name: 'Monotone Captain: Rain', hotkey: 'F7', favorite: true });
    d().installedSounds = d().installedSounds.map((k) => (k === 'airplane-2/rain-destination' ? 'airplane-2/rain-monotone' : k));
    const count = d().sounds.length;
    lib.store.save(true);
    lib.close();
    const re = new Library(path.join(tmp, 'user'), res);
    await re.init();
    const s = re.data.sounds[at];
    assert.equal(s.id, redo.id, 'replaces in place');
    assert.equal(s.name, 'Rain At Destination');
    assert.equal(s.file, 'airplane-2-rain-destination.flac');
    assert.equal(s.hotkey, 'F7', 'keeps the hotkey');
    assert.equal(s.favorite, true, 'keeps the favorite');
    assert.ok(!fs.existsSync(path.join(re.soundsDir, 'airplane-2-rain-monotone.flac')), 'old take is deleted');
    assert.equal(re.data.sounds.length, count, 'nothing added or re-imported');
    assert.deepEqual(re.newPacks, [], 'a redo is not announced as a new sound');
    re.close();
    await lib.init();
  }

  // upgrading a 1.0 library: only the new sounds get added, tags get backfilled
  const oldDir = path.join(tmp, 'old');
  fs.mkdirSync(path.join(oldDir, 'sounds'), { recursive: true });
  const v1 = { version: 1, categories: [{ id: 'airplane', name: 'Airplane', emoji: '✈️' }, { id: 'itysl', name: 'ITYSL', emoji: '🌭' }, { id: 'mine', name: 'My Sounds', emoji: '🥔' }], sounds: [] };
  for (const f of ['seatbelt.flac', 'no-healer.flac']) {
    fs.copyFileSync(path.join(res, 'packs', 'airplane', f), path.join(oldDir, 'sounds', `airplane-${f}`));
    v1.sounds.push({ id: f, name: f, emoji: 'x', color: '#fff', category: 'airplane', file: `airplane-${f}`, volume: 1, hotkey: f === 'seatbelt.flac' ? 'num1' : null, favorite: false, search: null });
  }
  v1.sounds.push({ id: 'mine1', name: 'mine', emoji: 'x', color: '#fff', category: 'mine', file: null, volume: 1, hotkey: null, favorite: false, search: 'x' });
  fs.writeFileSync(path.join(oldDir, 'library.json'), JSON.stringify(v1));
  const up = new Library(oldDir, res);
  await up.init();
  assert.deepEqual(up.data.categories.map((c) => c.id), ['airplane', 'cockpit', 'itysl', 'mine'], 'new board slots in before ITYSL');
  assert.equal(up.data.sounds.filter((s) => s.category === 'airplane').length, 2 + 22, 'adds batch 2, not batch 1 again');
  assert.equal(up.data.sounds[2].category, 'airplane', 'batch 2 lands right after the existing airplane sounds');
  assert.deepEqual(up.data.sounds[0].tags, ['chime'], 'backfills tags');
  assert.deepEqual(up.newPacks.map((p) => [p.name, p.count]), [['Airplane', 22], ['Cockpit', 10]], 'reports new sounds per board');
  up.close();

  // tags can be edited and are cleaned up
  lib.update(airplane[0].id, { tags: ['Chime', ' chime ', 'Loud'] });
  assert.deepEqual(lib.find(airplane[0].id).tags, ['chime', 'loud']);

  // import a file into a slot, and one as a new sound
  const src = path.join(res, 'packs', 'airplane', 'seatbelt.flac');
  let r = await lib.importFiles([src], { slotId: slots[0].id });
  assert.equal(r.added[0], slots[0].id, 'fills the slot');
  assert.ok(lib.find(slots[0].id).file, 'slot now has a file');
  r = await lib.importFiles([src, path.join(tmp, 'nope.txt')], { category: 'mine' });
  assert.equal(r.added.length, 1);
  assert.equal(r.errors.length, 1, 'rejects non-audio');
  assert.equal(lib.find(r.added[0]).category, 'mine');

  // hotkey release
  const lost = lib.releaseHotkey('NUM1', airplane[1].id);
  assert.deepEqual(lost, ['Seatbelt Sign']);

  // reorder a subset
  const ids = d().sounds.filter((s) => s.category === 'airplane').map((s) => s.id);
  lib.reorder([...ids].reverse());
  assert.equal(d().sounds.filter((s) => s.category === 'airplane')[0].id, ids[ids.length - 1]);
  assert.equal(d().sounds.findIndex((s) => s.category === 'cockpit') > 30, true, 'other sounds keep their slots');

  // pack roundtrip
  const pack = path.join(tmp, 'Airplane.potatopack');
  const ex = await lib.exportPack('airplane', pack);
  assert.equal(ex.count, 40);
  const before = d().sounds.length;
  const im = await lib.importPack(pack);
  assert.equal(im.count, 40);
  assert.equal(im.name, 'Airplane 2', 'dedupes the board name');
  assert.equal(d().sounds.length, before + 40);
  assert.ok(d().sounds.filter((s) => s.category === im.category).every((s) => s.tags.length), 'tags travel with packs');
  assert.ok(d().sounds.filter((s) => s.category === im.category).every((s) => !s.hotkey), 'hotkeys are not imported');

  // files dropped straight into the folder get picked up
  fs.copyFileSync(src, path.join(lib.soundsDir, 'Dropped_In_File.flac'));
  await lib.scan();
  assert.ok(d().sounds.some((s) => s.name === 'Dropped In File'), 'folder scan adds new files');

  // remove
  const victim = d().sounds.find((s) => s.name === 'Dropped In File');
  await lib.remove(victim.id);
  assert.ok(!fs.existsSync(path.join(lib.soundsDir, victim.file)));

  lib.close();
  console.log('library ok:', d().sounds.length, 'sounds,', d().categories.length, 'boards');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
