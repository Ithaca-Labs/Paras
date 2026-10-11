import type { MarketView } from '@paras/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RulesCompare } from '@/components/rules-compare';
import { SmartMoneyPanel } from '@/components/smart-money-panel';
import { VenueAction } from '@/components/venue-action';

afterEach(cleanup);

describe('VenueAction', () => {
  it('redirect: Bet on Kalshi links to the Venue, no Vault button', () => {
    render(
      <VenueAction
        venueName="Kalshi"
        availability="redirect"
        redirectUrl="https://kalshi.com/m/1"
      />,
    );
    expect(screen.getByRole('link', { name: /Bet on Kalshi/ }).getAttribute('href')).toBe(
      'https://kalshi.com/m/1',
    );
    expect(screen.queryByText('Bet with Vault')).toBeNull();
  });
  it('routable: Vault button plus redirect', () => {
    render(
      <VenueAction venueName="Polymarket" availability="routable" redirectUrl="https://p.m/1" />,
    );
    expect(screen.getByText('Bet with Vault').getAttribute('href')).toBe('#bet');
    expect(screen.getByRole('link', { name: /Bet on Polymarket/ })).toBeTruthy();
  });
  it('blocked: no links', () => {
    render(<VenueAction venueName="X" availability="blocked" redirectUrl="https://x.m/1" />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText(/Not available/)).toBeTruthy();
  });
});

describe('RulesCompare', () => {
  const m = (name: string, lowConfidence: boolean) =>
    ({
      id: name,
      venue: { name, label: { regulation: 'offshore', text: 'Offshore' } },
      question: `Q ${name}`,
      rules: `Rules ${name}`,
      resolutionSource: null,
      matchConfidence: '0.82',
      matchSource: 'auto',
      lowConfidence,
      direction: 'same',
    }) as unknown as MarketView;
  it('warns on low-confidence matches and shows each Venue rules', () => {
    render(<RulesCompare markets={[m('Polymarket', false), m('Limitless', true)]} />);
    expect(screen.getByRole('alert').textContent).toContain('Limitless');
    expect(screen.getByText('Rules Polymarket')).toBeTruthy();
    expect(screen.getByText('Rules Limitless')).toBeTruthy();
  });
});

describe('SmartMoneyPanel', () => {
  it('shows explanation and signal', () => {
    render(
      <SmartMoneyPanel
        explain={{ summary: 'Whales bought YES', eventId: '', move24h: '0.1', smartMoney: null }}
        smartMoney={{
          leaning: 'YES',
          strength: 0.7,
          yesShare: 0.6,
          smartHolders: 4,
          flowUsd: 5000,
          netflow24hUsd: null,
          reason: 'r',
          updatedAt: '2026-01-01T00:00:00Z',
        }}
      />,
    );
    expect(screen.getByText('Whales bought YES')).toBeTruthy();
    expect(screen.getByText('YES (70%)')).toBeTruthy();
  });
});
