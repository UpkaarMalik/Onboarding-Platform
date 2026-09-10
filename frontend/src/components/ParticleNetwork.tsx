import React, { useEffect, useRef } from "react";

const ParticleNetwork: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrame: number;
    let time = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;

      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;

      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      // Do NOT paint the background
      ctx.clearRect(0, 0, width, height);

      /*
       * Topographic contour lines
       */
      const lineCount = 24;
      const spacing = height / lineCount;

      ctx.lineWidth = 1;

      for (let line = 0; line < lineCount; line++) {
        ctx.beginPath();

        const baseY = line * spacing;

        for (let x = -50; x <= width + 50; x += 8) {
          const normalizedX = x / width;

          /*
           * Multiple waves combined together
           * to create natural terrain-like movement.
           */
          const wave1 =
            Math.sin(
              normalizedX * Math.PI * 2.2 +
                line * 0.22 +
                time * 0.00015
            ) * 35;

          const wave2 =
            Math.sin(
              normalizedX * Math.PI * 4.5 -
                line * 0.16 +
                time * 0.0001
            ) * 14;

          const wave3 =
            Math.sin(
              normalizedX * Math.PI * 8 +
                line * 0.08
            ) * 5;

          const y = baseY + wave1 + wave2 + wave3;

          if (x === -50) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        /*
         * Fade lines at top and bottom
         */
        const verticalFade =
          Math.sin((line / lineCount) * Math.PI);

        const alpha = 0.10 * verticalFade;

        ctx.strokeStyle = `rgba(190, 120, 45, ${alpha})`;

        ctx.stroke();
      }

      /*
       * Slowly shifting secondary contour layer
       */
      ctx.save();

      ctx.translate(
        Math.sin(time * 0.00008) * 30,
        Math.cos(time * 0.00006) * 15
      );

      for (let line = 0; line < 14; line++) {
        ctx.beginPath();

        const baseY =
          height * 0.15 + line * 45;

        for (let x = -100; x <= width + 100; x += 8) {
          const normalizedX = x / width;

          const wave =
            Math.sin(
              normalizedX * Math.PI * 3 +
                line * 0.35 +
                time * 0.00012
            ) * 45;

          const wave2 =
            Math.sin(
              normalizedX * Math.PI * 6 -
                line * 0.2
            ) * 12;

          const y = baseY + wave + wave2;

          if (x === -100) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.strokeStyle = "rgba(220, 150, 65, 0.055)";
        ctx.stroke();
      }

      ctx.restore();

      time += 16;

      animationFrame = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
        background: "transparent",
      }}
    />
  );
};

export default ParticleNetwork;