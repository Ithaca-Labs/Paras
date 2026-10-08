// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ITokenMessengerV2, IMessageTransmitterV2} from "./ICctp.sol";

/// Paras Vault (Monad). Per-user segregated USDC: idle / reserved / in-flight. No pooled shares.
/// The Executor can only (a) burn a user's reserved funds to that user's registered Deposit Wallet and
/// (b) credit funds that CCTP itself delivered, to the user mapped from the burning wallet.
/// Admin = TimelockController (unpause, upgrades, role grants). PAUSER = multisig (immediate pause).
contract Vault is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    EIP712Upgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    uint32 public constant POLYGON_DOMAIN = 7;
    uint32 public constant STANDARD_FINALITY = 2000;

    bytes32 public constant INTENT_TYPEHASH =
        keccak256("Intent(address user,bytes32 id,uint256 amount,uint64 expiry,bytes32 detailsHash)");
    bytes32 public constant REGISTER_TYPEHASH = keccak256("RegisterDepositWallet(address user,address wallet)");

    enum Status {
        None,
        Reserved,
        Dispatched,
        Cancelled,
        Expired,
        Closed
    }

    /// Signed by the user. `detailsHash` commits to the off-chain Event / Outcome / max price.
    struct Intent {
        address user;
        bytes32 id;
        uint256 amount;
        uint64 expiry;
        bytes32 detailsHash;
    }

    struct IntentState {
        Status status;
        uint256 amount;
        uint64 expiry;
        uint256 inFlight; // part of `amount` not yet returned or written off
    }

    struct Account {
        uint256 idle;
        uint256 reserved;
        uint256 inFlight; // burned via CCTP, not held by the Vault
        address wallet; // registered Deposit Wallet (Polygon); immutable once set
    }

    IERC20 public usdc;
    ITokenMessengerV2 public tokenMessenger;
    IMessageTransmitterV2 public messageTransmitter;
    /// Σ(idle + reserved) over users == USDC the Vault must hold.
    uint256 public totalBalances;
    uint256 public totalInFlight;
    mapping(address user => Account) internal _accounts;
    mapping(address wallet => address user) public walletUser;
    mapping(address user => mapping(bytes32 id => IntentState)) internal _intents;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event DepositWalletRegistered(address indexed user, address indexed wallet);
    event IntentSubmitted(address indexed user, bytes32 indexed id, uint256 amount, uint64 expiry, bytes32 detailsHash);
    event IntentCancelled(address indexed user, bytes32 indexed id);
    event IntentExpired(address indexed user, bytes32 indexed id);
    event IntentDispatched(address indexed user, bytes32 indexed id, address indexed wallet, uint256 amount);
    event Settled(address indexed user, address indexed wallet, uint256 amount, bytes32 indexed intentId);
    event IntentClosed(address indexed user, bytes32 indexed id, uint256 writtenOff);

    error ZeroAmount();
    error InsufficientIdle();
    error BadSignature();
    error AlreadyRegistered();
    error NotRegistered();
    error WrongStatus();
    error NotExpired();
    error Expired();
    error BadMessage();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        IERC20 usdc_,
        ITokenMessengerV2 tokenMessenger_,
        IMessageTransmitterV2 messageTransmitter_,
        address admin,
        address pauser,
        address executor
    ) external initializer {
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __EIP712_init("ParasVault", "1");
        usdc = usdc_;
        tokenMessenger = tokenMessenger_;
        messageTransmitter = messageTransmitter_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, pauser);
        _grantRole(EXECUTOR_ROLE, executor);
    }

    // ---------------------------------------------------------------- views

    function balanceOf(address user) external view returns (uint256 idle, uint256 reserved, uint256 inFlight) {
        Account storage a = _accounts[user];
        return (a.idle, a.reserved, a.inFlight);
    }

    function depositWalletOf(address user) external view returns (address) {
        return _accounts[user].wallet;
    }

    function intentOf(address user, bytes32 id) external view returns (IntentState memory) {
        return _intents[user][id];
    }

    function intentDigest(Intent calldata i) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(INTENT_TYPEHASH, i.user, i.id, i.amount, i.expiry, i.detailsHash))
        );
    }

    function registerDigest(address user, address wallet) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(REGISTER_TYPEHASH, user, wallet)));
    }

    // ---------------------------------------------------------------- user funds

    function deposit(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        _accounts[msg.sender].idle += amount;
        totalBalances += amount;
        emit Deposited(msg.sender, amount);
    }

    /// Idle funds only, to the caller. Allowed while paused: bounded by the caller's own accounting.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Account storage a = _accounts[msg.sender];
        if (a.idle < amount) revert InsufficientIdle();
        a.idle -= amount;
        totalBalances -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// Binds `wallet` to `user`, once. Executor-only relay (it checks the wallet derives from the user's owner EOA,
    /// not visible on Monad) of the user's EIP-712 signature naming that exact wallet.
    /// shortcut: no re-registration, upgrade the Vault if a user must rotate wallets.
    function registerDepositWallet(address user, address wallet, bytes calldata sig)
        external
        onlyRole(EXECUTOR_ROLE)
        whenNotPaused
    {
        if (user == address(0) || wallet == address(0)) revert NotRegistered();
        if (_accounts[user].wallet != address(0) || walletUser[wallet] != address(0)) revert AlreadyRegistered();
        if (!SignatureChecker.isValidSignatureNow(user, registerDigest(user, wallet), sig)) revert BadSignature();
        _accounts[user].wallet = wallet;
        walletUser[wallet] = user;
        emit DepositWalletRegistered(user, wallet);
    }

    // ---------------------------------------------------------------- intents

    /// Reserves `i.amount` of the user's idle funds. Anyone may relay the user's EIP-712 signature.
    function submitIntent(Intent calldata i, bytes calldata sig) external whenNotPaused {
        Account storage a = _accounts[i.user];
        if (a.wallet == address(0)) revert NotRegistered();
        if (i.amount == 0) revert ZeroAmount();
        if (i.expiry <= block.timestamp) revert Expired();
        IntentState storage s = _intents[i.user][i.id];
        if (s.status != Status.None) revert WrongStatus();
        if (!SignatureChecker.isValidSignatureNow(i.user, intentDigest(i), sig)) revert BadSignature();
        if (a.idle < i.amount) revert InsufficientIdle();
        a.idle -= i.amount;
        a.reserved += i.amount;
        s.status = Status.Reserved;
        s.amount = i.amount;
        s.expiry = i.expiry;
        emit IntentSubmitted(i.user, i.id, i.amount, i.expiry, i.detailsHash);
    }

    function cancelIntent(bytes32 id) external {
        _release(msg.sender, id, Status.Cancelled);
        emit IntentCancelled(msg.sender, id);
    }

    /// Anyone, once past expiry and still undispatched.
    function expireIntent(address user, bytes32 id) external {
        if (block.timestamp <= _intents[user][id].expiry) revert NotExpired();
        _release(user, id, Status.Expired);
        emit IntentExpired(user, id);
    }

    function _release(address user, bytes32 id, Status to) internal {
        IntentState storage s = _intents[user][id];
        if (s.status != Status.Reserved) revert WrongStatus();
        s.status = to;
        Account storage a = _accounts[user];
        a.reserved -= s.amount;
        a.idle += s.amount;
    }

    // ---------------------------------------------------------------- executor

    /// CCTP burn of the reserved amount to Polygon. mintRecipient is forced to the user's registered Deposit Wallet;
    /// destinationCaller is 0 so anyone can relay the mint (user never stuck if the Executor is down).
    function dispatch(address user, bytes32 id) external onlyRole(EXECUTOR_ROLE) whenNotPaused nonReentrant {
        IntentState storage s = _intents[user][id];
        if (s.status != Status.Reserved) revert WrongStatus();
        if (block.timestamp > s.expiry) revert Expired();
        Account storage a = _accounts[user];
        address wallet = a.wallet;
        uint256 amount = s.amount;
        s.status = Status.Dispatched;
        s.inFlight = amount;
        a.reserved -= amount;
        a.inFlight += amount;
        totalBalances -= amount;
        totalInFlight += amount;
        usdc.forceApprove(address(tokenMessenger), amount);
        // maxFee 0: Circle's standard-transfer fee is 0 (spike #17); a nonzero fee makes the burn revert.
        tokenMessenger.depositForBurn(
            amount, POLYGON_DOMAIN, bytes32(uint256(uint160(wallet))), address(usdc), bytes32(0), 0, STANDARD_FINALITY
        );
        emit IntentDispatched(user, id, wallet, amount);
    }

    /// Return path. The Vault itself calls receiveMessage (destinationCaller = Vault) and credits what CCTP minted
    /// to the user mapped from the burning Deposit Wallet. Nothing about user or amount comes from the caller;
    /// `intentId` only picks which of that user's own in-flight claims to reduce (0 = none).
    function settle(bytes calldata message, bytes calldata attestation, bytes32 intentId)
        external
        onlyRole(EXECUTOR_ROLE)
        whenNotPaused
        nonReentrant
    {
        (address user, uint256 minted) = _parseReturn(message);
        uint256 before = usdc.balanceOf(address(this));
        if (!messageTransmitter.receiveMessage(message, attestation)) revert BadMessage();
        if (usdc.balanceOf(address(this)) - before != minted) revert BadMessage();

        Account storage a = _accounts[user];
        a.idle += minted;
        totalBalances += minted;
        if (intentId != 0) {
            IntentState storage s = _intents[user][intentId];
            if (s.status != Status.Dispatched) revert WrongStatus();
            uint256 r = minted < s.inFlight ? minted : s.inFlight;
            s.inFlight -= r;
            a.inFlight -= r;
            totalInFlight -= r;
        }
        emit Settled(user, a.wallet, minted, intentId);
    }

    // MessageV2 header is 148 bytes; BurnMessageV2 body is >= 228 bytes.
    // Header offsets: sourceDomain 4, sender 44, recipient 76, destinationCaller 108.
    // Body offsets: version 0, mintRecipient 36, amount 68, messageSender 100, feeExecuted 164.
    function _parseReturn(bytes calldata m) internal view returns (address user, uint256 minted) {
        if (m.length < 148 + 228) revert BadMessage();
        bytes32 self32 = bytes32(uint256(uint160(address(this))));
        // CCTP v2 uses the same TokenMessenger address on every chain.
        bytes32 tm32 = bytes32(uint256(uint160(address(tokenMessenger))));
        bytes calldata b = m[148:];
        if (
            uint32(bytes4(m[4:8])) != POLYGON_DOMAIN || bytes32(m[44:76]) != tm32 || bytes32(m[76:108]) != tm32
                || bytes32(m[108:140]) != self32 || uint32(bytes4(b[0:4])) != 1 || bytes32(b[36:68]) != self32
        ) revert BadMessage();
        minted = uint256(bytes32(b[68:100])) - uint256(bytes32(b[164:196]));
        uint256 burner = uint256(bytes32(b[100:132]));
        if (burner >> 160 == 0) user = walletUser[address(uint160(burner))];
        if (user == address(0)) revert NotRegistered();
    }

    /// Final: drops whatever is still in-flight for the Intent (e.g. a losing bet). Bookkeeping only; moves no funds.
    function closeIntent(address user, bytes32 id) external onlyRole(EXECUTOR_ROLE) {
        IntentState storage s = _intents[user][id];
        if (s.status != Status.Dispatched) revert WrongStatus();
        uint256 left = s.inFlight;
        s.status = Status.Closed;
        s.inFlight = 0;
        _accounts[user].inFlight -= left;
        totalInFlight -= left;
        emit IntentClosed(user, id, left);
    }

    // ---------------------------------------------------------------- operations

    /// Immediate.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// Admin only (the TimelockController, so delayed).
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
