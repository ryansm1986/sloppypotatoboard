<script>
  import { Pencil, Star, Square, Search, Link, FileAudio, TriangleAlert, Keyboard, Plus, X } from '@lucide/svelte';
  import { scale, fade } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import {
    app, api, playSound, stopSound, updateSound, importPaths, pickFiles, importUrl, toast, cleanError,
    recordHotkey, stopRecording,
  } from '../lib/store.svelte.js';
  import { keyParts } from '../lib/keys.js';
  import { highlight } from '../lib/filter.svelte.js';

  let { sound, query = '', selected = false, failed = false, dragging = false, ondragstart, ondragend, ondragover } = $props();

  let el = $state();
  let ripples = $state([]);
  let dropHover = $state(false);
  let rippleId = 0;

  const playing = $derived(app.playing[sound.id]);
  const peaks = $derived(app.peaks[sound.id]);
  const isSlot = $derived(!sound.file);
  const duration = $derived(app.durations[sound.id]);
  const nameParts = $derived(highlight(sound.name, query));
  const recording = $derived(app.recording?.id === sound.id ? app.recording : null);

  // listening for a new hotkey: a click anywhere else, or opening a dialog, cancels it
  $effect(() => {
    if (!recording) return;
    if (app.modal) return stopRecording();
    const away = (e) => {
      if (!el?.contains(e.target)) stopRecording();
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  });
  $effect(() => () => {
    if (app.recording?.id === sound.id) stopRecording();
  });

  $effect(() => {
    if (selected) el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  // progress sweep across the waveform
  $effect(() => {
    if (!el) return;
    if (!playing) {
      el.style.setProperty('--p', '0');
      return;
    }
    let raf;
    const tick = () => {
      const p = Math.min(1, (performance.now() - playing.startedAt) / (playing.duration * 1000));
      el.style.setProperty('--p', p.toFixed(4));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  });

  // squash-and-stretch whenever the sound fires (click or hotkey)
  let lastTrigger = app.triggers[sound.id] || 0;
  $effect(() => {
    const n = app.triggers[sound.id] || 0;
    if (n === lastTrigger || !el) return;
    lastTrigger = n;
    el.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(0.93)', offset: 0.25 },
        { transform: 'scale(1.045)', offset: 0.6 },
        { transform: 'scale(1)' },
      ],
      { duration: 420, easing: 'cubic-bezier(.3,1.3,.5,1)' },
    );
    if (!ripples.length) addRipple(el.clientWidth / 2, el.clientHeight / 2);
  });

  function addRipple(x, y) {
    const id = ++rippleId;
    ripples.push({ id, x, y });
    setTimeout(() => (ripples = ripples.filter((r) => r.id !== id)), 650);
  }

  function onPointerDown(e) {
    if (e.button !== 0 || isSlot || recording || e.target.closest('.act, .stop, .hk')) return;
    const r = el.getBoundingClientRect();
    addRipple(e.clientX - r.left, e.clientY - r.top);
  }

  function onClick(e) {
    if (e.target.closest('.act, .stop, .slot-actions, .hk, .rec')) return;
    if (isSlot || recording) return;
    playSound(sound.id);
  }

  function onKey(e) {
    if (e.target !== el || recording) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      playSound(sound.id);
    }
  }

  const edit = () => (app.modal = { type: 'edit', id: sound.id });

  // ---------------------------------------------------------------- drops onto an empty slot
  const isExternal = (e) => {
    const t = e.dataTransfer?.types || [];
    return !t.includes('application/x-potato') && (t.includes('Files') || t.includes('text/uri-list'));
  };

  function onDragOver(e) {
    if (isSlot && isExternal(e)) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      dropHover = true;
      return;
    }
    ondragover?.(e);
  }

  async function onDrop(e) {
    if (!isSlot || !isExternal(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dropHover = false;
    window.dispatchEvent(new CustomEvent('potato:drop-handled'));
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) return importPaths(files.map((f) => api.pathForFile(f)), { slotId: sound.id });
    const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split('\n')[0].trim();
    if (/^https?:\/\//i.test(url)) {
      toast('Grabbing that clip…');
      importUrl(url, { slotId: sound.id }).catch((err) => toast(cleanError(err), 'error', 6000));
    }
  }

  function findOnline() {
    const q = encodeURIComponent(sound.search || sound.name).replace(/%20/g, '+');
    api.openExternal(`https://www.myinstants.com/en/search/?name=${q}`);
    toast('Copy the clip\'s link (or download it), then paste or drop it here', 'info', 6000);
  }

  const fmt = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${s.toFixed(s < 10 ? 1 : 0)}s`);
</script>

<div
  bind:this={el}
  class="tile"
  class:playing
  class:slot={isSlot}
  class:dragging
  class:drop-hover={dropHover}
  class:selected
  class:recording
  style="--c: {sound.color}"
  role="button"
  tabindex="0"
  draggable={!recording}
  onclick={onClick}
  onkeydown={onKey}
  onpointerdown={onPointerDown}
  oncontextmenu={(e) => {
    e.preventDefault();
    edit();
  }}
  ondragstart={(e) => ondragstart?.(e)}
  {ondragend}
  ondragover={onDragOver}
  ondragleave={() => (dropHover = false)}
  ondrop={onDrop}
>
  <div class="ring"></div>
  <div class="sheen"></div>
  {#each ripples as r (r.id)}
    <span class="ripple" style="left:{r.x}px; top:{r.y}px"></span>
  {/each}

  <div class="top">
    <span class="emoji">{sound.emoji}</span>
    <div class="top-right">
      {#if sound.hotkey}
        {#key sound.hotkey}
          <button
            class="hk keys"
            class:bad={failed}
            title={failed ? 'Another app already uses this hotkey. Click to pick another' : 'Click to change the hotkey'}
            onclick={() => recordHotkey(sound.id)}
            in:scale={{ duration: 380, start: 0.5, easing: backOut }}
          >
            {#if failed}<TriangleAlert size={11} />{/if}
            {#each keyParts(sound.hotkey) as k}<span class="chip">{k}</span>{/each}
          </button>
        {/key}
      {:else if !isSlot}
        <button class="hk add" title="Give this sound a hotkey" onclick={() => recordHotkey(sound.id)}>
          <Plus size={12} strokeWidth={2.6} /> Hotkey
        </button>
      {/if}
    </div>
  </div>

  <div class="name" title={sound.name}>
    {#each nameParts as part}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}
  </div>

  {#if isSlot}
    <div class="slot-actions" title="Drop a clip or a link on this tile">
      <button class="sbtn grow" onclick={findOnline} title="Search myinstants.com for this clip"><Search size={13} /> Find it</button>
      <button class="sbtn" onclick={() => (app.modal = { type: 'url', slotId: sound.id })} title="Paste a link"><Link size={13} /></button>
      <button class="sbtn" onclick={() => pickFiles({ slotId: sound.id })} title="Choose a file"><FileAudio size={13} /></button>
    </div>
    {#if dropHover}<div class="drop-it" transition:scale={{ duration: 200, start: 0.8 }}>Drop it!</div>{/if}
  {:else}
    <div class="bottom">
      <div class="wave">
        {#if peaks}
          {#each [0, 1] as layer}
            <svg class:fill={layer === 1} viewBox="0 0 {peaks.length * 4} 28" preserveAspectRatio="none" aria-hidden="true">
              {#each peaks as p, i}
                {@const h = Math.max(2.5, p * 26)}
                <rect x={i * 4} y={(28 - h) / 2} width="2.4" height={h} rx="1.2" />
              {/each}
            </svg>
          {/each}
        {:else}
          <div class="wave-loading"></div>
        {/if}
      </div>
      <div class="meta">
        {#if playing}
          <span class="eq"><i></i><i></i><i></i><i></i></span>
        {:else if selected}
          <span class="enter" title="Press Enter to play">↵</span>
        {:else if duration}
          <span class="dur">{fmt(duration)}</span>
        {/if}
      </div>
    </div>
  {/if}

  <div class="acts">
    <button
      class="act"
      class:on={sound.favorite}
      title={sound.favorite ? 'Unfavorite' : 'Favorite'}
      onclick={() => updateSound(sound.id, { favorite: !sound.favorite })}
    >
      <Star size={14} fill={sound.favorite ? 'currentColor' : 'none'} />
    </button>
    <button class="act" title="Edit" onclick={edit}><Pencil size={14} /></button>
  </div>

  {#if recording}
    <div class="rec" role="presentation" onclick={stopRecording} transition:fade={{ duration: 140 }}>
      <div class="rec-key" in:scale={{ duration: 300, start: 0.8, easing: backOut }}>
        {#if recording.mods.length}
          {#each recording.mods as m}<span class="chip">{m}</span><span class="plus">+</span>{/each}
          <span class="dots"><i></i><i></i><i></i></span>
        {:else}
          <Keyboard size={18} /> Press a key
        {/if}
      </div>
      {#if recording.error}
        <div class="rec-err" in:fade={{ duration: 120 }}>{recording.error}</div>
      {:else}
        <div class="rec-hint">Try the numpad · Esc cancels</div>
      {/if}
      {#if sound.hotkey}
        <button
          class="sbtn rec-remove"
          onclick={(e) => {
            e.stopPropagation();
            stopRecording();
            updateSound(sound.id, { hotkey: null });
          }}
        >
          <X size={12} /> Remove hotkey
        </button>
      {/if}
    </div>
  {/if}

  {#if playing}
    <button class="stop" title="Stop" onclick={() => stopSound(sound.id)} transition:scale={{ duration: 200, start: 0.4 }}>
      <Square size={11} fill="currentColor" />
    </button>
  {/if}
</div>

<style>
  @property --spin {
    syntax: '<angle>';
    initial-value: 0deg;
    inherits: false;
  }

  .tile {
    --p: 0;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 148px;
    padding: 14px 14px 12px;
    border-radius: 20px;
    cursor: pointer;
    overflow: hidden;
    isolation: isolate;
    outline: none;
    background:
      radial-gradient(120% 90% at 0% 0%, color-mix(in oklab, var(--c) 30%, transparent), transparent 62%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.015));
    border: 1px solid color-mix(in oklab, var(--c) 26%, rgba(255, 255, 255, 0.06));
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.07) inset,
      0 12px 30px -16px rgba(0, 0, 0, 0.8);
    transition:
      transform 0.35s var(--spring),
      box-shadow 0.3s var(--ease),
      border-color 0.3s,
      opacity 0.2s;
  }
  .tile:hover {
    transform: translateY(-4px);
    border-color: color-mix(in oklab, var(--c) 55%, transparent);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.09) inset,
      0 18px 40px -16px color-mix(in oklab, var(--c) 55%, transparent);
  }
  .tile:focus-visible {
    border-color: var(--c);
  }
  .tile.selected {
    border-color: var(--c);
    box-shadow:
      0 0 0 2px color-mix(in oklab, var(--c) 70%, transparent),
      0 18px 44px -14px color-mix(in oklab, var(--c) 70%, transparent);
    transform: translateY(-3px);
  }
  .name mark {
    color: inherit;
    background: color-mix(in oklab, var(--c) 45%, transparent);
    border-radius: 4px;
    padding: 0 1px;
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--c) 60%, transparent);
  }
  .enter {
    display: grid;
    place-items: center;
    width: 22px;
    height: 20px;
    border-radius: 6px;
    font-size: 12px;
    color: #120c1a;
    background: var(--c);
    animation: nudge-in 1s ease-in-out infinite;
  }
  @keyframes nudge-in {
    50% {
      transform: translateX(-2px);
    }
  }
  .tile.dragging {
    opacity: 0.35;
    transform: scale(0.96);
  }

  /* animated gradient ring while playing */
  .ring {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    padding: 2px;
    background: conic-gradient(from var(--spin), var(--c), #fff 12%, var(--c) 25%, transparent 45%, var(--c) 70%, #fff 82%, var(--c));
    -webkit-mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    opacity: 0;
    transition: opacity 0.3s;
    pointer-events: none;
    z-index: 2;
  }
  .tile.playing .ring {
    opacity: 1;
    animation: spin 1.6s linear infinite;
  }
  @keyframes spin {
    to {
      --spin: 360deg;
    }
  }
  .tile.playing {
    border-color: transparent;
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.09) inset,
      0 0 0 1px color-mix(in oklab, var(--c) 30%, transparent),
      0 18px 50px -12px color-mix(in oklab, var(--c) 70%, transparent);
  }
  .sheen {
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(90deg, color-mix(in oklab, var(--c) 22%, transparent), transparent);
    transform-origin: left;
    transform: scaleX(var(--p));
    opacity: 0;
    transition: opacity 0.3s;
  }
  .tile.playing .sheen {
    opacity: 1;
  }

  .ripple {
    position: absolute;
    width: 20px;
    height: 20px;
    margin: -10px 0 0 -10px;
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in oklab, var(--c) 70%, white), transparent 70%);
    pointer-events: none;
    animation: ripple 0.65s var(--ease) forwards;
    z-index: -1;
  }
  @keyframes ripple {
    from {
      transform: scale(0);
      opacity: 0.7;
    }
    to {
      transform: scale(22);
      opacity: 0;
    }
  }

  .top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }
  .emoji {
    font-size: 30px;
    line-height: 1;
    filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.45));
    transition: transform 0.4s var(--spring);
  }
  .tile:hover .emoji {
    transform: scale(1.12) rotate(-6deg);
  }
  .tile.playing .emoji {
    animation: bob 0.9s ease-in-out infinite;
  }
  @keyframes bob {
    0%,
    100% {
      transform: translateY(0) rotate(0);
    }
    25% {
      transform: translateY(-3px) rotate(-7deg);
    }
    75% {
      transform: translateY(1px) rotate(6deg);
    }
  }
  .top-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    transition: opacity 0.2s;
  }
  .keys {
    display: flex;
    align-items: center;
    gap: 3px;
    color: var(--text);
  }
  .hk {
    border-radius: 8px;
    transition:
      transform 0.25s var(--spring),
      background 0.15s,
      box-shadow 0.15s,
      opacity 0.2s;
  }
  .keys.hk {
    padding: 2px;
    margin: -2px;
  }
  .keys.hk:hover {
    background: color-mix(in oklab, var(--c) 30%, transparent);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--c) 60%, transparent);
    transform: scale(1.06);
  }
  .add {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 22px;
    padding: 0 8px 0 6px;
    font-size: 11px;
    font-weight: 700;
    color: var(--muted);
    border: 1px dashed color-mix(in oklab, var(--c) 55%, rgba(255, 255, 255, 0.25));
    background: rgba(0, 0, 0, 0.25);
    opacity: 0;
    transform: translateY(-4px);
  }
  .tile:hover .add,
  .tile:focus-within .add {
    opacity: 1;
    transform: none;
  }
  .add:hover {
    color: var(--text);
    border-style: solid;
    background: color-mix(in oklab, var(--c) 28%, rgba(0, 0, 0, 0.3));
    transform: scale(1.06);
  }
  .keys.bad {
    color: #ffb3ba;
  }
  .keys.bad .chip {
    border-color: rgba(255, 93, 108, 0.6);
    background: rgba(255, 93, 108, 0.2);
  }

  .name {
    flex: none;
    font-family: var(--display);
    font-weight: 600;
    font-size: 15.5px;
    line-height: 1.2;
    letter-spacing: 0.005em;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
  }

  .bottom {
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .wave {
    position: relative;
    flex: 1;
    height: 26px;
  }
  .wave svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    fill: rgba(255, 255, 255, 0.2);
    transition: fill 0.3s;
  }
  .tile:hover .wave svg {
    fill: rgba(255, 255, 255, 0.3);
  }
  .wave svg.fill {
    fill: var(--c);
    filter: drop-shadow(0 0 6px color-mix(in oklab, var(--c) 70%, transparent));
    clip-path: inset(0 calc((1 - var(--p)) * 100%) 0 0);
  }
  .wave-loading {
    height: 4px;
    margin-top: 11px;
    border-radius: 4px;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.15), transparent);
    background-size: 200% 100%;
    animation: shimmer 1.2s linear infinite;
  }
  @keyframes shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }
  .meta {
    width: 34px;
    display: flex;
    justify-content: flex-end;
    font-size: 11px;
    font-weight: 600;
    color: var(--dim);
    font-variant-numeric: tabular-nums;
  }
  .eq {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 14px;
  }
  .eq i {
    width: 3px;
    border-radius: 2px;
    background: var(--c);
    animation: eq 0.9s ease-in-out infinite;
  }
  .eq i:nth-child(2) {
    animation-delay: -0.3s;
  }
  .eq i:nth-child(3) {
    animation-delay: -0.6s;
  }
  .eq i:nth-child(4) {
    animation-delay: -0.15s;
  }
  @keyframes eq {
    0%,
    100% {
      height: 25%;
    }
    50% {
      height: 100%;
    }
  }

  /* hover actions */
  .acts {
    position: absolute;
    right: 10px;
    bottom: 44px;
    display: flex;
    gap: 4px;
    opacity: 0;
    transform: translateY(6px);
    transition:
      opacity 0.2s,
      transform 0.3s var(--spring);
    z-index: 3;
  }
  .tile:hover .acts,
  .tile:focus-within .acts {
    opacity: 1;
    transform: none;
  }
  .act {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 9px;
    background: rgba(12, 9, 20, 0.7);
    border: 1px solid var(--line-strong);
    color: var(--muted);
    backdrop-filter: blur(6px);
    transition:
      color 0.15s,
      transform 0.2s var(--spring),
      background 0.15s;
  }
  .act:hover {
    color: var(--text);
    transform: scale(1.1);
    background: rgba(30, 24, 44, 0.9);
  }
  .act.on {
    color: var(--potato);
  }

  .stop {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--c);
    color: #120c1a;
    box-shadow: 0 0 0 4px color-mix(in oklab, var(--c) 30%, transparent);
    z-index: 4;
    transition: transform 0.2s var(--spring);
  }
  .stop:hover {
    transform: scale(1.12);
  }
  .tile.playing .top-right {
    opacity: 0;
  }

  /* listening for a new hotkey */
  .tile.recording {
    cursor: default;
    transform: translateY(-3px);
    border-color: var(--c);
    box-shadow:
      0 0 0 2px color-mix(in oklab, var(--c) 70%, transparent),
      0 0 0 7px color-mix(in oklab, var(--c) 18%, transparent),
      0 18px 44px -14px color-mix(in oklab, var(--c) 70%, transparent);
    animation: listen 1.4s ease-in-out infinite;
  }
  @keyframes listen {
    50% {
      box-shadow:
        0 0 0 2px var(--c),
        0 0 0 10px color-mix(in oklab, var(--c) 8%, transparent),
        0 18px 44px -14px color-mix(in oklab, var(--c) 70%, transparent);
    }
  }
  .tile > .top,
  .tile > .name,
  .tile > .bottom {
    transition: opacity 0.18s;
  }
  .tile.recording > .top,
  .tile.recording > .name,
  .tile.recording > .bottom,
  .tile.recording .acts {
    opacity: 0;
    pointer-events: none;
  }
  .rec {
    position: absolute;
    inset: 0;
    z-index: 6;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px;
    text-align: center;
    background:
      radial-gradient(120% 100% at 50% 0%, color-mix(in oklab, var(--c) 30%, transparent), transparent 70%),
      rgba(11, 9, 18, 0.55);
  }
  .rec-key {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    font-family: var(--display);
    font-weight: 600;
    font-size: 16px;
  }
  .rec-key .chip {
    height: 26px;
    font-size: 12.5px;
    border-color: color-mix(in oklab, var(--c) 60%, transparent);
  }
  .plus {
    color: var(--dim);
    font-size: 12px;
  }
  .dots {
    display: flex;
    gap: 3px;
  }
  .dots i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--c);
    animation: blink 1s ease-in-out infinite;
  }
  .dots i:nth-child(2) {
    animation-delay: 0.15s;
  }
  .dots i:nth-child(3) {
    animation-delay: 0.3s;
  }
  @keyframes blink {
    50% {
      opacity: 0.25;
      transform: translateY(-2px);
    }
  }
  .rec-hint {
    font-size: 11px;
    color: var(--dim);
  }
  .rec-err {
    font-size: 11.5px;
    line-height: 1.3;
    color: #ffb3ba;
    max-width: 210px;
  }
  .rec-remove {
    height: 24px;
    font-size: 11px;
  }

  /* empty slot */
  .tile.slot {
    background: rgba(255, 255, 255, 0.02);
    border: 1.5px dashed color-mix(in oklab, var(--c) 40%, rgba(255, 255, 255, 0.15));
    box-shadow: none;
    cursor: default;
  }
  .tile.slot .emoji {
    filter: grayscale(0.5) drop-shadow(0 4px 10px rgba(0, 0, 0, 0.45));
    opacity: 0.75;
  }
  .tile.slot .name {
    color: var(--muted);
  }
  .tile.slot.drop-hover {
    border-style: solid;
    border-color: var(--c);
    background: color-mix(in oklab, var(--c) 14%, transparent);
    transform: scale(1.03);
  }
  .tile.slot .acts {
    bottom: auto;
    top: 10px;
    right: 10px;
  }
  .slot-actions {
    margin-top: auto;
    display: flex;
    gap: 5px;
  }
  .drop-it {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-family: var(--display);
    font-weight: 600;
    font-size: 20px;
    background: color-mix(in oklab, var(--c) 22%, rgba(11, 9, 18, 0.7));
    pointer-events: none;
    z-index: 5;
  }
  .sbtn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    white-space: nowrap;
    min-width: 30px;
    height: 26px;
    padding: 0 8px;
    border-radius: 8px;
    font-size: 11.5px;
    font-weight: 650;
    background: color-mix(in oklab, var(--c) 18%, rgba(255, 255, 255, 0.04));
    border: 1px solid color-mix(in oklab, var(--c) 35%, transparent);
    transition:
      background 0.15s,
      transform 0.2s var(--spring);
  }
  .sbtn.grow {
    flex: 1;
  }
  .sbtn:hover {
    background: color-mix(in oklab, var(--c) 32%, transparent);
    transform: translateY(-1px);
  }
</style>
