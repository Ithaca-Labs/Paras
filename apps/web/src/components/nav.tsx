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
            className={`rounded-lg px-3 py-1.5 text-sm ${
              active ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg'
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
