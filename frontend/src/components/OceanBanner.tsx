import { useEffect, useRef } from 'react';

interface Props {
  height?: number;
  timeOfDay?: number;
  animSpeed?: number;
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function lerpRGB(a: number[], b: number[], t: number) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
function rgb(c: number[], a = 1) { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }

const KEYS = [
  { t: 0, skyTop: [8, 12, 30], skyHor: [34, 44, 82], sun: [228, 234, 255], glow: [140, 164, 216], wFar: [28, 42, 76], wNear: [6, 16, 32], foam: [196, 208, 234], sunH: 0.45, glit: 0.55, star: 1 },
  { t: 0.21, skyTop: [38, 44, 86], skyHor: [247, 176, 128], sun: [255, 238, 206], glow: [255, 178, 120], wFar: [176, 150, 150], wNear: [34, 62, 84], foam: [255, 244, 234], sunH: 0.35, glit: 0.7, star: 0 },
  { t: 0.33, skyTop: [64, 134, 206], skyHor: [188, 222, 236], sun: [255, 255, 246], glow: [255, 250, 224], wFar: [120, 186, 196], wNear: [20, 92, 114], foam: [255, 255, 255], sunH: 0.55, glit: 0.5, star: 0 },
  { t: 0.5, skyTop: [58, 142, 214], skyHor: [176, 216, 230], sun: [255, 255, 248], glow: [255, 252, 232], wFar: [96, 178, 188], wNear: [16, 96, 120], foam: [255, 255, 255], sunH: 0.92, glit: 0.45, star: 0 },
  { t: 0.67, skyTop: [74, 92, 156], skyHor: [255, 202, 120], sun: [255, 236, 194], glow: [255, 168, 92], wFar: [206, 164, 118], wNear: [34, 78, 98], foam: [255, 244, 228], sunH: 0.3, glit: 0.95, star: 0 },
  { t: 0.79, skyTop: [48, 38, 86], skyHor: [255, 108, 68], sun: [255, 206, 148], glow: [255, 92, 58], wFar: [188, 98, 84], wNear: [30, 42, 72], foam: [255, 222, 200], sunH: 0.3, glit: 1, star: 0.15 },
  { t: 0.84, skyTop: [8, 12, 30], skyHor: [34, 44, 82], sun: [228, 234, 255], glow: [140, 164, 216], wFar: [28, 42, 76], wNear: [6, 16, 32], foam: [196, 208, 234], sunH: 0.45, glit: 0.55, star: 1 },
  { t: 1, skyTop: [8, 12, 30], skyHor: [34, 44, 82], sun: [228, 234, 255], glow: [140, 164, 216], wFar: [28, 42, 76], wNear: [6, 16, 32], foam: [196, 208, 234], sunH: 0.45, glit: 0.55, star: 1 },
];

function getPalette(t: number) {
  let i = 0;
  while (i < KEYS.length - 1 && t > KEYS[i + 1].t) i++;
  const a = KEYS[i], b = KEYS[Math.min(i + 1, KEYS.length - 1)];
  const span = b.t - a.t || 1;
  const k = Math.max(0, Math.min(1, (t - a.t) / span));
  return {
    skyTop: lerpRGB(a.skyTop, b.skyTop, k), skyHor: lerpRGB(a.skyHor, b.skyHor, k),
    sun: lerpRGB(a.sun, b.sun, k), glow: lerpRGB(a.glow, b.glow, k),
    wFar: lerpRGB(a.wFar, b.wFar, k), wNear: lerpRGB(a.wNear, b.wNear, k),
    foam: lerpRGB(a.foam, b.foam, k), sunH: lerp(a.sunH, b.sunH, k),
    glit: lerp(a.glit, b.glit, k), star: lerp(a.star, b.star, k),
  };
}

function currentTimeOfDay(): number {
  const now = new Date();
  return (now.getHours() * 60 + now.getMinutes()) / 1440;
}

export default function OceanBanner({ height = 220, timeOfDay, animSpeed = 1 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speedRef = useRef(animSpeed);
  speedRef.current = animSpeed;
  const stateRef = useRef({
    running: true, T: 0,
    stars: Array.from({ length: 80 }, () => ({ x: Math.random(), y: Math.random() * 0.4, r: Math.random() * 1 + 0.3, tw: Math.random() * Math.PI * 2 })),
    clouds: Array.from({ length: 4 }, () => ({ x: Math.random(), y: 0.08 + Math.random() * 0.15, w: 0.15 + Math.random() * 0.18, speed: 0.000015 + Math.random() * 0.00002 })),
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const st = stateRef.current;
    st.running = true;

    let W = 0, H = 0, horizonY = 0, oceanH = 0;

    function resize() {
      const rect = canvas!.parentElement!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = rect.width; H = rect.height;
      canvas!.width = W * dpr;
      canvas!.height = H * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      horizonY = H * 0.55;
      oceanH = H - horizonY;
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);
    resize();

    function draw() {
      if (!st.running) return;
      requestAnimationFrame(draw);
      st.T += 0.008 * speedRef.current;
      if (!W || !H) return;
      const T = st.T;
      const tod = timeOfDay ?? currentTimeOfDay();
      const P = getPalette(tod);
      const sunX = W * 0.5;
      const sunY = horizonY - P.sunH * horizonY * 0.55;

      const sky = ctx!.createLinearGradient(0, 0, 0, horizonY + oceanH * 0.1);
      sky.addColorStop(0, rgb(P.skyTop));
      sky.addColorStop(0.7, rgb(lerpRGB(P.skyTop, P.skyHor, 0.55)));
      sky.addColorStop(1, rgb(P.skyHor));
      ctx!.fillStyle = sky;
      ctx!.fillRect(0, 0, W, horizonY + 2);

      if (P.star > 0.01) {
        st.stars.forEach(s => {
          const tw = 0.5 + 0.5 * Math.sin(T * 2 + s.tw);
          ctx!.fillStyle = rgb([255, 255, 255], P.star * tw * 0.9);
          ctx!.beginPath(); ctx!.arc(s.x * W, s.y * horizonY, s.r, 0, Math.PI * 2); ctx!.fill();
        });
      }

      const glowR = Math.min(W, H) * 0.5;
      const g = ctx!.createRadialGradient(sunX, sunY, 0, sunX, sunY, glowR);
      g.addColorStop(0, rgb(P.glow, 0.55));
      g.addColorStop(0.25, rgb(P.glow, 0.22));
      g.addColorStop(1, rgb(P.glow, 0));
      ctx!.fillStyle = g;
      ctx!.fillRect(0, 0, W, horizonY + oceanH * 0.4);

      const sunR = Math.min(W, H) * 0.09;
      const sd = ctx!.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
      sd.addColorStop(0, rgb(P.sun, 1));
      sd.addColorStop(0.7, rgb(P.sun, 0.95));
      sd.addColorStop(1, rgb(P.sun, 0.2));
      ctx!.fillStyle = sd;
      ctx!.beginPath(); ctx!.arc(sunX, sunY, sunR, 0, Math.PI * 2); ctx!.fill();

      st.clouds.forEach(c => {
        c.x += c.speed * speedRef.current; if (c.x > 1.3) c.x = -0.3;
        const cx = c.x * W, cy = c.y * horizonY, cw = c.w * W;
        ctx!.fillStyle = rgb(lerpRGB(P.skyHor, [255, 255, 255], 0.25), 0.16);
        for (let j = 0; j < 4; j++) {
          ctx!.beginPath();
          ctx!.ellipse(cx + j * cw * 0.22, cy + Math.sin(j) * 4, cw * (0.3 - j * 0.04), cw * 0.06, 0, 0, Math.PI * 2);
          ctx!.fill();
        }
      });

      const haze = ctx!.createLinearGradient(0, horizonY - 20, 0, horizonY + 20);
      haze.addColorStop(0, rgb(P.skyHor, 0));
      haze.addColorStop(0.5, rgb(P.skyHor, 0.45));
      haze.addColorStop(1, rgb(P.wFar, 0));
      ctx!.fillStyle = haze;
      ctx!.fillRect(0, horizonY - 20, W, 40);

      const NUM = 16;
      for (let i = 0; i < NUM; i++) {
        const depth = i / (NUM - 1);
        const yTop = horizonY + Math.pow(depth, 1.9) * oceanH;
        const amp = lerp(0.4, 18, depth);
        const wlen = lerp(30, 200, depth);
        const speed = lerp(0.12, 0.4, depth);
        const phase = T * speed + i * 0.9;
        const col = lerpRGB(P.wFar, P.wNear, depth);
        ctx!.beginPath(); ctx!.moveTo(0, H); ctx!.lineTo(0, yTop + Math.sin(phase) * amp);
        for (let x = 0; x <= W; x += 4) {
          const y = yTop + Math.sin(x / wlen + phase) * amp + Math.sin(x / (wlen * 0.4) + phase * 1.6) * amp * 0.3;
          ctx!.lineTo(x, y);
        }
        ctx!.lineTo(W, H); ctx!.closePath();
        ctx!.fillStyle = rgb(col); ctx!.fill();
        if (depth > 0.6) {
          const foamA = (depth - 0.6) / 0.4;
          for (let x = 0; x <= W; x += 8) {
            const y = yTop + Math.sin(x / wlen + phase) * amp + Math.sin(x / (wlen * 0.4) + phase * 1.6) * amp * 0.3;
            if (Math.sin(x / wlen + phase) > 0.55 && Math.random() > 0.75) {
              ctx!.fillStyle = rgb(P.foam, foamA * (0.08 + Math.random() * 0.12));
              ctx!.fillRect(x + (Math.random() - 0.5) * 4, y - Math.random() * 2, 1.5 + Math.random() * 2, 1 + Math.random());
            }
          }
        }
      }

      for (let i = 0; i < 35; i++) {
        const dy = Math.random();
        const y = horizonY + Math.pow(dy, 1.5) * oceanH;
        const spread = lerp(4, W * 0.25, dy);
        const x = sunX + (Math.random() - 0.5) * 2 * spread;
        const distFade = 1 - Math.min(1, Math.abs(x - sunX) / (spread + 1));
        const flick = 0.25 + Math.random() * 0.75;
        const a = distFade * distFade * flick * P.glit * (1 - dy * 0.25);
        if (a < 0.1) continue;
        ctx!.fillStyle = rgb(P.sun, a * 0.4);
        ctx!.fillRect(x, y, 1 + Math.random() * (1 + dy * 3), 1 + dy);
      }
    }

    draw();
    return () => { st.running = false; ro.disconnect(); };
  }, [timeOfDay]);

  return (
    <div style={{ height, borderRadius: 20, overflow: 'hidden', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
