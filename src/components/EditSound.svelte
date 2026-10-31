<script>
  import { Play, Headphones, Trash2, FileAudio, Link, Search, Star } from '@lucide/svelte';
  import Modal from './Modal.svelte';
  import HotkeyInput from './HotkeyInput.svelte';
  import { app, api, COLORS, EMOJIS, findSound, playSound, updateSound, removeSound, pickFiles } from '../lib/store.svelte.js';
  import { TAGS, tagEmoji, tagName } from '../lib/filter.svelte.js';

  let { id } = $props();
  const sound = $derived(findSound(id));
  const close = () => (app.modal = null);

  let name = $state(findSound(id)?.name ?? '');
  let volume = $state(findSound(id)?.volume ?? 1);
  let nameTimer;

  $effect(() => {
    if (!sound) close();
  });

  function onName(e) {
    name = e.currentTarget.value;
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => name.trim() && updateSound(id, { name: name.trim() }), 300);
  }

  function del() {
    const doomed = id; // the id prop reads app.modal, which close() clears
    close();
    removeSound(doomed); // undo lives in the toast
  }

  const knownTags = $derived([...new Set([...Object.keys(TAGS), ...app.library.sounds.flatMap((s) => s.tags || [])])]);

  function addTag(e) {
    const input = e.currentTarget;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault?.();
    const tag = input.value.toLowerCase().replace(/^#/, '').trim();
    input.value = '';
    if (tag && !(sound.tags || []).includes(tag)) updateSound(id, { tags: [...(sound.tags || []), tag] });
  }

  function findOnline() {
    const q = encodeURIComponent(sound.search || sound.name).replace(/%20/g, '+');
    api.openExternal(`https://www.myinstants.com/en/search/?name=${q}`);
  }
</script>

{#if sound}
  <Modal title="Edit sound" width={560} onclose={close}>
    <div class="hero" style="--c: {sound.color}">
      <div class="badge">{sound.emoji}</div>
      <div class="hero-text">
        <div class="hero-name">{name || sound.name}</div>
        <div class="hero-sub">
          {#if sound.file}
            {app.durations[id] ? `${app.durations[id].toFixed(1)} seconds` : 'Loading…'}
          {:else}
            No clip yet
          {/if}
        </div>
      </div>
      <button
        class="fav"
        class:on={sound.favorite}
        title="Favorite"
        onclick={() => updateSound(id, { favorite: !sound.favorite })}
      >
        <Star size={18} fill={sound.favorite ? 'currentColor' : 'none'} />
      </button>
    </div>

    <div class="actions">
      {#if sound.file}
        <button class="btn" onclick={() => playSound(id, { preview: true })}><Headphones size={15} /> Preview (only you)</button>
        <button class="btn" onclick={() => playSound(id)}><Play size={15} /> Play for everyone</button>
        <button class="btn ghost" onclick={() => pickFiles({ slotId: id })} title="Swap in a different audio file">
          <FileAudio size={15} /> Replace clip
        </button>
      {:else}
        <button class="btn primary" onclick={() => pickFiles({ slotId: id })}><FileAudio size={15} /> Choose file</button>
        <button class="btn" onclick={() => (app.modal = { type: 'url', slotId: id })}><Link size={15} /> Paste link</button>
        <button class="btn" onclick={findOnline}><Search size={15} /> Find it online</button>
      {/if}
    </div>

    <div class="grid">
      <label class="field full">
        <span>Name</span>
        <input class="input" value={name} oninput={onName} maxlength="80" />
      </label>

      <div class="field full">
        <span>Emoji</span>
        <div class="emojis">
          {#each EMOJIS as e}
            <button class="emo" class:sel={sound.emoji === e} onclick={() => updateSound(id, { emoji: e })}>{e}</button>
          {/each}
          <input
            class="emo-custom"
            placeholder="✏️"
            title="Type or paste any emoji (Win + . opens the emoji picker)"
            maxlength="8"
            onchange={(e) => e.currentTarget.value.trim() && updateSound(id, { emoji: e.currentTarget.value.trim() })}
          />
        </div>
      </div>

      <div class="field full">
        <span>Color</span>
        <div class="colors">
          {#each COLORS as c}
            <button
              class="swatch"
              class:sel={sound.color === c}
              style="--c: {c}"
              aria-label={c}
              onclick={() => updateSound(id, { color: c })}
            ></button>
          {/each}
        </div>
      </div>

      <label class="field">
        <span>Board</span>
        <select class="select" value={sound.category} onchange={(e) => updateSound(id, { category: e.currentTarget.value })}>
          {#each app.library.categories as c}
            <option value={c.id}>{c.emoji} {c.name}</option>
          {/each}
        </select>
      </label>

      <div class="field">
        <span>Volume <b class="val">{Math.round(volume * 100)}%</b></span>
        <input
          type="range"
          min="0"
          max="2"
          step="0.01"
          value={volume}
          style="--pct: {volume * 50}%; --accent: {sound.color}"
          oninput={(e) => (volume = Number(e.currentTarget.value))}
          onchange={() => updateSound(id, { volume })}
          ondblclick={() => {
            volume = 1;
            updateSound(id, { volume: 1 });
          }}
        />
      </div>

      <div class="field full">
        <span>Tags <small>show up as quick filter chips</small></span>
        <div class="tags">
          {#each sound.tags || [] as t (t)}
            <span class="tag">
              {tagEmoji(t)} {tagName(t)}
              <button title="Remove tag" onclick={() => updateSound(id, { tags: sound.tags.filter((x) => x !== t) })}>×</button>
            </span>
          {/each}
          <input class="tag-in" placeholder="Add a tag…" list="known-tags" maxlength="24" onkeydown={addTag} onchange={addTag} />
          <datalist id="known-tags">
            {#each knownTags as t}<option value={t}></option>{/each}
          </datalist>
        </div>
      </div>

      <div class="field full">
        <span>Global hotkey <small>works even while you're in a game</small></span>
        <HotkeyInput value={sound.hotkey} onchange={(accel) => updateSound(id, { hotkey: accel })} />
      </div>
    </div>

    {#snippet footer()}
      <button class="btn danger" onclick={del}>
        <Trash2 size={15} />
        Delete
      </button>
      <div style="flex:1"></div>
      <button class="btn primary" onclick={close}>Done</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .hero {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
    border-radius: 18px;
    background:
      radial-gradient(120% 120% at 0% 0%, color-mix(in oklab, var(--c) 35%, transparent), transparent 70%),
      rgba(255, 255, 255, 0.03);
    border: 1px solid color-mix(in oklab, var(--c) 35%, transparent);
    transition: background 0.4s;
  }
  .badge {
    width: 64px;
    height: 64px;
    flex: none;
    display: grid;
    place-items: center;
    font-size: 36px;
    border-radius: 18px;
    background: color-mix(in oklab, var(--c) 25%, rgba(0, 0, 0, 0.3));
    box-shadow: 0 10px 30px -10px color-mix(in oklab, var(--c) 70%, transparent);
    transition:
      background 0.4s,
      box-shadow 0.4s;
  }
  .hero-text {
    flex: 1;
    min-width: 0;
  }
  .hero-name {
    font-family: var(--display);
    font-weight: 600;
    font-size: 19px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hero-sub {
    color: var(--muted);
    font-size: 12.5px;
  }
  .fav {
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    border-radius: 12px;
    color: var(--muted);
    transition:
      color 0.2s,
      transform 0.3s var(--spring);
  }
  .fav:hover {
    transform: scale(1.12);
  }
  .fav.on {
    color: var(--potato);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 14px 0 18px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .full {
    grid-column: 1 / -1;
  }
  .field small {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
    color: var(--dim);
    margin-left: 6px;
  }
  .val {
    float: right;
    color: var(--text);
    letter-spacing: 0;
  }
  .emojis {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .emo {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    font-size: 19px;
    display: grid;
    place-items: center;
    transition:
      background 0.15s,
      transform 0.25s var(--spring);
  }
  .emo:hover {
    background: rgba(255, 255, 255, 0.08);
    transform: scale(1.18);
  }
  .emo.sel {
    background: rgba(255, 195, 90, 0.2);
    box-shadow: 0 0 0 1.5px var(--potato) inset;
  }
  .emo-custom {
    width: 52px;
    height: 34px;
    border-radius: 10px;
    text-align: center;
    border: 1px dashed var(--line-strong);
    background: transparent;
    outline: none;
    font-size: 16px;
  }
  .emo-custom:focus {
    border-color: var(--potato);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-height: 38px;
    padding: 5px 6px;
    border-radius: 11px;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid var(--line);
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 4px 0 9px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 600;
    background: rgba(255, 195, 90, 0.14);
    border: 1px solid rgba(255, 195, 90, 0.35);
  }
  .tag button {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  .tag button:hover {
    background: rgba(255, 255, 255, 0.12);
    color: var(--text);
  }
  .tag-in {
    flex: 1;
    min-width: 110px;
    height: 26px;
    border: 0;
    outline: 0;
    background: transparent;
    padding: 0 6px;
  }
  .colors {
    display: flex;
    gap: 8px;
  }
  .swatch {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--c);
    box-shadow: 0 4px 14px -4px var(--c);
    transition: transform 0.25s var(--spring);
  }
  .swatch:hover {
    transform: scale(1.15);
  }
  .swatch.sel {
    box-shadow:
      0 0 0 3px #1a1426,
      0 0 0 5px var(--c);
  }
</style>
