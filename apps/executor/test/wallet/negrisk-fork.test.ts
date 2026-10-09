import { createPublicClient, http, parseAbi } from 'viem';
import { polygon } from 'viem/chains';
import { describe, expect, it } from 'vitest';
import { POLYGON } from '../../src/wallet/constants.js';

const url = process.env.POLYGON_FORK_RPC_URL;
const abi = parseAbi([
  'function COLLATERAL_TOKEN() view returns (address)',
  'function CONDITIONAL_TOKENS() view returns (address)',
  'function NEG_RISK_ADAPTER() view returns (address)',
]);

/** Env-gated, never in CI: the allowlisted adapter is the pUSD-era neg-risk adapter wired to our CTF + pUSD. */
describe.skipIf(!url)(
  'Polygon: NegRiskCtfCollateralAdapter wiring (set POLYGON_FORK_RPC_URL)',
  () => {
    const pub = createPublicClient({ chain: polygon, transport: http(url) });
    const read = (functionName: 'COLLATERAL_TOKEN' | 'CONDITIONAL_TOKENS' | 'NEG_RISK_ADAPTER') =>
      pub.readContract({ address: POLYGON.negRiskCollateralAdapter, abi, functionName });

    it('pays pUSD and pulls from the official CTF', async () => {
      expect(await read('COLLATERAL_TOKEN')).toBe(POLYGON.pUSD);
      expect(await read('CONDITIONAL_TOKENS')).toBe(POLYGON.ctf);
      expect(await read('NEG_RISK_ADAPTER')).toBe('0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296');
    });
  },
);
