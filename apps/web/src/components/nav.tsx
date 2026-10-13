'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const NAV = [
  { href: '/feed', label: 'Feed' },
  { href: '/explore', label: 'Explore' },
  { href: '/vault', label: 'Vault' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/orders', label: 'Orders' },
  { href: '/settings', label: 'Settings' },
] as const;

export function Nav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex gap-0.5 overflow-x-auto nav-tray rounded-full p-1">
      {NAV.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-display text-[0.95rem] tracking-wide whitespace-nowrap transition-colors ${
              active
                ? 'bg-surface-2 font-medium text-fg'
                : 'text-muted hover:text-fg'
            }`}
          >
            {active && <span aria-hidden className="seal size-2 rounded-[2px] bg-seal" />}
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
