const path = require('node:path');
const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const { Library, AUDIO_EXT, PACK_EXT } = require('./library');
const { JsonStore, SETTINGS_DEFAULTS } = require('./store');
const { WinAudio, VBCABLE_PAGE, isCableCapture } = require('./winaudio');
const { fetchAudio } = require('./fetch-audio');
const { Updater } = require('./updater');

const RES = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'resources');
const DEV = !app.isPackaged;
if (DEV && process.env.POTATO_USER_DATA) app.setPath('userData', process.env.POTATO_USER_DATA);
const startHidden = process.argv.includes('--hidden');

let win = null;
let tray = null;
let library = null;
let settings = null;
let winaudio = null;
let updater = null;
let whatsNew = null;
let quitting = false;
let hotkeysSuspended = false;
let hotkeyFailures = [];
const pendingPacks = [];

app.setAppUserModelId('com.sloppypotato.board');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    showWindow();
    importPacksFromArgs(argv);
  });
  app.whenReady().then(boot);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function toast(message, kind = 'info') {
  send('app:toast', { message, kind });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------------------------------------------------------------------------- boot

async function boot() {
  const userDir = app.getPath('userData');
  settings = new JsonStore(path.join(userDir, 'settings.json'), SETTINGS_DEFAULTS);
  settings.load();
  settings.data.hotkeys = { ...SETTINGS_DEFAULTS.hotkeys, ...settings.data.hotkeys };

  winaudio = new WinAudio(RES);
  library = new Library(userDir, RES, { trash: (p) => shell.trashItem(p) });
  await library.init();
  library.on('change', (data) => {
    send('library:changed', data);
    applyHotkeys();
  });

  // What changed since the last launch (shown once as a toast).
  const version = app.getVersion();
  const previous = settings.data.lastVersion || (settings.data.setupDone ? '1.0.0' : null);
  if (previous !== version || library.newPacks.length) {
    whatsNew = { from: previous !== version ? previous : null, version, packs: library.fresh ? [] : library.newPacks };
  }
  settings.data.lastVersion = version;
  settings.save();

  updater = new Updater({ send, beforeInstall: shutdown, logFile: path.join(userDir, 'updater.log') });

  registerIpc();
  createWindow();
  createTray();
  applyHotkeys();
  importPacksFromArgs(process.argv);
  updater.start(settings.data.autoUpdate !== false);

  if (settings.data.manageDefaultMic) {
    useCableAsDefaultMic().catch((err) => console.warn('default mic', err.message));
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1260,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: '#0b0912',
    title: 'Sloppy Potato Board',
    icon: path.join(RES, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep audio + hotkeys snappy while a game has focus
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  if (DEV && process.env.POTATO_DEBUG_SCRIPT) {
    // Dev-only automation hook used to screenshot / smoke-test the UI.
    win.webContents.on('console-message', (e, level, message) => console.log('[renderer]', e.message ?? message));
    win.webContents.once('did-finish-load', () => {
      require(path.resolve(process.env.POTATO_DEBUG_SCRIPT))({ app, win, library, settings }).catch((err) => console.error(err));
    });
  }
  win.once('ready-to-show', () => {
    if (!startHidden) win.show();
  });
  win.on('close', (e) => {
    if (quitting || !settings.data.closeToTray) return;
    e.preventDefault();
    win.hide();
    if (!settings.data.trayHintShown) {
      settings.data.trayHintShown = true;
      settings.save();
      tray?.displayBalloon?.({
        title: 'Still here!',
        content: 'Sloppy Potato Board is running in the tray so your hotkeys keep working.',
        iconType: 'info',
      });
    }
  });
  win.on('maximize', () => send('win:state', { maximized: true }));
  win.on('unmaximize', () => send('win:state', { maximized: false }));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Dropping a file outside a drop zone must never navigate the app away.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(RES, 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Sloppy Potato Board');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Sloppy Potato Board', click: showWindow },
      { label: 'Stop all sounds', click: () => send('hotkey', { type: 'stopAll' }) },
      { label: 'Mute / unmute mic', click: () => send('hotkey', { type: 'toggleMute' }) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', showWindow);
}

// ---------------------------------------------------------------------------- hotkeys

function applyHotkeys() {
  globalShortcut.unregisterAll();
  hotkeyFailures = [];
  if (hotkeysSuspended) return send('hotkeys:status', hotkeyFailures);

  const register = (accel, ref, payload) => {
    if (!accel) return;
    let ok = false;
    try {
      ok = globalShortcut.register(accel, () => send('hotkey', payload));
    } catch {
      ok = false;
    }
    if (!ok) hotkeyFailures.push(ref);
  };

  for (const s of library.data.sounds) {
    if (s.hotkey && s.file) register(s.hotkey, s.id, { type: 'play', id: s.id });
  }
  for (const [action, accel] of Object.entries(settings.data.hotkeys)) {
    register(accel, action, { type: action });
  }
  send('hotkeys:status', hotkeyFailures);
}

/** Make sure an accelerator is only bound once; returns what lost it. */
function claimHotkey(accel, { soundId = null, action = null } = {}) {
  if (!accel) return [];
  const lost = library.releaseHotkey(accel, soundId);
  for (const [k, v] of Object.entries(settings.data.hotkeys)) {
    if (k !== action && v && v.toLowerCase() === accel.toLowerCase()) {
      settings.data.hotkeys[k] = null;
      lost.push(k === 'stopAll' ? 'Stop all' : k === 'toggleMute' ? 'Mute mic' : 'Switch mode');
    }
  }
  return lost;
}

// ---------------------------------------------------------------------------- default mic

async function useCableAsDefaultMic() {
  const endpoints = await winaudio.list();
  const cable = endpoints.find((e) => e.flow === 'capture' && isCableCapture(e.name));
  if (!cable) throw new Error('Install the virtual mic first');
  const current = endpoints.find((e) => e.flow === 'capture' && e.isDefault);
  if (current && current.id !== cable.id) {
    settings.data.previousDefaultMic = { id: current.id, name: current.name };
  }
  if (!current || current.id !== cable.id) await winaudio.setDefault(cable.id);
  settings.data.manageDefaultMic = true;
  settings.save();
  broadcastSettings();
  return { cable: cable.name, previous: settings.data.previousDefaultMic?.name || null };
}

async function restoreDefaultMic() {
  const prev = settings.data.previousDefaultMic;
  if (!prev) return null;
  const endpoints = await winaudio.list();
  const target =
    endpoints.find((e) => e.flow === 'capture' && e.id === prev.id) ||
    endpoints.find((e) => e.flow === 'capture' && e.name === prev.name);
  if (target && !target.isDefault) await winaudio.setDefault(target.id);
  return target?.name || null;
}

// ---------------------------------------------------------------------------- packs via argv / double-click

function importPacksFromArgs(argv) {
  const packs = argv.slice(1).filter((a) => PACK_EXT.has(path.extname(a).toLowerCase()) && !a.startsWith('-'));
  if (!packs.length) return;
  if (!win || win.webContents.isLoading()) {
    pendingPacks.push(...packs);
    return;
  }
  for (const p of packs) {
    library
      .importPack(p)
      .then((r) => toast(`Added "${r.name}" with ${r.count} sounds`, 'success'))
      .catch((err) => toast(`Couldn't import ${path.basename(p)}: ${err.message}`, 'error'));
  }
}

// ---------------------------------------------------------------------------- IPC

function broadcastSettings() {
  send('settings:changed', settings.data);
}

function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, (_e, ...args) => fn(...args));

  handle('app:init', () => {
    if (pendingPacks.length) setTimeout(() => importPacksFromArgs(['', ...pendingPacks.splice(0)]), 500);
    return {
      library: library.data,
      settings: settings.data,
      hotkeyFailures,
      version: app.getVersion(),
      soundsDir: library.soundsDir,
      audioExtensions: [...AUDIO_EXT],
      update: updater.state,
      whatsNew: whatsNew && (whatsNew.from || whatsNew.packs.length) ? whatsNew : null,
    };
  });

  // updates ---------------------------------------------------------------
  handle('update:check', () => updater.check());
  handle('update:install', () => updater.install());

  // library ---------------------------------------------------------------
  handle('library:update', (id, patch) => {
    let lost = [];
    if (patch.hotkey) lost = claimHotkey(patch.hotkey, { soundId: id });
    library.update(id, patch);
    if (lost.length) {
      settings.save();
      broadcastSettings();
    }
    return { lost };
  });
  handle('library:remove', (id) => library.remove(id));
  handle('library:restore', (id) => library.restore(id));
  handle('library:reorder', (ids) => library.reorder(ids));
  handle('library:readSound', (id) => library.readSound(id));
  handle('library:importFiles', (paths, opts) => library.importFiles(paths, opts));
  handle('library:importUrl', async (url, opts) => {
    const audio = await fetchAudio(url);
    const id = await library.importBuffer(audio.buffer, audio, opts);
    return { id, name: audio.name };
  });
  handle('library:pickFiles', async (opts) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Add sounds',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Sounds & packs', extensions: [...AUDIO_EXT, ...PACK_EXT].map((e) => e.slice(1)) },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (r.canceled || !r.filePaths.length) return null;
    return library.importFiles(r.filePaths, opts);
  });
  handle('library:addCategory', (c) => library.addCategory(c));
  handle('library:updateCategory', (id, patch) => library.updateCategory(id, patch));
  handle('library:removeCategory', (id) => library.removeCategory(id));
  handle('library:exportPack', async (categoryId) => {
    const cat = library.data.categories.find((c) => c.id === categoryId);
    const base = (cat ? cat.name : 'My Soundboard').replace(/[\\/:*?"<>|]/g, '');
    const r = await dialog.showSaveDialog(win, {
      title: 'Share sound pack',
      defaultPath: path.join(app.getPath('desktop'), `${base}.potatopack`),
      filters: [{ name: 'Sloppy Potato pack', extensions: ['potatopack'] }],
    });
    if (r.canceled || !r.filePath) return null;
    const res = await library.exportPack(categoryId, r.filePath);
    shell.showItemInFolder(r.filePath);
    return { ...res, path: r.filePath };
  });
  handle('library:openFolder', () => shell.openPath(library.soundsDir));

  // settings --------------------------------------------------------------
  handle('settings:set', async (patch) => {
    const s = settings.data;
    let lost = [];
    if (patch.hotkeys) {
      for (const [action, accel] of Object.entries(patch.hotkeys)) {
        if (accel) lost.push(...claimHotkey(accel, { action }));
      }
      patch = { ...patch, hotkeys: { ...s.hotkeys, ...patch.hotkeys } };
    }
    Object.assign(s, patch);
    settings.save();
    if ('autoUpdate' in patch) updater.setAuto(!!patch.autoUpdate);
    if ('openAtLogin' in patch) {
      app.setLoginItemSettings({ openAtLogin: !!patch.openAtLogin, args: ['--hidden'] });
    }
    // The renderer already applied its own patch; only echo back when we changed something else.
    if (lost.length) {
      library.changed(); // re-registers hotkeys too
      broadcastSettings();
    } else if (patch.hotkeys) applyHotkeys();
    return { lost };
  });

  handle('hotkeys:suspend', (on) => {
    hotkeysSuspended = !!on;
    applyHotkeys();
  });

  // windows audio ---------------------------------------------------------
  handle('defaultMic:enable', () => useCableAsDefaultMic());
  handle('defaultMic:disable', async () => {
    const restored = await restoreDefaultMic();
    settings.data.manageDefaultMic = false;
    settings.save();
    broadcastSettings();
    return { restored };
  });
  handle('vbcable:install', () => winaudio.installVbCable((p) => send('vbcable:progress', p)));
  handle('vbcable:page', () => shell.openExternal(VBCABLE_PAGE));

  // window / shell --------------------------------------------------------
  handle('win:minimize', () => win.minimize());
  handle('win:toggleMaximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  handle('win:close', () => win.close());
  handle('app:quit', () => app.quit());
  handle('shell:openExternal', (url) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
  });
}

// ---------------------------------------------------------------------------- shutdown

let cleanedUp = false;
let shuttingDown = null;

/** Release hotkeys, save everything and hand the Windows default mic back. Safe to call twice. */
function shutdown() {
  if (!shuttingDown) {
    shuttingDown = (async () => {
      quitting = true;
      globalShortcut.unregisterAll();
      library?.close();
      settings?.flush();
      if (settings?.data.manageDefaultMic) {
        await Promise.race([restoreDefaultMic().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
      }
      updater?.onQuit();
      cleanedUp = true;
    })();
  }
  return shuttingDown;
}

app.on('before-quit', (e) => {
  quitting = true;
  if (cleanedUp) return;
  e.preventDefault();
  shutdown().finally(() => app.quit());
});

// With close-to-tray the window is only hidden, so this fires only when the user really closed it.
app.on('window-all-closed', () => app.quit());
