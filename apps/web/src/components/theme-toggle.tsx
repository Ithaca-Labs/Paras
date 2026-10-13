'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

/** Runs before paint (inlined in <head>) so a saved theme never flashes. */
export const themeScript = `try{var t=localStorage.getItem('paras-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}`;

const current = (): Theme =>
  (document.documentElement.dataset.theme as Theme | undefined) ??
  (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

/** Sun (the banner's red disc) by day, ink crescent by night. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(current()), []);
  const flip = () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('paras-theme', next);
    setTheme(next);
  };
  const dark = theme === 'dark';
  return (
    <button
      onClick={flip}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
      className="group grid size-8 place-items-center rounded-full text-muted hover:bg-surface hover:text-fg"
    >
      <svg viewBox="0 0 24 24" className="size-[18px] overflow-visible" aria-hidden>
        {/* Mask cuts the crescent so it works on any background. */}
        <mask id="theme-crescent">
          <rect x="-4" y="-4" width="32" height="32" fill="white" />
          <circle
            cx="12"
            cy="12"
            r="7"
            fill="black"
            className={`transition-transform duration-500 ease-[var(--ease-ink)] ${
              dark
                ? 'translate-x-[4px] -translate-y-[3px]'
                : 'translate-x-[14px] -translate-y-[10px]'
            }`}
          />
        </mask>
        <circle
          cx="12"
          cy="12"
          r="7"
          mask="url(#theme-crescent)"
          className={`origin-center transition-all duration-500 ease-[var(--ease-ink)] ${
            dark ? 'fill-gold' : 'fill-seal group-hover:scale-110'
          }`}
        />
      </svg>
    </button>
  );
}
