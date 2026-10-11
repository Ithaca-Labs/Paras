import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryList } from '@/components/history-list';
import { VaultGate } from '@/components/vault-gate';

const api = vi.hoisted(() => ({
  getVaultEligibility: vi.fn(),
  getDisclosures: vi.fn(),
  listHistory: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/providers', () => ({
  useSession: () => ({ configured: true, loading: false, user: { id: 'u' }, signIn: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const disclosures = {
  version: 'v1',
  items: [{ id: 'a', title: 'Loss risk', body: 'You can lose it.' }],
};
const elig = (over: object) => ({
  eligible: false,
  reasons: [],
  ipCountry: null,
  attestedCountry: null,
  disclosuresVersion: 'v1',
  disclosuresAcknowledged: false,
  venues: [],
  ...over,
});

describe('VaultGate', () => {
  it('shows disclosures and country attestation to an ineligible User, hides children', async () => {
    api.getDisclosures.mockResolvedValue(disclosures);
    api.getVaultEligibility.mockResolvedValue(
      elig({ reasons: ['attestation_required', 'disclosures_not_acknowledged'] }),
    );
    render(<VaultGate>vault-content</VaultGate>);
    expect(await screen.findByText('Loss risk')).toBeTruthy();
    expect(screen.getByText('Confirm country')).toBeTruthy();
    expect(screen.queryByText('vault-content')).toBeNull();
  });

  it('blocks with a discovery link when no Venue is routable', async () => {
    api.getDisclosures.mockResolvedValue(disclosures);
    api.getVaultEligibility.mockResolvedValue(elig({ reasons: ['no_routable_venue'] }));
    render(<VaultGate>vault-content</VaultGate>);
    expect(await screen.findByText(/not available where you are/)).toBeTruthy();
    expect(screen.queryByText('vault-content')).toBeNull();
  });

  it('renders children when eligible', async () => {
    api.getDisclosures.mockResolvedValue(disclosures);
    api.getVaultEligibility.mockResolvedValue(elig({ eligible: true }));
    render(<VaultGate>vault-content</VaultGate>);
    expect(await screen.findByText('vault-content')).toBeTruthy();
  });
});

describe('HistoryList', () => {
  it('links every transaction', async () => {
    api.listHistory.mockResolvedValue({
      nextCursor: null,
      items: [
        {
          id: '1',
          kind: 'deposit',
          at: '2026-10-11T10:00:00.000Z',
          state: 'complete',
          status: null,
          amount: '25',
          shares: null,
          question: null,
          resolution: null,
          reason: null,
          txs: [
            { label: 'Deposit', chain: 'monad', hash: '0xabc', url: 'https://x.test/tx/0xabc' },
          ],
        },
      ],
    });
    render(<HistoryList />);
    await waitFor(() =>
      expect(screen.getByText('Deposit').getAttribute('href')).toBe('https://x.test/tx/0xabc'),
    );
  });
});
