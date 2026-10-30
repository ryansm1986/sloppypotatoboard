<script>
  import { X } from '@lucide/svelte';
  import { fade } from 'svelte/transition';
  import { backOut, cubicIn } from 'svelte/easing';

  let { title = '', subtitle = '', width = 520, onclose, children, footer, header, dismissible = true } = $props();

  function pop(node, { out = false } = {}) {
    return {
      duration: out ? 160 : 380,
      easing: out ? cubicIn : backOut,
      css: (t) => `opacity:${Math.min(1, t * 1.6)}; transform: translateY(${(1 - t) * 18}px) scale(${0.92 + 0.08 * t})`,
    };
  }

  function onKey(e) {
    if (e.key === 'Escape' && dismissible && !e.defaultPrevented) onclose?.();
  }
</script>

<svelte:window onkeydown={onKey} />

<div
  class="backdrop"
  role="presentation"
  transition:fade={{ duration: 220 }}
  onmousedown={(e) => e.target === e.currentTarget && dismissible && onclose?.()}
>
  <div class="panel" role="dialog" aria-modal="true" aria-label={title} style="width: {width}px" in:pop out:pop={{ out: true }}>
    {#if header}
      {@render header()}
    {:else if title}
      <div class="head">
        <div>
          <h2>{title}</h2>
          {#if subtitle}<p>{subtitle}</p>{/if}
        </div>
        {#if dismissible}
          <button class="close" title="Close" onclick={() => onclose?.()}><X size={18} /></button>
        {/if}
      </div>
    {/if}
    <div class="body">
      {@render children()}
    </div>
    {#if footer}
      <div class="foot">{@render footer()}</div>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 30px;
    background: rgba(6, 4, 12, 0.6);
    backdrop-filter: blur(8px);
  }
  .panel {
    max-width: 100%;
    max-height: calc(100vh - 60px);
    display: flex;
    flex-direction: column;
    border-radius: 24px;
    background: linear-gradient(180deg, rgba(36, 28, 52, 0.96), rgba(22, 17, 33, 0.97));
    border: 1px solid var(--line-strong);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.08) inset,
      0 40px 100px -20px rgba(0, 0, 0, 0.85);
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 22px 24px 6px;
  }
  h2 {
    margin: 0;
    font-family: var(--display);
    font-weight: 600;
    font-size: 22px;
  }
  .head p {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 13px;
  }
  .close {
    width: 34px;
    height: 34px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 11px;
    color: var(--muted);
    transition:
      background 0.15s,
      color 0.15s,
      transform 0.25s var(--spring);
  }
  .close:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text);
    transform: rotate(90deg);
  }
  .body {
    padding: 16px 24px 22px;
    overflow-y: auto;
    user-select: text;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 24px;
    border-top: 1px solid var(--line);
    background: rgba(0, 0, 0, 0.18);
  }
</style>
