// Dev-only: drives the app and saves screenshots.
//   POTATO_USER_DATA=<tmp dir> POTATO_DEBUG_SCRIPT=tools/debug-run.js npx electron .
const fs = require('node:fs');
const path = require('node:path');

const out = path.join(__dirname, '.cache', 'shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async ({ app, win }) => {
  fs.mkdirSync(out, { recursive: true });
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `${name}.png`), img.toPNG());
    console.log('shot', name, img.getSize());
  };
  const steps = (process.env.POTATO_STEPS || 'main').split(';;').map((s) => s.trim());
  win.show();
  await wait(3500);
  for (const step of steps) {
    if (step === 'main') await shot('main');
    else if (step.startsWith('js0:')) console.log('eval ->', await js(step.slice(4)).catch((e) => e.message));
    else if (step.startsWith('js:')) {
      console.log('eval ->', await js(step.slice(3)).catch((e) => e.message));
      await wait(900);
    } else if (step.startsWith('shot:')) await shot(step.slice(5));
    else if (step.startsWith('wait:')) await wait(Number(step.slice(5)));
    else if (step.startsWith('key:')) {
      // real OS-level key press, to prove global hotkeys fire
      const vk = step.slice(4);
      const ps = `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, int flags, int extra);' -Name K -Namespace W; [W.K]::keybd_event(${vk},0,0,0); Start-Sleep -Milliseconds 40; [W.K]::keybd_event(${vk},0,2,0)`;
      require('node:child_process').execFileSync('powershell.exe', ['-NoProfile', '-Command', ps]);
      console.log('pressed', vk);
      await wait(600);
    }
  }
  if (!process.env.POTATO_KEEP) app.exit(0);
};
