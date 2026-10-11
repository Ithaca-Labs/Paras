import { ApiError } from '@paras/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  oneClickBet: vi.fn(),
  createOrder: vi.fn(),
  getConfig: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/components/providers', () => ({ useSession: () => ({ user: null }) }));

import { AnyChainDeposit } from '@/components/any-chain-deposit';
import { OneClickBet } from '@/components/one-click-bet';
import { TpSlForm } from '@/components/tp-sl-form';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('OneClickBet', () => {
  it('submits the chosen Event, Outcome, amount and max price', async () => {
    api.oneClickBet.mockResolvedValue({ intentId: 'abcdef12-0000', txHash: '0x1' });
    render(<OneClickBet eventId="e1" outcome="Yes" />);
    fill('Amount (USDC)', '5');
    fill('Max price (0-1)', '0.6');
    fireEvent.click(screen.getByRole('button', { name: /one-click bet on yes/i }));
    await screen.findByText(/Bet submitted/);
    expect(api.oneClickBet).toHaveBeenCalledWith({
      body: { eventId: 'e1', outcome: 'Yes', amount: '5', maxPrice: '0.6' },
    });
  });

  it('links to settings when there is no active delegation', async () => {
    api.oneClickBet.mockRejectedValue(
      new ApiError(409, { error: { code: 'no_active_delegation', message: 'No delegation' } }),
    );
    render(<OneClickBet eventId="e1" outcome="Yes" />);
    fill('Amount (USDC)', '5');
    fill('Max price (0-1)', '0.6');
    fireEvent.click(screen.getByRole('button'));
    const link = await screen.findByRole('link', { name: /enable one-click trading/i });
    expect(link.getAttribute('href')).toBe('/settings');
  });
});

describe('TpSlForm', () => {
  it('creates a stop-loss with a worst price', async () => {
    api.createOrder.mockResolvedValue({});
    render(<TpSlForm positionId="p1" />);
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'stop_loss' } });
    fill('Trigger price (0-1)', '0.3');
    fill('Worst price (required, at or below trigger)', '0.25');
    fireEvent.click(screen.getByRole('button', { name: 'Set order' }));
    await screen.findByText('Stop-loss set');
    expect(api.createOrder.mock.calls[0]?.[0].body).toMatchObject({
      kind: 'stop_loss',
      positionId: 'p1',
      triggerPrice: '0.3',
      limitPrice: '0.25',
    });
  });
});

describe('AnyChainDeposit', () => {
  it('renders nothing when the feature flag is off', async () => {
    api.getConfig.mockResolvedValue({ features: { anyChainDeposit: false } });
    const { container } = render(<AnyChainDeposit />);
    await waitFor(() => expect(api.getConfig).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });
});
