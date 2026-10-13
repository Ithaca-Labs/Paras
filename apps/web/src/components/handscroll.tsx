'use client';

import { useEffect, useRef } from 'react';

/**
 * Brand banner as a handscroll: unrolls from the centre on load, drifts with the pointer, and
 * the pointer leaves a fading ink trail across it. Light/dark art swap via the --banner token.
 */
export function Handscroll({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = box.current;
    const cv = ink.current;
    if (!el || !cv || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = cv.getContext('2d')!;
    const dpr = devicePixelRatio || 1;
    const size = () => {
      cv.width = el.clientWidth * dpr;
      cv.height = el.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const pts: { x: number; y: number; t: number }[] = [];
    let frame = 0;
    const draw = () => {
      const now = performance.now();
      while (pts.length && now - pts[0]!.t > 700) pts.shift();
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const ink = getComputedStyle(el).getPropertyValue('--fg');
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const life = 1 - (now - b.t) / 700;
        ctx.strokeStyle = ink;
        ctx.globalAlpha = life * 0.55;
        ctx.lineWidth = 1 + life * 7;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      frame = pts.length ? requestAnimationFrame(draw) : 0;
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      el.style.setProperty('--px', `${(x / r.width - 0.5) * 2}`);
      el.style.setProperty('--py', `${(y / r.height - 0.5) * 2}`);
      if (e.pointerType !== 'mouse') return;
      pts.push({ x, y, t: performance.now() });
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const leave = () => {
      el.style.setProperty('--px', '0');
      el.style.setProperty('--py', '0');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    addEventListener('resize', size);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      removeEventListener('resize', size);
    };
  }, []);

  return (
    <section className="relative mb-8 overflow-hidden border-y border-gold/50 bg-surface shadow-[0_24px_60px_-40px_rgb(30_43_63/0.55)] sm:rounded-[1.5rem] sm:border">
      <div ref={box} className="unroll relative aspect-[3/1] max-h-72 w-full overflow-hidden">
        <div
          aria-hidden
          className="absolute -inset-6 bg-cover bg-center transition-transform duration-1000 ease-[var(--ease-ink)]"
          style={{
            backgroundImage: 'var(--banner)',
            transform: 'translate3d(calc(var(--px, 0) * -12px), calc(var(--py, 0) * -6px), 0)',
          }}
        />
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-b from-transparent to-surface"
        />
        <canvas ref={ink} aria-hidden className="pointer-events-none absolute inset-0 size-full" />
      </div>
      {children}
    </section>
  );
}
