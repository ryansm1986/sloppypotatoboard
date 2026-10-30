const fs = require('node:fs');
const path = require('node:path');

/** Tiny JSON file store with debounced, atomic writes. */
class JsonStore {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.data = structuredClone(defaults);
    this.timer = null;
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...structuredClone(this.defaults), ...raw };
      return true;
    } catch {
      return false;
    }
  }

  save(immediate = false) {
    clearTimeout(this.timer);
    const write = () => {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    };
    if (immediate) write();
    else this.timer = setTimeout(write, 250);
  }

  flush() {
    if (this.timer) this.save(true);
  }
}

const SETTINGS_DEFAULTS = {
  setupDone: false,
  micLabel: null, // the user's real microphone (matched by label)
  monitorLabel: null, // where *you* hear sounds; null = Windows default output
  gameLabel: null, // where the game mix goes; null = auto-detect the virtual cable
  micVolume: 1,
  gameVolume: 0.9,
  monitorVolume: 0.65,
  micMode: 'swap', // 'swap' = mic fades out while a sound plays, 'mix' = both together
  micMuted: false,
  noiseSuppression: false,
  echoCancellation: false,
  allowOverlap: true,
  normalize: true,
  hotkeys: { stopAll: 'num0', toggleMute: 'numdec', toggleMode: null },
  closeToTray: true,
  openAtLogin: false,
  manageDefaultMic: false,
  previousDefaultMic: null,
  trayHintShown: false,
  autoUpdate: true,
  lastVersion: null,
};

module.exports = { JsonStore, SETTINGS_DEFAULTS };
