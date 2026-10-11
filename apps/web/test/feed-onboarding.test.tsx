import type { FeedItem } from '@paras/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedList } from '@/components/feed-list';
import { NotificationList } from '@/components/notification-list';

const api = vi.hoisted(() => ({
  recordFeedSignal: vi.fn(async () => ({ ok: true })),
  addFollow: vi.fn(async () => ({ ok: true })),
  removeFollow: vi.fn(async () => ({ ok: true })),
  markNotificationsRead: vi.fn(async () => ({ updated: 1 })),
  listNotifications: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const item = (id: string, reason: string): FeedItem =>
  ({
    score: 1,
    reason,
    event: {
      id,
      title: `Event ${id}`,
      category: null,
      volume: '1',
      liquidity: '1',
      markets: [],
    },
  }) as unknown as FeedItem;

describe('FeedList', () => {
  const feed = {
    items: [item('a', 'Smart money leans YES'), item('b', 'Because you follow Fed')],
    beginners: [item('c', 'Good first market')],
  };

  it('shows reason chips and beginners section', () => {
    render(<FeedList feed={feed} followedEventIds={[]} />);
    expect(screen.getByText('Smart money leans YES')).toBeTruthy();
    expect(screen.getByText('New to prediction markets?')).toBeTruthy();
  });

  it('dismiss sends a signal and removes the card', async () => {
    render(<FeedList feed={feed} followedEventIds={[]} />);
    fireEvent.click(screen.getAllByText('Dismiss')[0]!);
    await waitFor(() => expect(screen.queryByText('Event c')).toBeNull());
    expect(api.recordFeedSignal).toHaveBeenCalledWith({ body: { eventId: 'c', kind: 'dismiss' } });
  });

  it('follow toggles', async () => {
    render(<FeedList feed={feed} followedEventIds={['a']} />);
    fireEvent.click(screen.getByText('Following'));
    await waitFor(() => expect(api.removeFollow).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Following')).toBeNull());
  });
});

describe('NotificationList', () => {
  it('mark all read', async () => {
    const n = {
      id: 1,
      kind: 'price_move',
      title: 'Moved',
      body: 'b',
      eventId: null,
      createdAt: new Date().toISOString(),
      readAt: null,
    } as const;
    render(<NotificationList initial={[n]} nextCursor={null} />);
    fireEvent.click(screen.getByText('Mark all read'));
    await waitFor(() => expect(screen.getByLabelText('Read')).toBeTruthy());
    expect(api.markNotificationsRead).toHaveBeenCalledWith({ body: { ids: undefined } });
  });
});
