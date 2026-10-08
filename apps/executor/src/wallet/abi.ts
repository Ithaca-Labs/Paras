import { parseAbi } from 'viem';

export const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
]);

export const rampAbi = parseAbi([
  'function wrap(address asset, address to, uint256 amount)',
  'function unwrap(address asset, address to, uint256 amount)',
]);

export const swapRouterAbi = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut)',
]);

export const tokenMessengerAbi = parseAbi([
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)',
]);

export const ctfAbi = parseAbi([
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)',
  'function setApprovalForAll(address operator, bool approved)',
]);

/** Polymarket DepositWallet (owner-signed batches only). */
export const depositWalletAbi = parseAbi([
  'function authorizeSessionSigner(address signer, uint256 validUntil)',
  'function revokeSessionSigner(address signer)',
  'function sessionSignerAuthorizedUntil(address signer) view returns (uint256)',
  'function owner() view returns (address)',
]);

export const walletFactoryAbi = parseAbi([
  'function predictWalletAddress(bytes32 id) view returns (address)',
]);
