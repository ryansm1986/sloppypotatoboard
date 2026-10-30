<script>
  import { CircleCheck, Info, TriangleAlert } from '@lucide/svelte';
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { backOut } from 'svelte/easing';
  import { app, dismissToast } from '../lib/store.svelte.js';
</script>

<div class="toasts">
  {#each app.toasts as t (t.id)}
    <div class="toast {t.kind}" animate:flip={{ duration: 250 }} in:fly={{ x: 40, duration: 380, easing: backOut }} out:fly={{ x: 40, duration: 200 }}>
      {#if t.kind === 'success'}<CircleCheck size={17} />{:else if t.kind === 'error'}<TriangleAlert size={17} />{:else}<Info size={17} />{/if}
      <span>{t.message}</span>
      {#if t.action}
        <button
          class="act"
          onclick={() => {
            t.action.run();
            dismissToast(t.id);
          }}>{t.action.label}</button
        >
      {/if}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 20px;
    bottom: 110px;
    z-index: 60;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    max-width: 380px;
    padding: 11px 14px;
    border-radius: 14px;
    background: rgba(32, 25, 46, 0.94);
    border: 1px solid var(--line-strong);
    box-shadow: 0 16px 40px -12px rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(12px);
    font-size: 13px;
    font-weight: 500;
    pointer-events: auto;
  }
  .toast :global(svg) {
    flex: none;
    margin-top: 1px;
    color: var(--teal);
  }
  .toast.success :global(svg) {
    color: var(--green);
  }
  .act {
    flex: none;
    align-self: center;
    margin-left: 4px;
    height: 26px;
    padding: 0 10px;
    border-radius: 8px;
    font-weight: 650;
    font-size: 12px;
    color: #22110a;
    background: var(--grad);
  }
  .toast.error {
    border-color: rgba(255, 93, 108, 0.4);
  }
  .toast.error :global(svg) {
    color: var(--red);
  }
</style>
