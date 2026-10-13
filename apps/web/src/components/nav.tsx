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
    <nav aria-label="Primary" className="flex gap-1">
      {NAV.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`group relative rounded-lg px-3 py-1.5 text-sm ${
              active ? 'font-medium text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'
            }`}
          >
            {label}
            <span
              aria-hidden
              className={`absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-gradient-to-r from-gold to-seal ${
                active
                  ? 'brush'
                  : 'scale-x-0 opacity-0 transition duration-300 group-hover:scale-x-100 group-hover:opacity-60'
              }`}
            />
          </Link>
        );
      })}
    </nav>
  );
}
