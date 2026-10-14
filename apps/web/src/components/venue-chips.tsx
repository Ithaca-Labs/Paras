import Link from 'next/link';

/** Multi-select Venue filter; each chip links to the Explore URL with that Venue toggled. */
export function VenueChips({
  venues,
  selected,
  hrefFor,
}: {
  venues: { id: string; name: string }[];
  selected: string[];
  hrefFor: (next: string[]) => string;
}) {
  return (
    <nav aria-label="Venues" className="flex flex-wrap gap-2 px-1 pt-3 text-sm">
      {venues.map((v) => {
        const on = selected.includes(v.id);
        return (
          <Link
            key={v.id}
            href={hrefFor(on ? selected.filter((s) => s !== v.id) : [...selected, v.id])}
            aria-current={on ? 'true' : undefined}
            className={`rounded-full border px-3 py-1 transition ${
              on
                ? 'border-fg bg-fg text-bg'
                : 'border-border text-muted hover:border-fg/40 hover:text-fg'
            }`}
          >
            {v.name}
          </Link>
        );
      })}
    </nav>
  );
}
