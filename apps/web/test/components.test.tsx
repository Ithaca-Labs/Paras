import type { EventView } from '@paras/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventCard } from '@/components/event-card';
import { Nav } from '@/components/nav';
import { ErrorState } from '@/components/states';
import { VenueChips } from '@/components/venue-chips';
import { cents, usd } from '@/lib/format';

vi.mock('next/navigation', () => ({ usePathname: () => '/explore' }));

afterEach(cleanup);

const event = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Will the Fed cut in December?',
  category: 'Economics',
  volume: '1500000',
  liquidity: '25000',
  markets: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      venue: { id: 'polymarket', name: 'Polymarket' },
      stale: false,
      lowConfidence: false,
      outcomes: [{ label: 'Yes', quote: { last: '0.42', ask: '0.43' } }],
    },
  ],
} as unknown as EventView;

describe('EventCard', () => {
  it('shows title, Venue Quote and stats', () => {
    render(<EventCard event={event} reason="Because you follow the Fed" />);
    expect(screen.getByRole('link', { name: event.title }).getAttribute('href')).toBe(
      `/events/${event.id}`,
    );
    expect(screen.getByText('Polymarket')).toBeTruthy();
    expect(screen.getAllByText('43¢').length).toBeGreaterThan(0); // ask, not last (#130)
    expect(screen.getByText('Best price')).toBeTruthy();
    expect(screen.getByText('$1.5M traded')).toBeTruthy();
    expect(screen.getByText('Because you follow the Fed')).toBeTruthy();
  });
});

describe('Nav', () => {
  it('lists the sections and marks the active one', () => {
    render(<Nav />);
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Feed',
      'Explore',
      'Vault',
      'Portfolio',
      'Orders',
      'Settings',
    ]);
    expect(screen.getByRole('link', { name: 'Explore' }).getAttribute('aria-current')).toBe('page');
  });
});

describe('VenueChips', () => {
  const venues = [
    { id: 'polymarket', name: 'Polymarket' },
    { id: 'kalshi', name: 'Kalshi' },
  ];
  const hrefFor = (next: string[]) => `/explore?${next.map((v) => `venue=${v}`).join('&')}`;

  it('links each chip to the URL with that Venue toggled', () => {
    render(<VenueChips venues={venues} selected={['kalshi']} hrefFor={hrefFor} />);
    expect(screen.getByRole('link', { name: 'Polymarket' }).getAttribute('href')).toBe(
      '/explore?venue=kalshi&venue=polymarket',
    );
    const on = screen.getByRole('link', { name: 'Kalshi' });
    expect(on.getAttribute('aria-current')).toBe('true');
    expect(on.getAttribute('href')).toBe('/explore?');
  });
});

describe('ErrorState', () => {
  it('announces the error', () => {
    render(<ErrorState message="boom" />);
    expect(screen.getByRole('alert').textContent).toContain('boom');
  });
});

describe('ConnectedAppsList', () => {
  it('revokes an app and removes it', async () => {
    const { ConnectedAppsList } = await import('@/components/connected-apps-list');
    const { api } = await import('@/lib/api');
    const spy = vi.spyOn(api, 'revokeConnectedApp').mockResolvedValue({ ok: true });
    const id = '33333333-3333-4333-8333-333333333333';
    render(
      <ConnectedAppsList
        initial={[
          {
            id,
            client: { id: 'c', name: 'Claude' },
            scopes: ['markets:read'],
            connectedAt: '2026-10-10T00:00:00.000Z',
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(screen.queryByText('Claude')).toBeNull());
    expect(spy).toHaveBeenCalledWith({ params: { id } });
  });
});

describe('ConsentForm', () => {
  it('posts the approve decision and redirects', async () => {
    vi.doMock('@/components/providers', () => ({
      useSession: () => ({ configured: true, loading: false, user: {}, signIn: vi.fn() }),
    }));
    const { ConsentForm } = await import('@/components/consent-form');
    const { api } = await import('@/lib/api');
    const spy = vi
      .spyOn(api, 'authorizeOAuth')
      .mockResolvedValue({ redirectUrl: 'http://localhost:9999/cb?code=x' });
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    render(
      <ConsentForm
        clientName="Claude"
        scopes={['markets:read']}
        params={{ client_id: 'c', redirect_uri: 'http://localhost:9999/cb', response_type: 'code' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://localhost:9999/cb?code=x'));
    expect(spy.mock.calls[0]![0].body).toMatchObject({ client_id: 'c', approve: true });
    vi.unstubAllGlobals();
  });
});

describe('format', () => {
  it('formats cents and usd', () => {
    expect(cents('0.5')).toBe('50¢');
    expect(cents(null)).toBe('—');
    expect(usd('1234')).toBe('$1.2K');
  });
});
