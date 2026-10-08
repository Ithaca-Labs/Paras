export interface VenueLabelInput {
  routable: boolean;
  realMoney: boolean;
  regulation: 'cftc_regulated' | 'offshore' | 'play_money' | 'unknown';
  restrictedJurisdictions: readonly string[];
}

export interface VenueLabel {
  regulation: VenueLabelInput['regulation'];
  /**
   * `routable`: the Vault can route here. `redirect_only`: read-only plus redirect to the Venue.
   * `play_money`: not real money; excluded from default Feeds.
   */
  availability: 'routable' | 'redirect_only' | 'play_money';
  /** Human text, e.g. "CFTC-regulated, US OK" or "Offshore, US restricted". */
  text: string;
}

const REGULATION_TEXT: Record<VenueLabelInput['regulation'], string> = {
  cftc_regulated: 'CFTC-regulated',
  offshore: 'Offshore',
  play_money: 'Play money',
  unknown: 'Regulation unverified',
};

/** Regulation and availability label for a Venue, derived only from its capabilities. */
export function venueLabel(c: VenueLabelInput): VenueLabel {
  if (!c.realMoney || c.regulation === 'play_money') {
    return {
      regulation: 'play_money',
      availability: 'play_money',
      text: 'Play money, no real funds',
    };
  }
  const us = c.restrictedJurisdictions.includes('US') ? 'US restricted' : 'US OK';
  return {
    regulation: c.regulation,
    availability: c.routable ? 'routable' : 'redirect_only',
    text: `${REGULATION_TEXT[c.regulation]}, ${us}`,
  };
}
