/** Versioned Vault risk disclosures. Bump `version` on any text change: users must re-acknowledge. */
export const RISK_DISCLOSURES: {
  version: string;
  items: { id: string; title: string; body: string }[];
} = {
  version: '2026-10-09.1',
  items: [
    {
      id: 'market-risk',
      title: 'You can lose your whole stake',
      body: 'Prediction Market positions can lose all value. Prices are not guarantees and past results do not predict outcomes.',
    },
    {
      id: 'venue-risk',
      title: 'Venue risk',
      body: 'Bets are placed on third-party Venues such as Polymarket. Paras does not control them. A Venue can halt trading, change fees or fail.',
    },
    {
      id: 'bridge-risk',
      title: 'Bridge and smart-contract risk',
      body: 'Funds move from Monad to a Venue through bridges and smart contracts. These can fail, be exploited or be delayed, and funds may be lost.',
    },
    {
      id: 'resolution-risk',
      title: 'Resolution risk',
      body: 'Each Venue resolves Markets under its own rules. The same Event can resolve differently on different Venues, and resolution can be disputed or delayed.',
    },
    {
      id: 'jurisdiction',
      title: 'Jurisdiction',
      body: 'Vault use is limited to supported countries. You confirm that you are not in a restricted jurisdiction and will not use a VPN to appear elsewhere. This is not legal advice.',
    },
  ],
};
