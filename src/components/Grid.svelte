<script>
  import { flip } from 'svelte/animate';
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { Plus, Link, Star, Lightbulb, X } from '@lucide/svelte';
  import Tile from './Tile.svelte';
  import { app, api, pickFiles } from '../lib/store.svelte.js';
  import { view, clearFilters } from '../lib/filter.svelte.js';

  let dragId = $state(null);
  let dragOrder = $state(null);
  let hideSlotTip = $state(localStorage.getItem('hideSlotTip') === '1');

  const filtered = $derived(view.sounds);
  let gridEl = $state();

  // column count, so arrow up/down in the search box moves by whole rows
  $effect(() => {
    if (!gridEl) return;
    const ro = new ResizeObserver(() => {
      app.gridCols = getComputedStyle(gridEl).gridTemplateColumns.split(' ').length || 1;
    });
    ro.observe(gridEl);
    return () => ro.disconnect();
  });

  const list = $derived(
    dragOrder ? dragOrder.map((id) => filtered.find((s) => s.id === id)).filter(Boolean) : filtered,
  );
  const failures = $derived(new Set(app.hotkeyFailures));
  const hasSlots = $derived(filtered.some((s) => !s.file));

  function onDragStart(e, id) {
    dragId = id;
    dragOrder = filtered.map((s) => s.id);
    e.dataTransfer.setData('application/x-potato', id);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e, id) {
    if (!dragId || !e.dataTransfer.types.includes('application/x-potato')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id === dragId) return;
    const next = [...dragOrder];
    const to = next.indexOf(id);
    next.splice(next.indexOf(dragId), 1);
    next.splice(to, 0, dragId);
    dragOrder = next;
  }

  function onDragEnd() {
    const order = dragOrder;
    const changed = order && order.join() !== filtered.map((s) => s.id).join();
    if (changed) {
      // apply locally first so nothing snaps back while the main process saves
      const set = new Set(order);
      const slots = [];
      app.library.sounds.forEach((s, i) => set.has(s.id) && slots.push(i));
      const byId = new Map(app.library.sounds.map((s) => [s.id, s]));
      const sounds = [...app.library.sounds];
      slots.forEach((slot, k) => (sounds[slot] = byId.get(order[k])));
      app.library.sounds = sounds;
      api.library.reorder(order);
    }
    dragId = null;
    dragOrder = null;
  }

  function dismissTip() {
    hideSlotTip = true;
    localStorage.setItem('hideSlotTip', '1');
  }
</script>

<div class="wrap">
  {#if hasSlots && !hideSlotTip && !view.filtering}
    <div class="tip" transition:fly={{ y: -10, duration: 300 }}>
      <Lightbulb size={18} />
      <div>
        <b>Fill in the empty slots.</b> Show clips can't ship with the app because they belong to Netflix. Hit
        <em>Find it</em> to search myinstants, then drag the clip (or its link) onto the tile.
      </div>
      <button class="x" title="Got it" onclick={dismissTip}><X size={14} /></button>
    </div>
  {/if}

  {#if list.length}
    <div class="grid" bind:this={gridEl}>
      {#each list as sound, i (sound.id)}
        <div
          class="cell"
          animate:flip={{ duration: 340, easing: cubicOut }}
          in:fly|global={{ y: 18, duration: 420, delay: Math.min(i, 24) * 22, easing: cubicOut }}
        >
          <Tile
            {sound}
            query={app.search}
            selected={view.filtering && !dragId && i === app.cursor}
            failed={failures.has(sound.id)}
            dragging={dragId === sound.id}
            ondragstart={(e) => onDragStart(e, sound.id)}
            ondragover={(e) => onDragOver(e, sound.id)}
            ondragend={onDragEnd}
          />
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty" in:fade={{ duration: 250 }}>
      {#if view.filtering}
        <div class="big">🔍</div>
        <h3>{app.search ? `No sounds match “${app.search}”` : 'No sounds match that filter'}</h3>
        <button class="btn" onclick={clearFilters}>Clear filters</button>
      {:else if app.tab === 'favorites'}
        <div class="big">⭐</div>
        <h3>No favorites yet</h3>
        <p>Hover a sound and tap the <Star size={13} /> to pin it here.</p>
      {:else}
        <div class="big wobble">🥔</div>
        <h3>This board is empty</h3>
        <p>Drag sound files or links anywhere onto the window, or:</p>
        <div class="row">
          <button class="btn primary" onclick={() => pickFiles()}><Plus size={16} /> Choose files</button>
          <button class="btn" onclick={() => (app.modal = { type: 'url' })}><Link size={15} /> Paste a link</button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .wrap {
    padding: 2px 20px 28px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(184px, 1fr));
    gap: 14px;
  }
  .cell {
    min-width: 0;
  }
  .tip {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 16px;
    padding: 12px 14px;
    border-radius: 14px;
    background: linear-gradient(135deg, rgba(255, 195, 90, 0.12), rgba(255, 79, 139, 0.08));
    border: 1px solid rgba(255, 195, 90, 0.25);
    color: var(--muted);
    font-size: 13px;
  }
  .tip :global(svg) {
    color: var(--potato);
    flex: none;
    margin-top: 1px;
  }
  .tip b {
    color: var(--text);
  }
  .tip em {
    color: var(--potato);
    font-style: normal;
    font-weight: 600;
  }
  .tip .x {
    margin-left: auto;
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 7px;
    color: var(--muted);
  }
  .tip .x:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 70px 20px;
    color: var(--muted);
  }
  .big {
    font-size: 64px;
    margin-bottom: 8px;
    filter: drop-shadow(0 10px 24px rgba(0, 0, 0, 0.5));
  }
  .wobble {
    animation: wobble 3s ease-in-out infinite;
  }
  @keyframes wobble {
    0%,
    100% {
      transform: rotate(-6deg) translateY(0);
    }
    50% {
      transform: rotate(6deg) translateY(-8px);
    }
  }
  h3 {
    margin: 0 0 6px;
    font-family: var(--display);
    font-weight: 600;
    font-size: 22px;
    color: var(--text);
  }
  p {
    margin: 0 0 18px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .row {
    display: flex;
    gap: 10px;
  }
</style>
