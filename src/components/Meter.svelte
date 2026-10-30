<script>
  let { level = 0, color = 'var(--green)' } = $props();
  // dB scale feels natural: -60 dB .. 0 dB
  const pct = $derived(Math.max(0, Math.min(1, (20 * Math.log10(Math.max(level, 1e-5)) + 60) / 60)));
</script>

<div class="meter" style="--c: {color}">
  <div class="fill" style="transform: scaleX({pct})"></div>
  <div class="ticks"></div>
</div>

<style>
  .meter {
    position: relative;
    height: 5px;
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.07);
    overflow: hidden;
  }
  .fill {
    position: absolute;
    inset: 0;
    transform-origin: left;
    background: linear-gradient(90deg, var(--c) 0%, var(--c) 70%, #ffd43b 86%, #ff5d6c 100%);
    background-size: 100% 100%;
    border-radius: 5px;
    will-change: transform;
  }
  .ticks {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(90deg, transparent 0 7px, rgba(11, 9, 18, 0.55) 7px 8px);
  }
</style>
