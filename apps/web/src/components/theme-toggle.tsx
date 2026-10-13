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
      className="group grid size-8 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg"
    >
      <svg viewBox="0 0 24 24" className="size-[18px] overflow-visible" aria-hidden>
        <circle
          cx="12"
          cy="12"
          r="7"
          className={`origin-center transition-all duration-500 ease-[var(--ease-ink)] ${
            dark ? 'fill-gold' : 'fill-seal group-hover:scale-110'
          }`}
        />
        {/* Shadow disc slides over the sun to cut the crescent. */}
        <circle
          cx="12"
          cy="12"
          r="7"
          className={`fill-bg transition-transform duration-500 ease-[var(--ease-ink)] ${
            dark ? 'translate-x-[4px] -translate-y-[3px]' : 'translate-x-[14px] -translate-y-[10px]'
          }`}
        />
      </svg>
    </button>
  );
}
