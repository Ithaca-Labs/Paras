/** Shared loading / empty / error states. Use these in every page's `loading.tsx` / `error.tsx`. */

export function CardSkeletons({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="h-44 animate-pulse rounded-card border border-border bg-surface-2"
        />
      ))}
    </div>
  );
}

export function ErrorState({
  message = 'Something went wrong.',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-card border border-border bg-surface p-6"
    >
      <p className="text-sm text-negative">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm text-accent-fg"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-card border border-dashed border-border p-6 text-sm text-muted">
      {children}
    </p>
  );
}
