/** Lightweight canvas-based confetti burst — 120 pieces, brand palette,
 *  gravity + fade, auto-cleanup. Shared by the Home page's one-shot
 *  'onboarding complete' celebration and the Tasks page's per-task one, so
 *  the two can't drift apart. */
export function fireConfetti() {
  // Every other animation in the app respects this; a full-screen particle
  // burst is the one that most needs to.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const colors = ['#e88f30', '#df8417', '#f0a653', '#2f8f5b', '#3f7cb0', '#c94a3c', '#fbf9f4'];
  const pieces = Array.from({ length: 120 }, () => ({
    x: canvas.width / 2 + (Math.random() - 0.5) * 200,
    y: canvas.height * 0.45,
    vx: (Math.random() - 0.5) * 18,
    vy: -Math.random() * 18 - 6,
    r: Math.random() * 6 + 3,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI * 2,
    rv: (Math.random() - 0.5) * 0.3,
    alpha: 1,
  }));
  let frame = 0;
  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of pieces) {
      p.vy += 0.35;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.rv;
      p.alpha -= 0.008;
      if (p.alpha <= 0) continue;
      alive = true;
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.r / 2, -p.r, p.r, p.r * 2);
      ctx.restore();
    }
    frame++;
    if (alive && frame < 200) requestAnimationFrame(tick);
    else canvas.remove();
  }
  requestAnimationFrame(tick);
}
