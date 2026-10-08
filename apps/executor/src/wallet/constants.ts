import { getAddress, type Address } from 'viem';

/** Polygon PoS mainnet. Addresses verified on-chain in spike #17 (PRD > Vault risk findings). */
export const POLYGON_CHAIN_ID = 137;

const a = (s: string): Address => getAddress(s);

export const POLYGON = {
  walletFactory: a('0x00000000000Fb5C9ADea0298D729A0CB3823Cc07'),
  pUSD: a('0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB'),
  /** Native USDC (what CCTP mints). Onramp wrap is paused for it. */
  usdcNative: a('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'),
  usdcE: a('0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'),
  onramp: a('0x93070a847efEf7F70739046A929D47a521F5B8ee'),
  offramp: a('0x2957922Eb93258b93368531d39fAcCA3B4dC5854'),
  ctf: a('0x4D97DCd97eC945f40cF65F87097ACe5EA0476045'),
  ctfExchange: a('0xE111180000d2663C0091e4f400237545B87B996B'),
  negRiskExchange: a('0xe2222d279d744050d28e00520010520000310F59'),
  v2Exchange: a('0xe3333700cA9d93003F00f0F71f8515005F6c00Aa'),
  swapRouter02: a('0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'),
  tokenMessengerV2: a('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'),
  messageTransmitterV2: a('0x81D40F21F12A8F0E3252Bccb954D722d4c464B64'),
} as const;

/** Circle CCTP domain ids. */
export const CCTP_DOMAIN = { monad: 15, polygon: 7 } as const;

/** Uniswap V3 fee tier of the native USDC / USDC.e pool. */
export const USDC_SWAP_FEE = 100;

/** Session keys are valid for exactly 180 days (Polymarket rejects other values). */
export const SESSION_KEY_TTL_SECONDS = 180 * 24 * 60 * 60;
