<script>
  import { Mic, Headphones, Gamepad2, Keyboard, Sliders, AppWindow, Library, CircleCheck, TriangleAlert, Ear, FolderOpen, Share2, Wand2, RefreshCw, Sparkles, LoaderCircle } from '@lucide/svelte';
  import Modal from './Modal.svelte';
  import Meter from './Meter.svelte';
  import HotkeyInput from './HotkeyInput.svelte';
  import { app, api, levels, setSettings, setListening, toast, cleanError } from '../lib/store.svelte.js';
  import { isCableCapture, isCablePlayback } from '../lib/audio.js';

  const s = $derived(app.settings);
  const micChoices = $derived(app.devices.inputs.filter((d) => !isCableCapture(d.label)));
  const monitorChoices = $derived(app.devices.outputs.filter((d) => !isCablePlayback(d.label)));
  const gameIsCable = $derived(isCablePlayback(app.status.game || ''));
  let defaultBusy = $state(false);
  const close = () => {
    if (app.listening) setListening(false);
    app.modal = null;
  };

  async function toggleDefault() {
    defaultBusy = true;
    try {
      if (s.manageDefaultMic) await api.defaultMic.disable();
      else await api.defaultMic.enable();
    } catch (err) {
      toast(cleanError(err), 'error');
    } finally {
      defaultBusy = false;
    }
  }

  async function shareAll() {
    try {
      const r = await api.library.exportPack('all');
      if (r) toast(`Saved a pack with ${r.count} sounds`, 'success');
    } catch (err) {
      toast(cleanError(err), 'error');
    }
  }

  const u = $derived(app.update || {});
  let checking = $state(false);

  async function checkNow() {
    checking = true;
    try {
      const r = await api.update.check();
      if (r?.status === 'current') toast(`You're on the latest version (${app.version})`, 'success');
    } finally {
      checking = false;
    }
  }

  const ago = (t) => {
    if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  };

  const modeNote = {
    installer: 'Updates download in the background and install when you restart.',
    portable: 'This portable copy updates itself: the new version is swapped in when you restart.',
    dev: 'Running from source, so updates are only checked, not installed.',
  };

  const toggles = {
    mic: [
      ['noiseSuppression', 'Noise suppression', 'Cleans up keyboard clacks and fans (slightly colors your voice)'],
      ['echoCancellation', 'Echo cancellation', 'Turn on if you use speakers instead of headphones'],
    ],
    playback: [
      ['allowOverlap', 'Let sounds overlap', 'Off = starting a sound stops the others'],
      ['normalize', 'Even out loudness', 'Makes quiet and loud clips play at a similar volume'],
    ],
    app: [
      ['closeToTray', 'Keep running in the tray when closed', 'So your hotkeys keep working'],
      ['openAtLogin', 'Start with Windows', 'Launches quietly in the tray'],
    ],
  };
</script>

{#snippet toggleRow([key, label, hint])}
  <div class="row">
    <div class="txt"><b>{label}</b><small>{hint}</small></div>
    <button class="switch" class:on={s[key]} aria-label={label} onclick={() => setSettings({ [key]: !s[key] })}></button>
  </div>
{/snippet}

<Modal title="Settings" width={640} onclose={close}>
  <section>
    <h3><Mic size={15} /> Audio devices</h3>
    <label class="field">
      <span>Your microphone</span>
      <select class="select" value={app.status.mic} onchange={(e) => setSettings({ micLabel: e.currentTarget.value })}>
        {#each micChoices as d}<option value={d.label}>{d.label}</option>{/each}
      </select>
    </label>
    <div class="meter"><Meter level={levels.mic} color="#4ade80" /></div>
    {#if app.status.micError}<p class="warn"><TriangleAlert size={14} /> {app.status.micError}</p>{/if}

    <div class="two">
      <label class="field">
        <span><Headphones size={12} /> You hear sounds on</span>
        <select class="select" value={s.monitorLabel || ''} onchange={(e) => setSettings({ monitorLabel: e.currentTarget.value || null })}>
          <option value="">Windows default ({app.status.monitor})</option>
          {#each monitorChoices as d}<option value={d.label}>{d.label}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span><Gamepad2 size={12} /> Game mix goes to</span>
        <select class="select" value={s.gameLabel || ''} onchange={(e) => setSettings({ gameLabel: e.currentTarget.value || null })}>
          <option value="">Auto (virtual cable)</option>
          {#each app.devices.outputs as d}<option value={d.label}>{d.label}</option>{/each}
        </select>
      </label>
    </div>

    {#if app.status.cable && gameIsCable}
      <p class="good"><CircleCheck size={14} /> Virtual mic connected. Games should use <b>CABLE Output</b> as their microphone.</p>
    {:else if !app.status.cable}
      <div class="callout">
        <TriangleAlert size={16} />
        <span>The virtual mic isn't installed, so games can't hear the board yet.</span>
        <button class="btn small primary" onclick={() => (app.modal = { type: 'setup' })}>Set it up</button>
      </div>
    {:else}
      <p class="warn"><TriangleAlert size={14} /> The game mix isn't going to the virtual cable. Pick "Auto" unless you know what you're doing.</p>
    {/if}
  </section>

  <section>
    <h3><Gamepad2 size={15} /> Games & voice chat</h3>
    <div class="row">
      <div class="txt">
        <b>Use the board as my Windows default mic</b>
        <small>While the app runs. Your real mic is restored when you quit.</small>
      </div>
      <button
        class="switch"
        class:on={s.manageDefaultMic}
        disabled={defaultBusy || !app.status.cableMic}
        aria-label="Default mic"
        onclick={toggleDefault}
      ></button>
    </div>
    <div class="row">
      <div class="txt"><b>Hear what games hear</b><small>Loops the virtual mic back to your headphones for testing</small></div>
      <button class="btn small" class:listening={app.listening} onclick={() => setListening(!app.listening)}>
        <Ear size={13} />
        {app.listening ? 'Stop' : 'Listen'}
      </button>
    </div>
  </section>

  <section>
    <h3><Sliders size={15} /> Mic & playback</h3>
    {#each toggles.mic as t}{@render toggleRow(t)}{/each}
    {#each toggles.playback as t}{@render toggleRow(t)}{/each}
  </section>

  <section>
    <h3><Keyboard size={15} /> Global hotkeys</h3>
    <p class="hint">These work anywhere, even in a fullscreen game. Set per-sound hotkeys by right-clicking a sound.</p>
    <div class="hk-grid">
      <span>Stop all sounds</span>
      <HotkeyInput value={s.hotkeys?.stopAll} onchange={(a) => setSettings({ hotkeys: { stopAll: a } })} />
      <span>Mute / unmute mic</span>
      <HotkeyInput value={s.hotkeys?.toggleMute} onchange={(a) => setSettings({ hotkeys: { toggleMute: a } })} />
      <span>Switch Auto-swap / Mix</span>
      <HotkeyInput value={s.hotkeys?.toggleMode} onchange={(a) => setSettings({ hotkeys: { toggleMode: a } })} />
    </div>
  </section>

  <section>
    <h3><AppWindow size={15} /> App</h3>
    {#each toggles.app as t}{@render toggleRow(t)}{/each}
  </section>

  <section>
    <h3><Sparkles size={15} /> Updates</h3>
    <div class="row">
      <div class="txt">
        <b>Version {app.version}</b>
        <small>
          {#if u.status === 'checking'}Checking for updates…
          {:else if u.status === 'downloading'}Downloading {u.latest}… {u.percent ?? 0}%
          {:else if u.status === 'ready'}{u.latest} is downloaded and ready to install
          {:else if u.status === 'available'}{u.latest} is available
          {:else if u.status === 'current'}Up to date (checked {ago(u.checkedAt)})
          {:else if u.status === 'error'}Couldn't check: {u.error}
          {:else}{modeNote[u.mode] || ''}{/if}
        </small>
      </div>
      {#if u.status === 'ready'}
        <button class="btn small primary" onclick={() => api.update.install()}><Sparkles size={13} /> Restart & update</button>
      {:else if u.status === 'available'}
        <button class="btn small primary" onclick={() => api.update.install()}>Download {u.latest}</button>
      {:else}
        <button class="btn small" onclick={checkNow} disabled={checking || u.status === 'checking' || u.status === 'downloading'}>
          {#if checking || u.status === 'checking'}<span class="spin"><LoaderCircle size={13} /></span>{:else}<RefreshCw size={13} />{/if}
          Check now
        </button>
      {/if}
    </div>
    {@render toggleRow(['autoUpdate', 'Check for updates automatically', modeNote[u.mode] || ''])}
  </section>

  <section>
    <h3><Library size={15} /> Sounds</h3>
    <div class="buttons">
      <button class="btn" onclick={() => api.library.openFolder()}><FolderOpen size={15} /> Open sounds folder</button>
      <button class="btn" onclick={shareAll}><Share2 size={15} /> Share all sounds as a pack</button>
      <button class="btn" onclick={() => (app.modal = { type: 'setup' })}><Wand2 size={15} /> Run setup again</button>
    </div>
  </section>

  <p class="about">
    Sloppy Potato Board v{app.version}. Virtual mic by VB-Audio (VB-CABLE is donationware; if you like it,
    <a href="https://vb-audio.com/Cable/" target="_blank" rel="noreferrer">support them</a>). Airplane announcements were
    written for this app and voiced with neural text-to-speech.
  </p>
</Modal>

<style>
  section {
    padding: 16px 0;
    border-bottom: 1px solid var(--line);
  }
  section:first-child {
    padding-top: 4px;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 14px;
    font-family: var(--display);
    font-weight: 600;
    font-size: 16px;
  }
  h3 :global(svg) {
    color: var(--potato);
  }
  .field span {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .meter {
    margin: 10px 0 2px;
  }
  .meter :global(.meter) {
    height: 6px;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-top: 16px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 9px 0;
  }
  .txt {
    flex: 1;
  }
  .txt b {
    display: block;
    font-weight: 600;
  }
  .txt small {
    color: var(--muted);
    font-size: 12.5px;
  }
  .good,
  .warn {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 0 0;
    font-size: 12.5px;
    color: var(--green);
  }
  .good b {
    color: var(--text);
  }
  .warn {
    color: #ffc2c8;
  }
  .callout {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 14px;
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(255, 93, 108, 0.1);
    border: 1px solid rgba(255, 93, 108, 0.3);
    color: #ffc2c8;
    font-size: 13px;
  }
  .callout span {
    flex: 1;
  }
  .listening {
    border-color: rgba(74, 222, 128, 0.5);
    background: rgba(74, 222, 128, 0.12);
    color: #bbf7d0;
  }
  .switch:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .spin {
    display: grid;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .hint {
    margin: -6px 0 14px;
    color: var(--muted);
    font-size: 12.5px;
  }
  .hk-grid {
    display: grid;
    grid-template-columns: 180px 1fr;
    gap: 10px 16px;
    align-items: center;
  }
  .hk-grid > span {
    font-weight: 600;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .about {
    margin: 16px 0 0;
    font-size: 12px;
    color: var(--dim);
  }
  .about a {
    color: var(--potato);
  }
</style>
