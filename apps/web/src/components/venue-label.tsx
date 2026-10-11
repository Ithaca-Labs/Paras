import type { VenueLabel as Label } from '@paras/shared';

const tone = {
  cftc_regulated: 'text-positive',
  offshore: 'text-warning',
  play_money: 'text-muted',
  unknown: 'text-muted',
} as const;

/** Regulation + availability text for a Venue, straight from the API's `label`. */
export function VenueLabel({ label }: { label: Label }) {
  return (
    <span
      className={`rounded-full border border-border px-2 py-0.5 text-xs ${tone[label.regulation]}`}
    >
      {label.text}
    </span>
  );
}
