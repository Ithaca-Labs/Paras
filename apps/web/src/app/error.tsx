'use client';

import { ErrorState } from '@/components/states';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorState message={error.message || undefined} onRetry={reset} />;
}
