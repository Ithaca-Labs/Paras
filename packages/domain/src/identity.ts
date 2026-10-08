// Pure identity rules: no I/O, no clocks, no randomness.

/** Canonical email form: trimmed + lowercased. Returns null if it is not a plausible address. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/**
 * Only same-origin relative paths may round-trip through auth flows (open-redirect guard).
 * Anything else (absolute URLs, `//host`, backslashes, control chars) is dropped.
 */
export function sanitizeReturnTo(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}

export interface MergeCandidate {
  id: string;
  createdAt: Date;
}

/** Linking two existing Users: the older one survives (ties broken by id), the other is absorbed. */
export function pickMergeSurvivor<T extends MergeCandidate>(
  a: T,
  b: T,
): { survivor: T; absorbed: T } {
  const aFirst =
    a.createdAt.getTime() !== b.createdAt.getTime()
      ? a.createdAt.getTime() < b.createdAt.getTime()
      : a.id < b.id;
  return aFirst ? { survivor: a, absorbed: b } : { survivor: b, absorbed: a };
}
