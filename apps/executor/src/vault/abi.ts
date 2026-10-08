import { parseAbi } from 'viem';

/** The slice of `contracts/src/Vault.sol` the Executor uses. */
export const vaultAbi = parseAbi([
  'function registerDepositWallet(address user, address wallet, bytes sig)',
  'function dispatch(address user, bytes32 id)',
  'function settle(bytes message, bytes attestation, bytes32 intentId)',
  'function closeIntent(address user, bytes32 id)',
  'function expireIntent(address user, bytes32 id)',
  'function intentOf(address user, bytes32 id) view returns ((uint8 status, uint256 amount, uint64 expiry, uint256 inFlight))',
  'function depositWalletOf(address user) view returns (address)',
]);

/** Events the watcher follows. */
export const vaultIntentEvents = parseAbi([
  'event IntentSubmitted(address indexed user, bytes32 indexed id, uint256 amount, uint64 expiry, bytes32 detailsHash)',
  'event IntentCancelled(address indexed user, bytes32 indexed id)',
  'event IntentExpired(address indexed user, bytes32 indexed id)',
]);

export const vaultDispatchedEvent = parseAbi([
  'event IntentDispatched(address indexed user, bytes32 indexed id, address indexed wallet, uint256 amount)',
]);

/** Vault `Status` enum order. */
export const VAULT_STATUS = {
  None: 0,
  Reserved: 1,
  Dispatched: 2,
  Cancelled: 3,
  Expired: 4,
  Closed: 5,
} as const;

export const messageTransmitterAbi = parseAbi([
  'function receiveMessage(bytes message, bytes attestation) returns (bool)',
  'function usedNonces(bytes32 nonce) view returns (uint256)',
]);

export const erc20BalanceAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);
