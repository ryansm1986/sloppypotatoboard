<script>
  import { CircleCheck, Download, ShieldCheck, Mic, Headphones, Gamepad2, Ear, Copy, Play, ArrowRight, ArrowLeft, ExternalLink, LoaderCircle, TriangleAlert, Sparkles } from '@lucide/svelte';
  import { fly, scale } from 'svelte/transition';
  import { backOut, cubicOut } from 'svelte/easing';
  import { onDestroy } from 'svelte';
  import Modal from './Modal.svelte';
  import Logo from './Logo.svelte';
  import Meter from './Meter.svelte';
  import { app, api, levels, setSettings, playSound, setListening, toast, cleanError } from '../lib/store.svelte.js';
  import { isCableCapture, isCablePlayback } from '../lib/audio.js';
  import { keyLabel } from '../lib/keys.js';
  import { confetti } from '../lib/confetti.js';

  const STEPS = ['Welcome', 'Virtual mic', 'Your gear', 'Games', 'Done'];
  let step = $state(0);
  let dir = $state(1);

  // virtual cable install
  let install = $state({ stage: null, pct: 0, error: '', waitingSince: 0 });
  let slow = $state(false);
  const offProgress = api.on('vbcable:progress', (p) => (install = { ...install, ...p }));
  let slowTimer;

  // default mic
  let defaultBusy = $state(false);

  const micChoices = $derived(app.devices.inputs.filter((d) => !isCableCapture(d.label)));
  const monitorChoices = $derived(app.devices.outputs.filter((d) => !isCablePlayback(d.label)));
  const cableName = $derived(app.devices.inputs.find((d) => isCableCapture(d.label))?.label || 'CABLE Output (VB-Audio Virtual Cable)');
  const testSound = $derived(app.library.sounds.find((s) => s.file && /seatbelt/i.test(s.name)) || app.library.sounds.find((s) => s.file));

  $effect(() => {
    if (app.status.cable && install.stage) {
      install = { stage: 'found', pct: 1, error: '' };
      clearTimeout(slowTimer);
    }
  });

  onDestroy(() => {
    offProgress();
    clearTimeout(slowTimer);
    if (app.listening) setListening(false);
  });

  function go(n) {
    dir = n > step ? 1 : -1;
    if (app.listening && step === 3) setListening(false);
    step = n;
    if (n === 4) setTimeout(() => confetti({ y: innerHeight * 0.38 }), 250);
  }

  function finish() {
    setSettings({ setupDone: true });
    app.modal = null;
  }

  async function installCable() {
    install = { stage: 'download', pct: 0, error: '' };
    slow = false;
    try {
      await api.vbcable.install();
      if (!app.status.cable) {
        install = { ...install, stage: 'waiting' };
        slowTimer = setTimeout(() => (slow = true), 25000);
      }
    } catch (err) {
      install = { stage: null, pct: 0, error: cleanError(err) };
    }
  }

  async function toggleDefault() {
    defaultBusy = true;
    try {
      if (app.settings.manageDefaultMic) {
        const r = await api.defaultMic.disable();
        toast(r.restored ? `Windows default mic is back to ${r.restored}` : 'Turned off', 'info');
      } else {
        await api.defaultMic.enable();
        toast('Done! Games using the default mic will now hear the board', 'success');
      }
    } catch (err) {
      toast(cleanError(err), 'error');
    } finally {
      defaultBusy = false;
    }
  }

  function copyCable() {
    navigator.clipboard.writeText(cableName);
    toast('Copied', 'success', 1500);
  }

  const slide = (node, { d }) => ({
    duration: 380,
    easing: cubicOut,
    css: (t) => `opacity:${t}; transform: translateX(${(1 - t) * 40 * d}px)`,
  });
</script>

<Modal width={620} onclose={finish}>
  {#snippet header()}
    <div class="progress">
      {#each STEPS as label, i}
        <div class="seg" class:done={i < step} class:current={i === step}>
          <div class="bar"><div class="fill"></div></div>
          <span>{label}</span>
        </div>
      {/each}
    </div>
  {/snippet}

  <div class="stage">
    {#key step}
      <div class="page" in:slide={{ d: dir }}>
        {#if step === 0}
          <div class="welcome">
            <div class="logo-wrap"><Logo size={120} /></div>
            <h1>Welcome to Sloppy Potato Board</h1>
            <p>Let's get your sounds into your games and voice chat. It takes about a minute, and you only do it once.</p>
            <ul class="bullets">
              <li><Sparkles size={15} /> A virtual mic that carries <b>your voice + the board</b> into any game</li>
              <li><Sparkles size={15} /> Global hotkeys that work while you're in game</li>
              <li><Sparkles size={15} /> Auto-swap smoothly hands the mic between you and the board</li>
            </ul>
          </div>
        {:else if step === 1}
          <div class="icon-head"><Download size={22} /></div>
          <h2>Add the virtual mic</h2>
          <p class="lead">
            Games can only listen to microphones, so the board plays into a free virtual one,
            <b>VB-CABLE</b> by VB-Audio. Your real mic gets mixed in too, so friends still hear you.
          </p>

          {#if app.status.cable}
            <div class="ok" in:scale={{ duration: 400, start: 0.8, easing: backOut }}>
              <CircleCheck size={22} />
              <div><b>Virtual mic is installed</b><small>{app.status.game}</small></div>
            </div>
          {:else if install.stage}
            <div class="installing">
              {#if install.stage === 'download'}
                <div class="row"><span class="spin"><LoaderCircle size={18} /></span> Downloading the driver… {Math.round(install.pct * 100)}%</div>
                <div class="pbar"><div style="width:{install.pct * 100}%"></div></div>
              {:else if install.stage === 'extract' || install.stage === 'install'}
                <div class="row"><ShieldCheck size={18} /> <b>Windows will ask for permission. Click "Yes", then "Install".</b></div>
                <div class="pbar indeterminate"><div></div></div>
              {:else}
                <div class="row"><span class="spin"><LoaderCircle size={18} /></span> Waiting for Windows to finish adding the device…</div>
                <div class="pbar indeterminate"><div></div></div>
                {#if slow}
                  <p class="note" in:fly={{ y: 6 }}>
                    <TriangleAlert size={14} /> Still not showing up? Restart your PC, then open the app again. Windows sometimes
                    needs a reboot for new audio drivers.
                  </p>
                {/if}
              {/if}
            </div>
          {:else}
            <button class="btn primary big" onclick={installCable}><Download size={17} /> Install virtual mic</button>
            {#if install.error}<p class="err">{install.error}. You can try again or install it manually.</p>{/if}
            <button class="btn ghost small" onclick={() => api.vbcable.openPage()}><ExternalLink size={13} /> Install manually from vb-audio.com</button>
          {/if}
        {:else if step === 2}
          <div class="icon-head"><Mic size={22} /></div>
          <h2>Pick your mic and headphones</h2>
          <p class="lead">Your real mic gets passed through to the game alongside the board.</p>

          <label class="field">
            <span>Microphone</span>
            <select class="select" value={app.status.mic} onchange={(e) => setSettings({ micLabel: e.currentTarget.value })}>
              {#each micChoices as d}<option value={d.label}>{d.label}</option>{/each}
            </select>
          </label>
          <div class="meter-row">
            <Meter level={levels.mic} color="#4ade80" />
            <small>{app.status.micError || (levels.mic > 0.03 ? 'Sounding good!' : 'Say something to test')}</small>
          </div>

          <label class="field" style="margin-top:18px">
            <span>Where you hear sounds</span>
            <select
              class="select"
              value={app.settings.monitorLabel || ''}
              onchange={(e) => setSettings({ monitorLabel: e.currentTarget.value || null })}
            >
              <option value="">Windows default ({app.status.monitor})</option>
              {#each monitorChoices as d}<option value={d.label}>{d.label}</option>{/each}
            </select>
          </label>
          <div class="meter-row">
            <Meter level={levels.monitor} color="#b197fc" />
            {#if testSound}
              <button class="btn small" onclick={() => playSound(testSound.id, { preview: true })}>
                <Headphones size={13} /> Play test sound
              </button>
            {/if}
          </div>
        {:else if step === 3}
          <div class="icon-head"><Gamepad2 size={22} /></div>
          <h2>Connect it to your games</h2>
          <p class="lead">Pick one. The automatic option works with almost every game and Discord.</p>

          <div class="option" class:on={app.settings.manageDefaultMic}>
            <div class="opt-text">
              <b>Automatic <span class="rec">Recommended</span></b>
              <small>
                Makes the board your Windows default mic while the app is running, and switches back to your real mic when you
                quit.
              </small>
            </div>
            <button
              class="switch"
              class:on={app.settings.manageDefaultMic}
              disabled={defaultBusy || !app.status.cableMic}
              aria-label="Use as default mic"
              onclick={toggleDefault}
            ></button>
          </div>

          <div class="option">
            <div class="opt-text">
              <b>Manual</b>
              <small>In your game or Discord voice settings, set the microphone to:</small>
              <button class="cable-name" onclick={copyCable} title="Copy">
                <Mic size={13} />
                {cableName}
                <Copy size={12} />
              </button>
            </div>
          </div>

          <div class="test">
            <button class="btn" class:active-listen={app.listening} onclick={() => setListening(!app.listening)}>
              <Ear size={15} />
              {app.listening ? 'Stop listening' : 'Hear what games hear'}
            </button>
            {#if testSound}
              <button class="btn" onclick={() => playSound(testSound.id)}><Play size={14} /> Play a sound</button>
            {/if}
          </div>
          {#if app.listening}
            <p class="note" in:fly={{ y: 6 }}>Talk and play a sound. You should hear both (with a tiny delay).</p>
          {/if}
          <p class="note subtle">
            Use push-to-talk in a game? Sounds only go through while you hold the key, so voice activation works best for
            soundboards.
          </p>
        {:else}
          <div class="welcome">
            <div class="logo-wrap party"><Logo size={110} /></div>
            <h1>You're all set!</h1>
            <p>Some hotkeys are already set up and work anywhere, even in a game:</p>
            <div class="keys">
              <div><span class="chip">Num 1 – Num 9</span> airplane sounds</div>
              {#if app.settings.hotkeys?.stopAll}<div><span class="chip">{keyLabel(app.settings.hotkeys.stopAll)}</span> stop everything</div>{/if}
              {#if app.settings.hotkeys?.toggleMute}<div><span class="chip">{keyLabel(app.settings.hotkeys.toggleMute)}</span> mute / unmute your mic</div>{/if}
            </div>
            <p class="small">Right-click any sound to change its hotkey. Drag in files or links to add more.</p>
          </div>
        {/if}
      </div>
    {/key}
  </div>

  {#snippet footer()}
    {#if step > 0 && step < 4}
      <button class="btn ghost" onclick={() => go(step - 1)}><ArrowLeft size={15} /> Back</button>
    {/if}
    <div style="flex:1"></div>
    {#if step === 1 && !app.status.cable}
      <button class="btn ghost" onclick={() => go(2)}>Skip for now</button>
    {/if}
    {#if step === 1 && !app.status.cable}
      <!-- only "Skip" until the cable shows up -->
    {:else if step < 4}
      <button class="btn primary" onclick={() => go(step + 1)}>
        {step === 0 ? "Let's go" : 'Next'} <ArrowRight size={15} />
      </button>
    {:else}
      <button class="btn primary" onclick={finish}>Start playing <Sparkles size={15} /></button>
    {/if}
  {/snippet}
</Modal>

<style>
  .progress {
    display: flex;
    gap: 8px;
    padding: 22px 24px 4px;
  }
  .seg {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 11px;
    font-weight: 650;
    color: var(--dim);
    transition: color 0.3s;
  }
  .seg.current,
  .seg.done {
    color: var(--text);
  }
  .bar {
    height: 4px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    width: 0;
    background: var(--grad);
    transition: width 0.5s var(--ease);
  }
  .seg.done .fill,
  .seg.current .fill {
    width: 100%;
  }
  .seg.current .fill {
    width: 50%;
  }

  .stage {
    display: grid;
    min-height: 380px;
  }
  .page {
    grid-area: 1 / 1;
  }
  .welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding-top: 8px;
  }
  .logo-wrap {
    animation: float 3.2s ease-in-out infinite;
    margin-bottom: 8px;
  }
  .logo-wrap.party {
    animation: party 1.2s ease-in-out infinite;
  }
  @keyframes float {
    50% {
      transform: translateY(-10px) rotate(-4deg);
    }
  }
  @keyframes party {
    25% {
      transform: rotate(-10deg) scale(1.05);
    }
    75% {
      transform: rotate(10deg) scale(1.05);
    }
  }
  h1 {
    margin: 6px 0 8px;
    font-family: var(--display);
    font-size: 28px;
    font-weight: 600;
  }
  h2 {
    margin: 10px 0 6px;
    font-family: var(--display);
    font-size: 23px;
    font-weight: 600;
  }
  p {
    color: var(--muted);
    margin: 0 0 16px;
  }
  .lead {
    margin-bottom: 20px;
  }
  .lead b {
    color: var(--text);
  }
  .bullets {
    list-style: none;
    padding: 0;
    margin: 4px 0 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    text-align: left;
  }
  .bullets li {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--muted);
  }
  .bullets :global(svg) {
    color: var(--potato);
    flex: none;
  }
  .bullets b {
    color: var(--text);
  }
  .icon-head {
    width: 46px;
    height: 46px;
    display: grid;
    place-items: center;
    border-radius: 14px;
    background: linear-gradient(135deg, rgba(255, 195, 90, 0.25), rgba(255, 79, 139, 0.2));
    color: var(--potato);
    margin-top: 10px;
  }
  .btn.big {
    height: 46px;
    padding: 0 22px;
    font-size: 14px;
    border-radius: 14px;
    margin-bottom: 12px;
  }
  .ok {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-radius: 14px;
    background: rgba(74, 222, 128, 0.1);
    border: 1px solid rgba(74, 222, 128, 0.35);
    color: var(--green);
  }
  .ok b {
    display: block;
    color: var(--text);
  }
  .ok small {
    color: var(--muted);
  }
  .installing {
    padding: 16px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }
  .spin {
    display: grid;
    animation: spin 0.8s linear infinite;
    color: var(--potato);
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .pbar {
    height: 6px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }
  .pbar div {
    height: 100%;
    background: var(--grad);
    border-radius: 6px;
    transition: width 0.2s;
  }
  .pbar.indeterminate div {
    width: 35%;
    animation: indet 1.3s ease-in-out infinite;
  }
  @keyframes indet {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(300%);
    }
  }
  .err {
    color: #ffb3ba;
    font-size: 13px;
  }
  .note {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    margin: 12px 0 0;
    font-size: 12.5px;
    color: var(--muted);
  }
  .note.subtle {
    color: var(--dim);
  }
  .meter-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
  }
  .meter-row :global(.meter) {
    flex: 1;
    height: 7px;
  }
  .meter-row > :global(:last-child) {
    flex: none;
    width: 150px;
    justify-content: center;
  }
  .meter-row small {
    text-align: right;
    color: var(--muted);
    font-size: 12px;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid var(--line);
    margin-bottom: 10px;
    transition:
      border-color 0.3s,
      background 0.3s;
  }
  .option.on {
    border-color: rgba(255, 195, 90, 0.45);
    background: rgba(255, 195, 90, 0.07);
  }
  .opt-text {
    flex: 1;
  }
  .opt-text b {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .opt-text small {
    display: block;
    color: var(--muted);
    font-size: 12.5px;
    margin-top: 3px;
  }
  .rec {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 2px 7px;
    border-radius: 6px;
    background: rgba(255, 195, 90, 0.2);
    color: var(--potato);
  }
  .switch:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .cable-name {
    margin-top: 8px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 9px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--line-strong);
    font-weight: 600;
    font-size: 12.5px;
  }
  .cable-name:hover {
    border-color: var(--potato);
  }
  .test {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }
  .active-listen {
    border-color: rgba(74, 222, 128, 0.5);
    background: rgba(74, 222, 128, 0.12);
    color: #bbf7d0;
  }
  .keys {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 4px 0 16px;
    color: var(--muted);
  }
  .keys div {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: center;
  }
  .keys .chip {
    height: 24px;
    font-size: 12px;
    color: var(--text);
  }
  .small {
    font-size: 12.5px;
  }
</style>
