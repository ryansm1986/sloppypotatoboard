// Renders build/icon.svg + build/tray.svg to PNGs using Electron's own Chromium.
// Usage: npx electron tools/render-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {}); // keep running between renders

const jobs = [
  { svg: 'build/icon.svg', size: 1024, out: 'build/icon-1024.png' },
  { svg: 'build/icon.svg', size: 512, out: 'resources/icon.png' },
  { svg: 'build/tray.svg', size: 32, out: 'resources/tray.png' },
  { svg: 'build/tray.svg', size: 64, out: 'resources/tray@2x.png' },
];

app.whenReady().then(async () => {
  for (const j of jobs) {
    const b64 = fs.readFileSync(path.join(root, j.svg)).toString('base64');
    const win = new BrowserWindow({ width: j.size, height: j.size, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
    const html = `<html><body style="margin:0;background:transparent;overflow:hidden"><img src="data:image/svg+xml;base64,${b64}" width="${j.size}" height="${j.size}" style="display:block"></body></html>`;
    const tmp = path.join(app.getPath('temp'), `potato-icon-${j.size}.html`);
    fs.writeFileSync(tmp, html);
    await win.loadFile(tmp);
    await new Promise((r) => setTimeout(r, 400));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: j.size, height: j.size });
    fs.writeFileSync(path.join(root, j.out), img.toPNG());
    console.log(j.out, img.getSize());
    win.destroy();
  }
  app.quit();
});
