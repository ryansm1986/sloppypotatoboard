<script>
  import { Settings, Minus, Square, Copy, X, Sparkles, Download } from '@lucide/svelte';
  import { fly } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import Logo from './Logo.svelte';
  import { app, api } from '../lib/store.svelte.js';

  const u = $derived(app.update || {});
</script>

<header class="titlebar">
  <div class="brand">
    <Logo size={26} pulse={app.pulse} />
    <span class="name">Sloppy Potato <em>Board</em></span>
  </div>
  <div class="spacer"></div>
  {#if app.ready && (u.status === 'ready' || u.status === 'available' || u.status === 'downloading')}
    <div class="update" in:fly={{ y: -12, duration: 400, easing: backOut }}>
      {#if u.status === 'downloading'}
        <span class="dl" title="Downloading {u.latest}">
          <Download size={13} /> Updating… {u.percent ?? 0}%
          <i style="transform: scaleX({(u.percent ?? 0) / 100})"></i>
        </span>
      {:else}
        <button class="go" onclick={() => api.update.install()} title={u.status === 'ready' ? 'Restart to install' : 'Open the download page'}>
          <Sparkles size={14} />
          {u.status === 'ready' ? `Restart to update to ${u.latest}` : `${u.latest} is out: download`}
        </button>
      {/if}
    </div>
  {/if}
  <div class="controls">
    {#if app.ready}
      <button class="ctl" title="Settings" onclick={() => (app.modal = { type: 'settings' })}>
        <Settings size={16} />
      </button>
      <span class="sep"></span>
    {/if}
    <button class="ctl" title="Minimize" onclick={() => api.win.minimize()}><Minus size={16} /></button>
    <button class="ctl" title={app.maximized ? 'Restore' : 'Maximize'} onclick={() => api.win.toggleMaximize()}>
      {#if app.maximized}<Copy size={13} />{:else}<Square size={13} />{/if}
    </button>
    <button class="ctl close" title="Close" onclick={() => api.win.close()}><X size={17} /></button>
  </div>
</header>

<style>
  .titlebar {
    height: 46px;
    display: flex;
    align-items: center;
    padding-left: 16px;
    -webkit-app-region: drag;
    position: relative;
    z-index: 5;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .name {
    font-family: var(--display);
    font-weight: 600;
    font-size: 16px;
    letter-spacing: 0.01em;
  }
  .name em {
    font-style: normal;
    background: var(--grad);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .spacer {
    flex: 1;
  }
  .update {
    -webkit-app-region: no-drag;
    margin-right: 10px;
  }
  .go {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 12px;
    border-radius: 10px;
    font-size: 12.5px;
    font-weight: 700;
    color: #22110a;
    background: var(--grad);
    box-shadow: 0 6px 20px -6px rgba(255, 110, 70, 0.8);
    animation: glow 2.4s ease-in-out infinite;
  }
  .go:hover {
    filter: brightness(1.08);
  }
  @keyframes glow {
    50% {
      box-shadow: 0 6px 26px -2px rgba(255, 110, 70, 0.95);
    }
  }
  .dl {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 11px;
    border-radius: 9px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--line);
    overflow: hidden;
  }
  .dl i {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: var(--grad);
    transform-origin: left;
    transition: transform 0.3s;
  }
  .controls {
    display: flex;
    align-items: center;
    height: 100%;
    -webkit-app-region: no-drag;
  }
  .ctl {
    width: 46px;
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--muted);
    transition:
      background 0.15s,
      color 0.15s;
  }
  .ctl:hover {
    background: rgba(255, 255, 255, 0.07);
    color: var(--text);
  }
  .ctl.close:hover {
    background: #e81123;
    color: #fff;
  }
  .sep {
    width: 1px;
    height: 18px;
    background: var(--line);
    margin: 0 4px;
  }
</style>
