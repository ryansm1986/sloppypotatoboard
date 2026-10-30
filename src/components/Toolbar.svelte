<script>
  import { Search, Plus, FileAudio, Link, FolderOpen, Star, LayoutGrid, X } from '@lucide/svelte';
  import { fly, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { app, api, pickFiles, playSound } from '../lib/store.svelte.js';
  import { view, clearFilters } from '../lib/filter.svelte.js';

  let menuOpen = $state(false);
  let tabsEl = $state();
  let searchEl = $state();
  let indicator = $state({ x: 0, w: 0, ready: false });
  let edges = $state({ left: false, right: false });

  function updateEdges() {
    if (!tabsEl) return;
    const { scrollLeft, scrollWidth, clientWidth } = tabsEl;
    edges = { left: scrollLeft > 2, right: scrollLeft + clientWidth < scrollWidth - 2 };
  }

  const tabs = $derived([
    { id: 'all', name: 'All', count: app.library.sounds.length, icon: 'all' },
    { id: 'favorites', name: 'Favorites', count: app.library.sounds.filter((s) => s.favorite).length, icon: 'star' },
    ...app.library.categories.map((c) => ({
      id: c.id,
      name: c.name,
      emoji: c.emoji,
      count: app.library.sounds.filter((s) => s.category === c.id).length,
      category: true,
    })),
  ]);

  function measure() {
    const el = tabsEl?.querySelector(`[data-tab="${CSS.escape(app.tab)}"]`);
    if (!el) return;
    indicator = { x: el.offsetLeft, w: el.offsetWidth, ready: true };
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    updateEdges();
  }

  $effect(() => {
    app.tab;
    tabs.length;
    tabs.map((t) => t.name + t.count).join();
    requestAnimationFrame(measure);
  });

  $effect(() => {
    if (!app.library.categories.some((c) => c.id === app.tab) && !['all', 'favorites'].includes(app.tab)) app.tab = 'all';
  });

  // Quick filter: type anywhere to search, arrows move the highlight, Enter plays it, Esc clears.
  function onKey(e) {
    if (app.modal || !app.ready) return;
    const inSearch = e.target === searchEl;
    const typing = !inSearch && e.target.closest?.('input, textarea, select, [contenteditable]');
    if (typing) return;

    if ((e.ctrlKey && e.key.toLowerCase() === 'f') || (!inSearch && e.key === '/')) {
      e.preventDefault();
      searchEl?.focus();
      searchEl?.select();
      return;
    }
    if (e.key === 'Escape' && (inSearch || view.filtering)) {
      e.preventDefault();
      if (view.filtering) clearFilters();
      else searchEl?.blur();
      return;
    }
    if (inSearch || (view.filtering && e.target === document.body)) {
      const n = view.sounds.length;
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: app.gridCols, ArrowUp: -app.gridCols }[e.key];
      if (step && n) {
        e.preventDefault();
        app.cursor = Math.max(0, Math.min(n - 1, app.cursor + step));
        return;
      }
      if (e.key === 'Enter' && n) {
        e.preventDefault();
        playSound(view.sounds[Math.min(app.cursor, n - 1)].id);
        return;
      }
    }
    if (!inSearch && e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      app.search += e.key;
      searchEl?.focus();
    }
  }

  function menu(action) {
    menuOpen = false;
    action();
  }
</script>

<svelte:window onkeydown={onKey} onresize={measure} />

<div class="toolbar">
  <div
    class="tabs"
    class:fade-left={edges.left}
    class:fade-right={edges.right}
    bind:this={tabsEl}
    onscroll={updateEdges}
    onwheel={(e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) tabsEl.scrollLeft += e.deltaY;
    }}
  >
    <div
      class="indicator"
      class:ready={indicator.ready}
      style="transform: translateX({indicator.x}px); width: {indicator.w}px"
    ></div>
    {#each tabs as t (t.id)}
      <button
        class="tab"
        class:active={app.tab === t.id}
        data-tab={t.id}
        onclick={() => (app.tab = t.id)}
        oncontextmenu={(e) => {
          if (!t.category) return;
          e.preventDefault();
          app.modal = { type: 'category', id: t.id };
        }}
        ondblclick={() => t.category && (app.modal = { type: 'category', id: t.id })}
        title={t.category ? `${t.name} (right-click to edit or share)` : t.name}
        in:scale={{ duration: 300, start: 0.6, easing: backOut }}
      >
        {#if t.icon === 'all'}<LayoutGrid size={14} />{:else if t.icon === 'star'}<Star size={14} />{:else}<span
            class="emoji">{t.emoji}</span
          >{/if}
        <span class="tname">{t.name}</span>
        <span class="count">{t.count}</span>
      </button>
    {/each}
    <button class="tab add" title="New board" onclick={() => (app.modal = { type: 'category' })}>
      <Plus size={15} />
    </button>
  </div>

  <div class="right">
    <label class="search" class:filled={app.search}>
      <Search size={15} />
      <input bind:this={searchEl} bind:value={app.search} placeholder="Type to filter…" spellcheck="false" />
      {#if !app.search}<kbd class="slash" transition:scale={{ duration: 150 }}>/</kbd>{/if}
      {#if app.search}
        <button class="clear" onclick={() => (app.search = '')} transition:scale={{ duration: 150 }} title="Clear (Esc)"><X size={13} /></button>
      {/if}
    </label>

    <div class="add-wrap">
      <button class="btn primary" onclick={() => (menuOpen = !menuOpen)}>
        <Plus size={16} strokeWidth={2.6} /> Add sounds
      </button>
      {#if menuOpen}
        <button class="scrim" aria-label="Close menu" onclick={() => (menuOpen = false)}></button>
        <div class="menu" transition:fly={{ y: -8, duration: 220, easing: backOut }}>
          <button onclick={() => menu(() => pickFiles())}>
            <FileAudio size={16} />
            <div><b>Choose files</b><small>MP3, WAV, OGG, FLAC, M4A or a .potatopack</small></div>
          </button>
          <button onclick={() => menu(() => (app.modal = { type: 'url' }))}>
            <Link size={16} />
            <div><b>Paste a link</b><small>myinstants.com or any direct audio link</small></div>
          </button>
          <button onclick={() => menu(() => api.library.openFolder())}>
            <FolderOpen size={16} />
            <div><b>Open sounds folder</b><small>Files you drop in there show up automatically</small></div>
          </button>
          <div class="hint">Tip: drag files or links onto the window, or just press Ctrl+V after copying a link.</div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 6px 20px 14px;
    position: relative;
    z-index: 4;
  }
  .tabs {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    border-radius: 14px;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--line);
    overflow-x: auto;
    scrollbar-width: none;
    min-width: 0;
    flex: 1 1 auto;
    max-width: max-content;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .tabs.fade-right {
    mask-image: linear-gradient(90deg, #000 calc(100% - 48px), transparent);
  }
  .tabs.fade-left {
    mask-image: linear-gradient(90deg, transparent, #000 48px);
  }
  .tabs.fade-left.fade-right {
    mask-image: linear-gradient(90deg, transparent, #000 48px, #000 calc(100% - 48px), transparent);
  }
  .indicator {
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: 0;
    border-radius: 10px;
    background: linear-gradient(135deg, rgba(255, 195, 90, 0.2), rgba(255, 79, 139, 0.2));
    border: 1px solid rgba(255, 195, 90, 0.35);
    box-shadow: 0 6px 20px -8px rgba(255, 138, 61, 0.6);
    opacity: 0;
  }
  .indicator.ready {
    opacity: 1;
    transition:
      transform 0.42s var(--spring),
      width 0.42s var(--spring);
  }
  .tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 12px;
    border-radius: 10px;
    color: var(--muted);
    font-weight: 600;
    font-size: 13px;
    white-space: nowrap;
    flex: none;
    transition: color 0.2s;
  }
  .tab:hover {
    color: var(--text);
  }
  .tab.active {
    color: var(--text);
  }
  .tname {
    max-width: 190px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .emoji {
    font-size: 14px;
  }
  .count {
    font-size: 11px;
    font-weight: 700;
    min-width: 20px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.07);
    color: var(--dim);
    transition:
      background 0.2s,
      color 0.2s;
  }
  .tab.active .count {
    background: rgba(255, 195, 90, 0.22);
    color: var(--potato);
  }
  .tab.add {
    width: 32px;
    padding: 0;
    justify-content: center;
  }
  .tab.add:hover {
    background: rgba(255, 255, 255, 0.07);
  }

  .right {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-left: auto;
    flex: none;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    width: 220px;
    padding: 0 10px 0 12px;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--line);
    color: var(--dim);
    transition:
      width 0.35s var(--spring),
      border-color 0.2s,
      box-shadow 0.2s;
  }
  .search:focus-within,
  .search.filled {
    width: 270px;
    border-color: rgba(255, 195, 90, 0.5);
    box-shadow: 0 0 0 4px rgba(255, 195, 90, 0.1);
    color: var(--potato);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
  }
  .search input::placeholder {
    color: var(--dim);
  }
  .slash {
    font: 600 11px var(--font);
    color: var(--dim);
    padding: 1px 6px;
    border-radius: 5px;
    border: 1px solid var(--line-strong);
  }
  .clear {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.1);
    color: var(--text);
  }

  .add-wrap {
    position: relative;
  }
  .add-wrap .btn {
    height: 38px;
    border-radius: 12px;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 10;
    cursor: default;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    z-index: 11;
    width: 320px;
    padding: 6px;
    border-radius: 16px;
    background: var(--panel-raised);
    border: 1px solid var(--line-strong);
    box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.7);
    transform-origin: top right;
  }
  .menu button {
    width: 100%;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    text-align: left;
    padding: 10px 12px;
    border-radius: 11px;
    color: var(--muted);
    transition:
      background 0.15s,
      color 0.15s;
  }
  .menu button:hover {
    background: rgba(255, 255, 255, 0.07);
    color: var(--potato);
  }
  .menu button :global(svg) {
    margin-top: 2px;
    flex: none;
  }
  .menu b {
    display: block;
    color: var(--text);
    font-weight: 600;
  }
  .menu small {
    color: var(--dim);
    font-size: 12px;
  }
  .hint {
    padding: 8px 12px 6px;
    font-size: 11.5px;
    color: var(--dim);
    border-top: 1px solid var(--line);
    margin-top: 4px;
  }
</style>
