// Updates come from GitHub Releases (ryansm1986/sloppypotatoboard).
//
//   installer build -> electron-updater downloads in the background, installs on restart
//   portable build  -> we download the new portable exe next to the current one and swap
//                      it in after the app exits, then relaunch
//   dev (npm start) -> only checks and tells you
const fs = require('node:fs');
const fsp = fs.promises;
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { app, net, shell } = require('electron');

const OWNER = 'ryansm1986';
const REPO = 'sloppypotatoboard';
const RELEASES_PAGE = `https://github.com/${OWNER}/${REPO}/releases/latest`;
const FIRST_CHECK = 6000;
const CHECK_EVERY = 4 * 60 * 60 * 1000;

function isNewer(a, b) {
  const pa = String(a).split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

const notesText = (notes) =>
  (Array.isArray(notes) ? notes.map((n) => n.note).join('\n') : notes || '')
    .replace(/<[^>]+>/g, '')
    .trim()
    .slice(0, 1200);

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

class Updater {
  constructor({ send, beforeInstall, logFile }) {
    this.send = send;
    this.beforeInstall = beforeInstall;
    this.logFile = logFile;
    this.portableExe = process.env.PORTABLE_EXECUTABLE_FILE || null;
    this.mode = !app.isPackaged ? 'dev' : this.portableExe ? 'portable' : 'installer';
    this.state = { status: 'idle', current: app.getVersion(), mode: this.mode };
    this.au = null;
    this.pending = null;
    this.timer = null;
  }

  log(...parts) {
    const line = `${new Date().toISOString()} ${parts.join(' ')}\n`;
    fs.appendFile(this.logFile, line, () => {});
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    if (patch.status && patch.status !== 'downloading') this.log('status', patch.status, patch.latest || '', patch.error || '');
    this.send('update:status', this.state);
    return this.state;
  }

  start(auto = true) {
    if (this.mode === 'installer') this.setupElectronUpdater();
    this.setAuto(auto);
  }

  setAuto(auto) {
    clearTimeout(this.first);
    clearInterval(this.timer);
    if (!auto) return;
    this.first = setTimeout(() => this.check(), FIRST_CHECK);
    this.timer = setInterval(() => this.check(), CHECK_EVERY);
  }

  setupElectronUpdater() {
    const { autoUpdater } = require('electron-updater');
    this.au = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: (m) => this.log('info', m), warn: (m) => this.log('warn', m), error: (m) => this.log('error', m), debug() {} };
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }));
    autoUpdater.on('update-not-available', () => this.set({ status: 'current', checkedAt: Date.now() }));
    autoUpdater.on('update-available', (i) =>
      this.set({ status: 'downloading', latest: i.version, percent: 0, notes: notesText(i.releaseNotes) }),
    );
    autoUpdater.on('download-progress', (p) => {
      const percent = Math.floor(p.percent);
      if (percent !== this.state.percent) this.set({ status: 'downloading', percent });
    });
    autoUpdater.on('update-downloaded', (i) => this.set({ status: 'ready', latest: i.version, percent: 100 }));
    autoUpdater.on('error', (err) => this.set({ status: 'error', error: friendly(err) }));
  }

  async check() {
    if (['checking', 'downloading', 'ready'].includes(this.state.status)) return this.state;
    try {
      if (this.au) {
        await this.au.checkForUpdates();
        return this.state;
      }
      this.set({ status: 'checking' });
      const rel = await this.latestRelease();
      const latest = rel?.tag_name?.replace(/^v/, '');
      if (!latest || !isNewer(latest, app.getVersion())) return this.set({ status: 'current', checkedAt: Date.now() });
      const notes = notesText(rel.body);
      const asset = rel.assets?.find((a) => /portable.*\.exe$/i.test(a.name));
      if (this.mode === 'portable' && asset) return await this.downloadPortable(asset, latest, notes);
      return this.set({ status: 'available', latest, notes, url: rel.html_url || RELEASES_PAGE });
    } catch (err) {
      return this.set({ status: 'error', error: friendly(err) });
    }
  }

  async latestRelease() {
    const res = await net.fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SloppyPotatoBoard-Updater' },
    });
    if (res.status === 404) return null; // no releases yet
    if (!res.ok) throw new Error(`GitHub said ${res.status}`);
    return res.json();
  }

  /** Portable: fetch the new exe next to the running one (same drive, so the swap is a rename). */
  async downloadPortable(asset, latest, notes) {
    const target = `${this.portableExe}.update`;
    this.set({ status: 'downloading', latest, notes, percent: 0 });
    try {
      const res = await net.fetch(asset.browser_download_url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const total = Number(res.headers.get('content-length')) || asset.size || 1;
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(target);
      const reader = res.body.getReader();
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        if (!out.write(value)) await new Promise((r) => out.once('drain', r));
        got += value.length;
        const percent = Math.floor((got / total) * 100);
        if (percent !== this.state.percent) this.set({ status: 'downloading', percent });
      }
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
      if (asset.size && got !== asset.size) throw new Error('Download was incomplete');
      const digest = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : null;
      if (digest && digest !== hash.digest('hex')) throw new Error('Download failed its checksum');
      this.pending = { file: target, exe: this.portableExe };
      return this.set({ status: 'ready', latest, percent: 100 });
    } catch (err) {
      await fsp.unlink(target).catch(() => {});
      this.log('portable download failed', err.message);
      // fall back to sending them to the download page
      return this.set({ status: 'available', latest, notes, url: RELEASES_PAGE, error: friendly(err) });
    }
  }

  async install() {
    const s = this.state.status;
    if (s === 'available') return shell.openExternal(this.state.url || RELEASES_PAGE);
    if (s !== 'ready') return;
    await this.beforeInstall();
    if (this.au) {
      this.au.quitAndInstall(true, true); // silent install, then relaunch
      return;
    }
    if (this.pending) {
      // Wait for this copy (and the portable launcher) to exit, swap the exe, relaunch.
      const { file, exe } = this.pending;
      const script = [
        `$new = ${psQuote(file)}; $exe = ${psQuote(exe)}`,
        'for ($i = 0; $i -lt 120; $i++) {',
        '  try { Move-Item -LiteralPath $new -Destination $exe -Force -ErrorAction Stop; break } catch { Start-Sleep -Milliseconds 500 }',
        '}',
        'Start-Process -FilePath $exe',
      ].join('\n');
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
      app.quit();
    }
  }
}

function friendly(err) {
  const msg = err?.message || String(err);
  if (/ENOTFOUND|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|net::/i.test(msg)) return "Couldn't reach GitHub. Are you online?";
  if (/404/.test(msg)) return 'No releases published yet';
  return msg.split('\n')[0].slice(0, 200);
}

module.exports = { Updater, isNewer };
