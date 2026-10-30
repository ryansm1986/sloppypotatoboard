const { execFile } = require('node:child_process');
const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const { net } = require('electron');
const { unzipSync } = require('fflate');

const VBCABLE_URL = 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip';
const VBCABLE_PAGE = 'https://vb-audio.com/Cable/';

const isCableCapture = (name) => /CABLE[^()]*Output/i.test(name || '');

function powershell(args, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
      { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).trim().split('\n')[0]));
        else resolve(stdout);
      },
    );
  });
}

class WinAudio {
  constructor(resourcesDir) {
    this.script = path.join(resourcesDir, 'scripts', 'AudioDevices.ps1');
  }

  async list() {
    const out = await powershell(['-File', this.script, 'list']);
    return JSON.parse(out.trim() || '[]');
  }

  async setDefault(id) {
    const out = await powershell(['-File', this.script, 'set-default', id]);
    return JSON.parse(out.trim() || '[]');
  }

  async findCableCapture() {
    return (await this.list()).find((e) => e.flow === 'capture' && isCableCapture(e.name)) || null;
  }

  /**
   * Downloads the official VB-CABLE driver pack and runs its installer elevated.
   * Windows shows a UAC prompt and then a driver-install confirmation.
   */
  async installVbCable(progress = () => {}) {
    progress({ stage: 'download', pct: 0 });
    const res = await net.fetch(VBCABLE_URL);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || 1_400_000;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      progress({ stage: 'download', pct: Math.min(1, got / total) });
    }
    const zip = Buffer.concat(chunks);

    progress({ stage: 'extract' });
    const dir = path.join(os.tmpdir(), `sloppy-potato-vbcable-${Date.now()}`);
    await fsp.mkdir(dir, { recursive: true });
    for (const [name, bytes] of Object.entries(unzipSync(new Uint8Array(zip)))) {
      if (name.endsWith('/')) continue;
      const out = path.join(dir, path.basename(name));
      await fsp.writeFile(out, bytes);
    }
    const setup = path.join(dir, process.arch === 'ia32' ? 'VBCABLE_Setup.exe' : 'VBCABLE_Setup_x64.exe');
    await fsp.access(setup);

    progress({ stage: 'install' });
    const quoted = setup.replace(/'/g, "''");
    try {
      await powershell(
        ['-Command', `$p = Start-Process -FilePath '${quoted}' -ArgumentList '-i','-h' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`],
        { timeout: 10 * 60 * 1000 },
      );
    } catch (err) {
      if (/cancel/i.test(err.message)) throw new Error('Install was cancelled');
      // The installer's exit code isn't reliable; the renderer checks whether the device appeared.
    }
    progress({ stage: 'done' });
    return { ok: true };
  }
}

module.exports = { WinAudio, VBCABLE_PAGE, isCableCapture };
