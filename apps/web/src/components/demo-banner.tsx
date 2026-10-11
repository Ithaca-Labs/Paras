/** Shown on every Vault surface while the Executor simulates the Polymarket leg (testnet). */
export function DemoBanner() {
  return (
    <p role="note" className="mb-4 rounded-lg border border-warning px-3 py-2 text-sm text-warning">
      Testnet demo: Polymarket leg simulated. No real orders are placed and no real funds are used.
    </p>
  );
}
