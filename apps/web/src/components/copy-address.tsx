'use client';

import { useState } from 'react';

/** Wallet address with a copy button. `short` shows `0x13ba…8a4a`. */
export function CopyAddress({ address, short }: { address: string; short?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <span className="inline-flex items-center gap-2">
      <code className={`font-mono text-xs ${short ? '' : 'break-all'}`} title={address}>
        {short ? `${address.slice(0, 6)}…${address.slice(-4)}` : address}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy wallet address"
        className="rounded-sm border border-border px-2 py-0.5 text-xs text-muted hover:text-fg"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}
