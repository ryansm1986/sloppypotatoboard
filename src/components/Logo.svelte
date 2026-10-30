<script>
  let { size = 32, waves = true, pulse = 0 } = $props();
  let el = $state();

  $effect(() => {
    if (!pulse || !el) return;
    el.animate(
      [
        { transform: 'rotate(0) scale(1)' },
        { transform: 'rotate(-10deg) scale(1.12)' },
        { transform: 'rotate(8deg) scale(0.96)' },
        { transform: 'rotate(-3deg) scale(1.03)' },
        { transform: 'rotate(0) scale(1)' },
      ],
      { duration: 520, easing: 'cubic-bezier(.3,1.4,.5,1)' },
    );
  });
</script>

<svg bind:this={el} width={size} height={size} viewBox="0 0 128 128" aria-hidden="true">
  <defs>
    <radialGradient id="potato-body" cx="38%" cy="30%" r="75%">
      <stop offset="0" stop-color="#ffe6a8" />
      <stop offset="0.45" stop-color="#f5b75e" />
      <stop offset="1" stop-color="#b8702f" />
    </radialGradient>
  </defs>
  <ellipse cx="62" cy="113" rx="34" ry="6" fill="#000" opacity="0.28" />
  <path
    d="M24 66 C20 41 39 21 63 19 C90 17 108 35 106 60 C104 87 85 107 59 106 C39 105 27 88 24 66 Z"
    fill="url(#potato-body)"
  />
  <ellipse cx="46" cy="36" rx="13" ry="6" transform="rotate(-28 46 36)" fill="#fff" opacity="0.32" />
  <g fill="#9a5622" opacity="0.5">
    <circle cx="36" cy="50" r="2.4" />
    <circle cx="88" cy="88" r="2" />
    <circle cx="95" cy="42" r="1.8" />
    <circle cx="44" cy="92" r="2.2" />
  </g>
  <ellipse cx="41" cy="73" rx="6.5" ry="3.6" fill="#ff6b8b" opacity="0.38" />
  <ellipse cx="89" cy="68" rx="6.5" ry="3.6" fill="#ff6b8b" opacity="0.38" />
  <circle cx="52" cy="57" r="9.5" fill="#fff" />
  <circle cx="55" cy="60" r="4.4" fill="#1b1020" />
  <circle cx="56.5" cy="58.5" r="1.4" fill="#fff" />
  <circle cx="77" cy="53" r="11" fill="#fff" />
  <circle cx="73.5" cy="50" r="4.8" fill="#1b1020" />
  <circle cx="75" cy="48.5" r="1.5" fill="#fff" />
  <path d="M53 73 C55 89 77 91 81 71 C72 75 62 75 53 73 Z" fill="#4a1d12" />
  <path d="M60 82 C64 88.5 74 88 77 80 C71 83 65 83.5 60 82 Z" fill="#ff6b8b" />
  {#if waves}
    <path d="M108 60 Q116 72 108 84" stroke="#ff4f8b" stroke-width="5.5" stroke-linecap="round" fill="none" />
    <path d="M117 51 Q129 72 117 93" stroke="#ff8a3d" stroke-width="5.5" stroke-linecap="round" fill="none" opacity="0.85" />
  {/if}
</svg>

<style>
  svg {
    display: block;
    overflow: visible;
    transform-origin: 50% 70%;
  }
</style>
