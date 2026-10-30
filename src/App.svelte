<script>
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { Download } from '@lucide/svelte';
  import TitleBar from './components/TitleBar.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import FilterBar from './components/FilterBar.svelte';
  import Grid from './components/Grid.svelte';
  import Mixer from './components/Mixer.svelte';
  import Toasts from './components/Toasts.svelte';
  import EditSound from './components/EditSound.svelte';
  import Settings from './components/Settings.svelte';
  import Setup from './components/Setup.svelte';
  import UrlImport from './components/UrlImport.svelte';
  import CategoryEdit from './components/CategoryEdit.svelte';
  import Logo from './components/Logo.svelte';
  import { app, api, init, importPaths, importUrl, targetCategory, toast, cleanError } from './lib/store.svelte.js';

  let bootError = $state('');
  let dropping = $state(false);
  let dropTimer;
  let beat = $state();

  onMount(() => {
    init().catch((err) => {
      console.error(err);
      bootError = cleanError(err);
    });
    const hide = () => (dropping = false);
    window.addEventListener('potato:drop-handled', hide);
    return () => window.removeEventListener('potato:drop-handled', hide);
  });

  // a soft flash in the background every time a sound fires
  $effect(() => {
    if (!app.pulse || !beat) return;
    beat.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }], { duration: 900, easing: 'ease-out' });
  });

  const isExternal = (e) => {
    const t = e.dataTransfer?.types || [];
    return !t.includes('application/x-potato') && (t.includes('Files') || t.includes('text/uri-list'));
  };

  function onDragOver(e) {
    e.preventDefault(); // never let Chromium navigate to a dropped file
    if (!isExternal(e) || !app.ready) return;
    e.dataTransfer.dropEffect = 'copy';
    dropping = true;
    clearTimeout(dropTimer);
    dropTimer = setTimeout(() => (dropping = false), 180);
  }

  async function onDrop(e) {
    e.preventDefault();
    dropping = false;
    if (!isExternal(e) || !app.ready) return;
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) return importPaths(files.map((f) => api.pathForFile(f)));
    const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split('\n')[0].trim();
    if (/^https?:\/\//i.test(url)) {
      toast('Grabbing that clip…');
      importUrl(url).catch((err) => toast(cleanError(err), 'error', 6000));
    }
  }

  // Ctrl+V anywhere (outside text fields) imports a copied link or copied files.
  function onPaste(e) {
    if (!app.ready || app.modal || e.target.closest?.('input, textarea, [contenteditable]')) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      return importPaths(files.map((f) => api.pathForFile(f)).filter(Boolean));
    }
    const text = (e.clipboardData?.getData('text/plain') || '').trim();
    if (/^https?:\/\/\S+$/i.test(text)) {
      e.preventDefault();
      toast('Grabbing that clip…');
      importUrl(text).catch((err) => toast(cleanError(err), 'error', 6000));
    }
  }

  const dropTarget = $derived(app.library.categories.find((c) => c.id === targetCategory()));
</script>

<svelte:window ondragover={onDragOver} ondrop={onDrop} onpaste={onPaste} />

<div class="bg" aria-hidden="true">
  <div class="blob b1"></div>
  <div class="blob b2"></div>
  <div class="blob b3"></div>
  <div class="blob b4"></div>
  <div class="beat" bind:this={beat}></div>
  <div class="grain"></div>
</div>

<div class="shell">
  <TitleBar />
  {#if app.ready}
    <Toolbar />
    <FilterBar />
    <main class="content">
      <Grid />
    </main>
    <Mixer />
  {:else}
    <div class="loading" out:fade={{ duration: 200 }}>
      {#if bootError}
        <div class="boot-error">
          <h2>Something went wrong starting up</h2>
          <p>{bootError}</p>
          <button class="btn primary" onclick={() => location.reload()}>Try again</button>
        </div>
      {:else}
        <div class="bounce"><Logo size={96} /></div>
        <p>Warming up the fryer…</p>
      {/if}
    </div>
  {/if}
</div>

{#if dropping}
  <div class="drop" transition:fade={{ duration: 150 }}>
    <div class="drop-pill" in:fly={{ y: 30, duration: 350, easing: backOut }}>
      <Download size={20} />
      Drop to add to <b>{dropTarget?.emoji} {dropTarget?.name}</b>
    </div>
  </div>
{/if}

<Toasts />

{#if app.modal?.type === 'edit'}
  <EditSound id={app.modal.id} />
{:else if app.modal?.type === 'settings'}
  <Settings />
{:else if app.modal?.type === 'setup'}
  <Setup />
{:else if app.modal?.type === 'url'}
  <UrlImport slotId={app.modal.slotId} />
{:else if app.modal?.type === 'category'}
  <CategoryEdit id={app.modal.id} />
{/if}

<style>
  .bg {
    position: fixed;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 0;
    background:
      radial-gradient(1200px 600px at 50% -10%, rgba(139, 92, 246, 0.12), transparent 70%),
      var(--bg);
  }
  .blob {
    position: absolute;
    border-radius: 50%;
    will-change: transform;
  }
  .b1 {
    width: 70vmax;
    height: 70vmax;
    top: -38vmax;
    left: -24vmax;
    background: radial-gradient(circle, rgba(255, 138, 61, 0.34), transparent 62%);
    animation: drift1 26s ease-in-out infinite alternate;
  }
  .b2 {
    width: 80vmax;
    height: 80vmax;
    bottom: -48vmax;
    right: -30vmax;
    background: radial-gradient(circle, rgba(139, 92, 246, 0.36), transparent 62%);
    animation: drift2 32s ease-in-out infinite alternate;
  }
  .b3 {
    width: 50vmax;
    height: 50vmax;
    top: 22%;
    left: 38%;
    background: radial-gradient(circle, rgba(255, 79, 139, 0.18), transparent 62%);
    animation: drift3 38s ease-in-out infinite alternate;
  }
  .b4 {
    width: 40vmax;
    height: 40vmax;
    bottom: -10vmax;
    left: -10vmax;
    background: radial-gradient(circle, rgba(45, 212, 191, 0.12), transparent 62%);
    animation: drift2 44s ease-in-out infinite alternate-reverse;
  }
  @keyframes drift1 {
    to {
      transform: translate(16vmax, 10vmax) scale(1.12);
    }
  }
  @keyframes drift2 {
    to {
      transform: translate(-14vmax, -8vmax) scale(1.08);
    }
  }
  @keyframes drift3 {
    to {
      transform: translate(-18vmax, 12vmax) scale(1.25);
    }
  }
  .beat {
    position: absolute;
    inset: 0;
    opacity: 0;
    background: radial-gradient(900px 500px at 50% 60%, rgba(255, 170, 80, 0.13), transparent 70%);
  }
  .grain {
    position: absolute;
    inset: 0;
    opacity: 0.07;
    mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
  }

  .shell {
    position: relative;
    z-index: 1;
    height: 100%;
    display: grid;
    grid-template-rows: auto auto auto 1fr auto;
    grid-template-columns: minmax(0, 1fr); /* never let a long tab strip widen the window */
  }
  .content {
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
    padding-top: 6px;
    mask-image: linear-gradient(180deg, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%);
  }
  .loading {
    grid-row: 2 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    color: var(--muted);
    font-family: var(--display);
    font-size: 15px;
  }
  .bounce {
    animation: bounce 1s cubic-bezier(0.3, 0, 0.4, 1) infinite alternate;
  }
  @keyframes bounce {
    from {
      transform: translateY(0) scaleY(0.95);
    }
    to {
      transform: translateY(-22px) rotate(-6deg);
    }
  }
  .boot-error {
    text-align: center;
    max-width: 480px;
  }
  .boot-error h2 {
    font-family: var(--display);
    color: var(--text);
  }

  .drop {
    position: fixed;
    inset: 0;
    z-index: 40;
    pointer-events: none;
    border-radius: 14px;
    box-shadow:
      inset 0 0 0 3px rgba(255, 195, 90, 0.7),
      inset 0 0 120px rgba(255, 138, 61, 0.25);
    background: rgba(11, 9, 18, 0.25);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 130px;
  }
  .drop-pill {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 22px;
    border-radius: 18px;
    background: var(--grad);
    color: #22110a;
    font-weight: 600;
    font-size: 15px;
    box-shadow: 0 20px 50px -10px rgba(255, 110, 70, 0.8);
    animation: hover 1.4s ease-in-out infinite;
  }
  @keyframes hover {
    50% {
      transform: translateY(-6px);
    }
  }
</style>
