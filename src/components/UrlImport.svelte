<script>
  import { Link, LoaderCircle, ExternalLink } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import Modal from './Modal.svelte';
  import { app, api, findSound, importUrl, cleanError } from '../lib/store.svelte.js';

  let { slotId = null } = $props();
  const slot = slotId ? findSound(slotId) : null;
  let url = $state('');
  let busy = $state(false);
  let error = $state('');
  let input = $state();

  const close = () => (app.modal = null);

  onMount(async () => {
    input?.focus();
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (/^https?:\/\/\S+$/i.test(clip)) url = clip;
    } catch {
      /* clipboard not available */
    }
  });

  async function submit(e) {
    e?.preventDefault();
    if (!url.trim() || busy) return;
    busy = true;
    error = '';
    try {
      await importUrl(url.trim(), slotId ? { slotId } : {});
      close();
    } catch (err) {
      error = cleanError(err);
    } finally {
      busy = false;
    }
  }

  function search() {
    const q = encodeURIComponent(slot?.search || slot?.name || '').replace(/%20/g, '+');
    api.openExternal(q ? `https://www.myinstants.com/en/search/?name=${q}` : 'https://www.myinstants.com/en/index/us/');
  }
</script>

<Modal
  title={slot ? `Add a clip for “${slot.name}”` : 'Add a sound from a link'}
  subtitle="Paste a myinstants.com page, most soundboard sites, or any direct .mp3 / .wav link."
  width={540}
  onclose={close}
>
  <form onsubmit={submit}>
    <div class="row">
      <div class="inwrap">
        <Link size={16} />
        <input bind:this={input} bind:value={url} class="input" placeholder="https://www.myinstants.com/en/instant/…" spellcheck="false" />
      </div>
      <button class="btn primary" type="submit" disabled={!url.trim() || busy}>
        {#if busy}<span class="spin"><LoaderCircle size={16} /></span> Grabbing…{:else}Add{/if}
      </button>
    </div>
    {#if error}<p class="err">{error}</p>{/if}
  </form>

  <div class="how">
    <div class="step"><b>1</b> Find the clip on a soundboard site</div>
    <div class="step"><b>2</b> Copy the page link (or right-click the play button › copy link)</div>
    <div class="step"><b>3</b> Paste it here. You can also drag the link straight onto the window</div>
  </div>
  <button class="btn ghost small" onclick={search}><ExternalLink size={14} /> {slot ? `Search myinstants for “${slot.search || slot.name}”` : 'Browse myinstants.com'}</button>
</Modal>

<style>
  .row {
    display: flex;
    gap: 8px;
  }
  .inwrap {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
    color: var(--dim);
  }
  .inwrap :global(svg) {
    position: absolute;
    left: 12px;
  }
  .inwrap .input {
    padding-left: 36px;
    height: 42px;
  }
  .row .btn {
    height: 42px;
    min-width: 92px;
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
  .err {
    margin: 10px 0 0;
    color: #ffb3ba;
    font-size: 13px;
  }
  .how {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 20px 0 12px;
    color: var(--muted);
    font-size: 13px;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .step b {
    width: 22px;
    height: 22px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 50%;
    font-size: 11.5px;
    background: rgba(255, 195, 90, 0.16);
    color: var(--potato);
  }
</style>
