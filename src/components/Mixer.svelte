<script>
  import { Mic, MicOff, Gamepad2, Headphones, Square, TriangleAlert, ArrowLeftRight } from '@lucide/svelte';
  import { fly, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import Meter from './Meter.svelte';
  import { app, levels, setSettings, stopAll, toggleMute } from '../lib/store.svelte.js';
  import { keyParts } from '../lib/keys.js';

  const s = $derived(app.settings);
  const anyPlaying = $derived(Object.values(app.playing).some((p) => !p.preview));
  const micLive = $derived(app.gate.micLive && !!app.status.mic && !app.status.micError);
  const boardLive = $derived(anyPlaying);
  const talking = $derived(micLive && levels.mic > 0.04);

  const channels = [
    { key: 'micVolume', label: 'Your mic', icon: Mic, level: 'mic', max: 1.5, color: '#4ade80', tip: 'How loud your voice is in game' },
    { key: 'gameVolume', label: 'Board → game', icon: Gamepad2, level: 'game', max: 1.5, color: '#ffc35a', tip: 'How loud sounds are for everyone else' },
    { key: 'monitorVolume', label: 'Board → you', icon: Headphones, level: 'monitor', max: 1.5, color: '#b197fc', tip: 'How loud sounds are in your headphones' },
  ];
</script>

<footer class="dock">
  {#if !app.status.cable}
    <button class="warn" onclick={() => (app.modal = { type: 'setup' })} in:fly={{ y: 10, duration: 300 }}>
      <TriangleAlert size={18} />
      <div>
        <b>Games can't hear the board yet</b>
        <small>Click to set up the virtual mic (1 minute)</small>
      </div>
    </button>
  {:else}
    <div class="onair" title="What your game / Discord hears right now">
      <span class="label">Game hears</span>
      <div class="sources">
        <span class="src mic" class:live={micLive} class:talking>
          {#if s.micMuted}<MicOff size={14} />{:else}<Mic size={14} />{/if}
          You
        </span>
        <span class="link" class:swap={s.micMode === 'swap'}><ArrowLeftRight size={12} /></span>
        <span class="src board" class:live={boardLive}>
          <span class="dot"></span>
          Board
        </span>
      </div>
    </div>
  {/if}

  <div class="modes" role="radiogroup" aria-label="Mic mode">
    <div class="pill" class:right={s.micMode === 'mix'}></div>
    <button
      role="radio"
      aria-checked={s.micMode === 'swap'}
      class:active={s.micMode === 'swap'}
      onclick={() => setSettings({ micMode: 'swap' })}
      title="Your mic fades out while a sound plays, then fades right back"
    >
      Auto-swap
    </button>
    <button
      role="radio"
      aria-checked={s.micMode === 'mix'}
      class:active={s.micMode === 'mix'}
      onclick={() => setSettings({ micMode: 'mix' })}
      title="Your mic and sounds play together"
    >
      Mix
    </button>
  </div>

  <button
    class="mute"
    class:muted={s.micMuted}
    onclick={toggleMute}
    title={s.micMuted ? 'Unmute mic' : 'Mute mic (sounds still play)'}
  >
    {#key s.micMuted}
      <span in:scale={{ duration: 300, start: 0.5, easing: backOut }}>
        {#if s.micMuted}<MicOff size={17} />{:else}<Mic size={17} />{/if}
      </span>
    {/key}
  </button>

  <div class="channels">
    {#each channels as ch}
      {@const v = s[ch.key] ?? 1}
      <div class="ch" title={ch.tip}>
        <div class="ch-head">
          <ch.icon size={13} />
          <span>{ch.label}</span>
          <b>{Math.round(v * 100)}%</b>
        </div>
        <input
          type="range"
          min="0"
          max={ch.max}
          step="0.01"
          value={v}
          style="--pct: {(v / ch.max) * 100}%; --accent: {ch.color}"
          oninput={(e) => setSettings({ [ch.key]: Number(e.currentTarget.value) })}
          ondblclick={() => setSettings({ [ch.key]: 1 })}
        />
        <Meter level={levels[ch.level]} color={ch.color} />
      </div>
    {/each}
  </div>

  <button class="stopall" class:hot={anyPlaying} onclick={stopAll} title="Stop every sound">
    <Square size={14} fill="currentColor" />
    <span>Stop all</span>
    {#if s.hotkeys?.stopAll}
      <span class="keys">{#each keyParts(s.hotkeys.stopAll) as k}<span class="chip">{k}</span>{/each}</span>
    {/if}
  </button>
</footer>

<style>
  .dock {
    margin: 0 14px 14px;
    padding: 12px 14px;
    display: flex;
    align-items: center;
    gap: 14px;
    border-radius: 20px;
    background: var(--panel);
    border: 1px solid var(--line);
    backdrop-filter: blur(24px) saturate(1.4);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.06) inset,
      0 20px 50px -20px rgba(0, 0, 0, 0.8);
    position: relative;
    z-index: 4;
  }

  .warn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border-radius: 14px;
    text-align: left;
    background: linear-gradient(135deg, rgba(255, 93, 108, 0.18), rgba(255, 138, 61, 0.14));
    border: 1px solid rgba(255, 93, 108, 0.35);
    color: #ffc2c8;
    animation: nudge 2.8s ease-in-out infinite;
  }
  .warn b {
    display: block;
    color: var(--text);
    font-size: 13px;
  }
  .warn small {
    font-size: 11.5px;
  }
  @keyframes nudge {
    0%,
    86%,
    100% {
      transform: none;
    }
    90% {
      transform: translateX(-3px);
    }
    94% {
      transform: translateX(3px);
    }
  }

  .onair {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .label {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--dim);
  }
  .sources {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .src {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: 9px;
    font-size: 12.5px;
    font-weight: 650;
    color: var(--dim);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line);
    transition:
      color 0.25s,
      background 0.25s,
      border-color 0.25s,
      box-shadow 0.25s,
      opacity 0.25s;
  }
  .src.mic.live {
    color: #bbf7d0;
    background: rgba(74, 222, 128, 0.12);
    border-color: rgba(74, 222, 128, 0.35);
  }
  .src.mic.talking {
    box-shadow: 0 0 18px -2px rgba(74, 222, 128, 0.55);
  }
  .src.board .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
  }
  .src.board.live {
    color: #ffe2a8;
    background: rgba(255, 195, 90, 0.15);
    border-color: rgba(255, 195, 90, 0.45);
    box-shadow: 0 0 18px -2px rgba(255, 138, 61, 0.6);
  }
  .src.board.live .dot {
    animation: blink 0.8s ease-in-out infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }
  .link {
    color: var(--dim);
    display: grid;
    transition: transform 0.4s var(--spring);
  }
  .link.swap {
    color: var(--potato);
  }

  .modes {
    position: relative;
    display: flex;
    padding: 3px;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--line);
  }
  .modes button {
    position: relative;
    z-index: 1;
    width: 86px;
    height: 30px;
    font-size: 12.5px;
    font-weight: 650;
    color: var(--muted);
    transition: color 0.25s;
  }
  .modes button.active {
    color: #22110a;
  }
  .pill {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 86px;
    height: 30px;
    border-radius: 9px;
    background: var(--grad);
    box-shadow: 0 4px 14px -4px rgba(255, 110, 70, 0.7);
    transition: transform 0.4s var(--spring);
  }
  .pill.right {
    transform: translateX(86px);
  }

  .mute {
    width: 38px;
    height: 38px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--line);
    color: var(--green);
    transition:
      background 0.2s,
      color 0.2s,
      border-color 0.2s;
  }
  .mute span {
    display: grid;
  }
  .mute:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .mute.muted {
    color: var(--red);
    background: rgba(255, 93, 108, 0.14);
    border-color: rgba(255, 93, 108, 0.4);
  }

  .channels {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(3, minmax(110px, 1fr));
    gap: 18px;
    min-width: 0;
    padding: 0 6px;
  }
  .ch {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .ch-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }
  .ch-head span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ch-head b {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    color: var(--text);
    font-weight: 650;
  }

  .stopall {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 42px;
    padding: 0 14px;
    border-radius: 13px;
    font-weight: 700;
    font-size: 13px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--line);
    color: var(--muted);
    transition:
      background 0.2s,
      color 0.2s,
      border-color 0.2s,
      transform 0.2s var(--spring),
      box-shadow 0.3s;
  }
  .stopall:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.1);
  }
  .stopall:active {
    transform: scale(0.95);
  }
  .stopall.hot {
    color: #fff;
    background: linear-gradient(135deg, #ff5d6c, #ff4f8b);
    border-color: transparent;
    box-shadow: 0 8px 26px -8px rgba(255, 79, 139, 0.8);
  }
  .keys {
    display: flex;
    gap: 3px;
  }

  @media (max-width: 1120px) {
    .onair .label,
    .stopall > span:not(.keys) {
      display: none;
    }
  }
</style>
