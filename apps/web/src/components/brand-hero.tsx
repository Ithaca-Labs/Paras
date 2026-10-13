'use client';

import { useRef } from 'react';

/** Brand banner with pointer parallax. Light/dark art swap via the --banner token. */
export function BrandHero({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.pointerType !== 'mouse') return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--px', `${((e.clientX - r.left) / r.width - 0.5) * 2}`);
    el.style.setProperty('--py', `${((e.clientY - r.top) / r.height - 0.5) * 2}`);
  };
  const reset = () => {
    ref.current?.style.setProperty('--px', '0');
    ref.current?.style.setProperty('--py', '0');
  };
  return (
    <div
      ref={ref}
      onPointerMove={move}
      onPointerLeave={reset}
      className="rise relative mb-8 aspect-[3/1] max-h-64 w-full overflow-hidden rounded-card border border-border shadow-[0_20px_40px_-28px_rgb(30_43_63/0.5)]"
    >
      <div
        aria-hidden
        className="absolute -inset-4 bg-cover bg-center transition-transform duration-700 ease-[var(--ease-ink)] motion-reduce:transform-none"
        style={{
          backgroundImage: 'var(--banner)',
          transform:
            'translate3d(calc(var(--px, 0) * -10px), calc(var(--py, 0) * -6px), 0) scale(1.04)',
        }}
      />
      {children && (
        <div className="absolute bottom-4 left-4 rounded-full border border-gold/50 bg-bg/80 px-4 py-1.5 backdrop-blur-sm">
          {children}
        </div>
      )}
    </div>
  );
}
