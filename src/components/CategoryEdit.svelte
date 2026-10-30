<script>
  import { Share2, Trash2 } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import Modal from './Modal.svelte';
  import { app, api, toast, cleanError } from '../lib/store.svelte.js';

  let { id = null } = $props();
  const cat = id ? app.library.categories.find((c) => c.id === id) : null;
  const count = id ? app.library.sounds.filter((s) => s.category === id).length : 0;
  const PICKS = ['📁', '🎮', '😂', '🔥', '💀', '🎵', '🌭', '✈️', '🐸', '🍕', '🚨', '🎬', '📺', '🤖', '👻', '🥔'];

  let name = $state(cat?.name ?? '');
  let emoji = $state(cat?.emoji ?? '📁');
  let confirmDelete = $state(false);
  let input = $state();
  const close = () => (app.modal = null);

  onMount(() => input?.focus());

  async function save(e) {
    e?.preventDefault();
    if (!name.trim()) return;
    if (cat) await api.library.updateCategory(id, { name: name.trim(), emoji });
    else app.tab = await api.library.addCategory({ name: name.trim(), emoji });
    close();
  }

  async function share() {
    try {
      const r = await api.library.exportPack(id);
      if (r) toast(`Saved a pack with ${r.count} sounds. Send it to a friend; they just double-click it!`, 'success', 6000);
    } catch (err) {
      toast(cleanError(err), 'error');
    }
  }

  async function del() {
    if (!confirmDelete) {
      confirmDelete = true;
      return;
    }
    await api.library.removeCategory(id);
    app.tab = 'all';
    close();
  }
</script>

<Modal title={cat ? 'Edit board' : 'New board'} width={460} onclose={close}>
  <form onsubmit={save} class="form">
    <div class="row">
      <div class="emoji-big">{emoji}</div>
      <label class="field grow">
        <span>Name</span>
        <input bind:this={input} class="input" bind:value={name} maxlength="40" placeholder="e.g. Movie quotes" />
      </label>
    </div>
    <div class="picks">
      {#each PICKS as p}
        <button type="button" class="pick" class:sel={emoji === p} onclick={() => (emoji = p)}>{p}</button>
      {/each}
    </div>
  </form>

  {#if cat}
    <div class="share">
      <div>
        <b>Share this board</b>
        <small>Saves a .potatopack file with all {count} sounds. Friends double-click it to add the board.</small>
      </div>
      <button class="btn" onclick={share}><Share2 size={15} /> Share</button>
    </div>
  {/if}

  {#snippet footer()}
    {#if cat && cat.id !== 'mine'}
      <button class="btn danger" onclick={del}>
        <Trash2 size={15} />
        {confirmDelete ? `Delete board + ${count} sounds?` : 'Delete'}
      </button>
    {/if}
    <div style="flex:1"></div>
    <button class="btn ghost" onclick={close}>Cancel</button>
    <button class="btn primary" onclick={save} disabled={!name.trim()}>{cat ? 'Save' : 'Create board'}</button>
  {/snippet}
</Modal>

<style>
  .row {
    display: flex;
    align-items: flex-end;
    gap: 14px;
  }
  .grow {
    flex: 1;
  }
  .emoji-big {
    width: 62px;
    height: 62px;
    display: grid;
    place-items: center;
    font-size: 34px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--line);
  }
  .picks {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 14px;
  }
  .pick {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    font-size: 18px;
    transition:
      background 0.15s,
      transform 0.25s var(--spring);
  }
  .pick:hover {
    background: rgba(255, 255, 255, 0.08);
    transform: scale(1.15);
  }
  .pick.sel {
    background: rgba(255, 195, 90, 0.2);
    box-shadow: 0 0 0 1.5px var(--potato) inset;
  }
  .share {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-top: 20px;
    padding: 14px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line);
  }
  .share b {
    display: block;
  }
  .share small {
    color: var(--muted);
    font-size: 12.5px;
  }
</style>
