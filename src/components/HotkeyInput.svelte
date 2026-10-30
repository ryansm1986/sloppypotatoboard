<script>
  import { Keyboard, X } from '@lucide/svelte';
  import { api } from '../lib/store.svelte.js';
  import { accelFromEvent, keyParts } from '../lib/keys.js';

  let { value = null, onchange, placeholder = 'Click, then press a key' } = $props();
  let recording = $state(false);
  let error = $state('');

  async function start() {
    recording = true;
    error = '';
    window.addEventListener('keydown', onKey, true);
    await api.hotkeys.suspend(true); // so already-bound keys reach us instead of firing
  }

  async function stop() {
    if (!recording) return;
    recording = false;
    window.removeEventListener('keydown', onKey, true);
    await api.hotkeys.suspend(false);
  }

  function onKey(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return stop();
    const r = accelFromEvent(e);
    if (r.pending) return;
    if (r.error) {
      error = r.error;
      return;
    }
    stop();
    onchange?.(r.accel);
  }

  $effect(() => () => {
    if (recording) stop();
  });
</script>

<div class="hk">
  <button class="rec" class:recording onclick={() => (recording ? stop() : start())} onblur={stop}>
    {#if recording}
      <span class="dot"></span> Press any key combo… <small>Esc to cancel</small>
    {:else if value}
      <Keyboard size={15} />
      {#each keyParts(value) as k, i}
        {#if i}<span class="plus">+</span>{/if}<span class="chip">{k}</span>
      {/each}
    {:else}
      <Keyboard size={15} /> <span class="ph">{placeholder}</span>
    {/if}
  </button>
  {#if value && !recording}
    <button class="clear" title="Remove hotkey" onclick={() => onchange?.(null)}><X size={14} /></button>
  {/if}
</div>
{#if error}<small class="err">{error}</small>{/if}

<style>
  .hk {
    display: flex;
    gap: 6px;
  }
  .rec {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 38px;
    padding: 0 12px;
    border-radius: 11px;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid var(--line);
    color: var(--muted);
    text-align: left;
    transition:
      border-color 0.2s,
      box-shadow 0.2s;
  }
  .rec:hover {
    border-color: var(--line-strong);
  }
  .rec.recording {
    border-color: rgba(255, 79, 139, 0.7);
    box-shadow: 0 0 0 4px rgba(255, 79, 139, 0.14);
    color: var(--text);
  }
  .rec small {
    margin-left: auto;
    color: var(--dim);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--pink);
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      transform: scale(1.6);
      opacity: 0.4;
    }
  }
  .plus {
    color: var(--dim);
    font-size: 11px;
  }
  .ph {
    color: var(--dim);
  }
  .chip {
    color: var(--text);
  }
  .clear {
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    border-radius: 11px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--line);
    color: var(--muted);
  }
  .clear:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.1);
  }
  .err {
    display: block;
    margin-top: 6px;
    color: #ffb3ba;
    font-size: 12px;
  }
</style>
