<script>
  import { Keyboard, X, CornerDownLeft } from '@lucide/svelte';
  import { scale, fade } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { app } from '../lib/store.svelte.js';
  import { view, tagEmoji, tagName, clearFilters, HOTKEY_FILTER } from '../lib/filter.svelte.js';

  const toggle = (tag) => {
    app.tagFilter = app.tagFilter === tag ? null : tag;
    app.cursor = 0;
  };

  // drop a tag filter that doesn't exist on the current board
  $effect(() => {
    const t = app.tagFilter;
    if (t && t !== HOTKEY_FILTER && !view.tags.some(([x]) => x === t)) app.tagFilter = null;
  });

  // keep the highlight on the first result whenever the filter changes
  $effect(() => {
    app.search;
    app.tagFilter;
    app.tab;
    app.cursor = 0;
  });
</script>

<div class="row">
{#if view.tags.length || view.hotkeyCount || view.filtering}
  <div class="bar" transition:fade={{ duration: 150 }}>
    <div class="chips">
      {#each view.tags as [tag, count] (tag)}
        <button class="chip-btn" class:on={app.tagFilter === tag} onclick={() => toggle(tag)} in:scale={{ duration: 260, start: 0.7, easing: backOut }}>
          <span class="e">{tagEmoji(tag)}</span>{tagName(tag)}<span class="n">{count}</span>
        </button>
      {/each}
      {#if view.hotkeyCount}
        <button class="chip-btn" class:on={app.tagFilter === HOTKEY_FILTER} onclick={() => toggle(HOTKEY_FILTER)} title="Only sounds with a hotkey">
          <Keyboard size={13} /> Has hotkey<span class="n">{view.hotkeyCount}</span>
        </button>
      {/if}
    </div>

    <div class="status">
      {#if view.filtering}
        <span in:fade={{ duration: 150 }}>
          <b>{view.sounds.length}</b> of {view.scoped.length}
          {#if view.sounds.length}
            <span class="sep">·</span><CornerDownLeft size={12} /> plays the highlighted one
          {/if}
        </span>
        <button class="clear" onclick={clearFilters} title="Clear filters (Esc)"><X size={13} /> Clear</button>
      {:else}
        <span class="hint">Just start typing to filter</span>
      {/if}
    </div>
  </div>
{/if}
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 20px 12px;
    position: relative;
    z-index: 3;
  }
  .chips {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    min-width: 0;
    flex: 1;
    padding: 2px;
  }
  .chips::-webkit-scrollbar {
    display: none;
  }
  .chip-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid var(--line);
    transition:
      color 0.18s,
      background 0.18s,
      border-color 0.18s,
      transform 0.25s var(--spring),
      box-shadow 0.25s;
  }
  .chip-btn:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.08);
    transform: translateY(-1px);
  }
  .chip-btn.on {
    color: var(--text);
    background: linear-gradient(135deg, rgba(255, 195, 90, 0.22), rgba(255, 79, 139, 0.2));
    border-color: rgba(255, 195, 90, 0.55);
    box-shadow: 0 6px 18px -8px rgba(255, 138, 61, 0.8);
  }
  .e {
    font-size: 13px;
  }
  .n {
    font-size: 10.5px;
    font-weight: 700;
    min-width: 18px;
    height: 16px;
    padding: 0 5px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.08);
    color: var(--dim);
  }
  .chip-btn.on .n {
    background: rgba(255, 195, 90, 0.25);
    color: var(--potato);
  }
  .status {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: var(--muted);
  }
  .status span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .status b {
    color: var(--text);
  }
  .sep {
    color: var(--dim);
  }
  .hint {
    color: var(--dim);
  }
  .clear {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 9px;
    border-radius: 8px;
    font-weight: 600;
    color: var(--text);
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid var(--line);
  }
  .clear:hover {
    background: rgba(255, 255, 255, 0.12);
  }
</style>
