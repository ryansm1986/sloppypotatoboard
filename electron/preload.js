const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('potato', {
  init: invoke('app:init'),
  library: {
    update: invoke('library:update'),
    remove: invoke('library:remove'),
    restore: invoke('library:restore'),
    reorder: invoke('library:reorder'),
    readSound: invoke('library:readSound'),
    importFiles: invoke('library:importFiles'),
    importUrl: invoke('library:importUrl'),
    pickFiles: invoke('library:pickFiles'),
    addCategory: invoke('library:addCategory'),
    updateCategory: invoke('library:updateCategory'),
    removeCategory: invoke('library:removeCategory'),
    exportPack: invoke('library:exportPack'),
    openFolder: invoke('library:openFolder'),
  },
  settings: { set: invoke('settings:set') },
  hotkeys: { suspend: invoke('hotkeys:suspend') },
  defaultMic: { enable: invoke('defaultMic:enable'), disable: invoke('defaultMic:disable') },
  vbcable: { install: invoke('vbcable:install'), openPage: invoke('vbcable:page') },
  update: { check: invoke('update:check'), install: invoke('update:install') },
  win: {
    minimize: invoke('win:minimize'),
    toggleMaximize: invoke('win:toggleMaximize'),
    close: invoke('win:close'),
    quit: invoke('app:quit'),
  },
  openExternal: invoke('shell:openExternal'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  on(channel, fn) {
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
  },
});
