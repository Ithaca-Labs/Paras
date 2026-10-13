import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getVenueHealth: vi.fn(),
  getPauses: vi.fn(),
  pauseExecutor: vi.fn(),
  unpauseExecutor: vi.fn(),
  listMatchReviews: vi.fn(),
  approveMatchReview: vi.fn(),
  rejectMatchReview: vi.fn(),
  splitEvent: vi.fn(),
  mergeEvents: vi.fn(),
  updateEventLabels: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));

import { AdminConsole, type AdminData } from '@/components/admin-console';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const market = (id: string, venueId: string, question: string) => ({
  id,
  venueId,
  question,
  rules: 'Resolves Yes if…',
  url: `https://example.com/${id}`,
  endDate: null,
  outcomes: ['Yes', 'No'],
});
const R1 = '11111111-1111-4111-8111-111111111111';
const EV = '22222222-2222-4222-8222-222222222222';
const M1 = '33333333-3333-4333-8333-333333333333';
const M2 = '44444444-4444-4444-8444-444444444444';
const venue = (venueId: string, name: string, status: 'ok' | 'erroring', errors: number) => ({
  venueId,
  name,
  status,
  lastQuoteAt: null,
  lastSuccessAt: null,
  lastError: errors ? 'HTTP 503' : null,
  runs24h: 10,
  errors24h: errors,
  errorRate: errors / 10,
});

const data = (): AdminData => ({
  health: {
    staleAfterSeconds: 120,
    items: [venue('polymarket', 'Polymarket', 'ok', 0), venue('kalshi', 'Kalshi', 'erroring', 5)],
  },
  pauses: { items: [], vaultPaused: false },
  reviews: [
    {
      id: R1,
      status: 'pending',
      confidence: '0.74',
      direction: 'same',
      candidate: 'embedding',
      createdAt: new Date().toISOString(),
      market: market(M2, 'kalshi', 'Fed cuts in December?'),
      event: {
        id: EV,
        title: 'Fed rate cut in December',
        markets: [market(M1, 'polymarket', 'Will the Fed cut in Dec?')],
      },
    },
  ],
});

describe('AdminConsole', () => {
  it('shows each Venue with its status, error rate and last error', () => {
    render(<AdminConsole initial={data()} />);
    const venues = within(screen.getByRole('list', { name: 'Venues' }));
    expect(venues.getByText('Erroring')).toBeTruthy();
    expect(venues.getByText('50.0%')).toBeTruthy();
    expect(venues.getByText('HTTP 503')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy(); // healthy Venues summary
  });

  it('approves a match through the admin API and drops it from the queue', async () => {
    api.approveMatchReview.mockResolvedValue({ eventId: EV });
    render(<AdminConsole initial={data()} />);
    expect(screen.getByText('74%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findByText('Linked into the Event');
    expect(api.approveMatchReview).toHaveBeenCalledWith({ params: { id: R1 } });
    expect(screen.getByText('No pending matches.')).toBeTruthy();
  });

  it('rejects a match through the admin API', async () => {
    api.rejectMatchReview.mockResolvedValue({ id: R1 });
    render(<AdminConsole initial={data()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await screen.findByText(/will not be proposed again/);
    expect(api.rejectMatchReview).toHaveBeenCalledWith({ params: { id: R1 } });
  });

  it('pauses one Venue with a reason, then lifts it', async () => {
    const paused = {
      items: [{ scope: 'kalshi', reason: 'outage', pausedAt: new Date().toISOString() }],
      vaultPaused: false,
    };
    api.pauseExecutor.mockResolvedValue(paused.items[0]);
    api.getPauses
      .mockResolvedValueOnce(paused)
      .mockResolvedValueOnce({ items: [], vaultPaused: false });
    api.unpauseExecutor.mockResolvedValue({ removed: true });
    render(<AdminConsole initial={data()} />);

    fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'kalshi' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'outage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pause dispatch' }));
    await screen.findByText('Kalshi paused');
    expect(api.pauseExecutor).toHaveBeenCalledWith({
      params: { scope: 'kalshi' },
      body: { reason: 'outage' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Lift' }));
    await screen.findByText('Lifted kalshi pause');
    expect(api.unpauseExecutor).toHaveBeenCalledWith({ params: { scope: 'kalshi' } });
  });

  it('flags a global pause at the top of the console', () => {
    const d = data();
    d.pauses.items = [
      { scope: 'global', reason: 'CCTP incident', pausedAt: new Date().toISOString() },
    ];
    render(<AdminConsole initial={d} />);
    expect(screen.getByRole('alert').textContent).toContain('paused globally: CCTP incident');
  });

  it('merges two Events by id', async () => {
    api.mergeEvents.mockResolvedValue({ eventId: EV });
    render(<AdminConsole initial={data()} />);
    fireEvent.change(screen.getByLabelText('Source Event id'), { target: { value: ` ${M1} ` } });
    fireEvent.change(screen.getByLabelText('Target Event id'), { target: { value: EV } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await screen.findByText(`Merged into Event ${EV}`);
    expect(api.mergeEvents).toHaveBeenCalledWith({
      body: { sourceEventId: M1, targetEventId: EV },
    });
  });
});
