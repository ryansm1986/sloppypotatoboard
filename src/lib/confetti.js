const COLORS = ['#ffc35a', '#ff8a3d', '#ff4f8b', '#8b5cf6', '#2dd4bf', '#4ade80', '#ffffff'];

/** Fire a one-shot confetti burst from a point (defaults to screen center). */
export function confetti({ x = innerWidth / 2, y = innerHeight / 2, count = 170 } = {}) {
  const canvas = document.createElement('canvas');
  const dpr = devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: 100 });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const parts = Array.from({ length: count }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = 6 + Math.random() * 11;
    return {
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 7,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 6,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      c: COLORS[(Math.random() * COLORS.length) | 0],
      round: Math.random() < 0.3,
    };
  });

  const start = performance.now();
  const frame = (now) => {
    const t = now - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.38;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / 2600);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      }
      ctx.restore();
    }
    if (t < 2700) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
