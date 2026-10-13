'use client';

import { useEffect, useRef } from 'react';

const INTERACTIVE = 'a, button, [role="button"], input, select, textarea, label';
const MAGNETIC = '[data-magnetic], button.bg-accent:not(:disabled), a.bg-accent';

/**
 * Global pointer effects, mounted once: a trailing ink cursor ring, a spotlight on `.ink-card`
 * (sets --mx/--my), ink ripples on click, and a gentle pull on primary buttons.
 * Fine pointers only; off under prefers-reduced-motion.
 */
export function PointerFx() {
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fine = matchMedia('(pointer: fine)').matches;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fine || calm || !ring.current) return;
    const el = ring.current;
    let x = -100,
      y = -100,
      rx = x,
      ry = y,
      frame = 0;
    let magnet: HTMLElement | null = null;

    const loop = () => {
      rx += (x - rx) * 0.2;
      ry += (y - ry) * 0.2;
      el.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%)`;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const move = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      el.style.opacity = '1';
      const t = e.target as Element;
      el.dataset.hover = t.closest(INTERACTIVE) ? 'true' : 'false';

      const card = t.closest<HTMLElement>('.ink-card');
      if (card) {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${x - r.left}px`);
        card.style.setProperty('--my', `${y - r.top}px`);
      }

      const m = t.closest<HTMLElement>(MAGNETIC);
      if (magnet && magnet !== m) magnet.style.translate = '';
      magnet = m;
      if (m) {
        const r = m.getBoundingClientRect();
        m.style.translate = `${(x - r.left - r.width / 2) * 0.18}px ${(y - r.top - r.height / 2) * 0.25}px`;
      }
    };
    const leave = () => (el.style.opacity = '0');
    const down = (e: PointerEvent) => {
      const drop = document.createElement('span');
      drop.className = 'ink-ripple';
      drop.style.left = `${e.clientX}px`;
      drop.style.top = `${e.clientY}px`;
      document.body.append(drop);
      drop.addEventListener('animationend', () => drop.remove());
    };

    addEventListener('pointermove', move, { passive: true });
    addEventListener('pointerdown', down, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('pointermove', move);
      removeEventListener('pointerdown', down);
      document.documentElement.removeEventListener('pointerleave', leave);
    };
  }, []);

  return (
    <div
      ref={ring}
      aria-hidden
      data-hover="false"
      className="pointer-events-none fixed top-0 left-0 z-[70] size-7 rounded-full border border-gold opacity-0 transition-[width,height,background-color,opacity] duration-300 data-[hover=true]:size-11 data-[hover=true]:bg-gold/15"
    />
  );
}
