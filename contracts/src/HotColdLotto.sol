// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITEEVerifier} from "./interfaces/ITEEVerifier.sol";
import {IHotColdLotto} from "./interfaces/IHotColdLotto.sol";

/// @title HotColdLotto — TEE-enforced hot-cold guessing game
/// @notice Players submit ETH buy-ins on-chain; guesses go off-chain to TEE enclave.
///         Signed hints, pricing, and winner declarations are posted on-chain for transparency.
contract HotColdLotto is IHotColdLotto, ReentrancyGuard {
    ITEEVerifier public immutable verifier;

    uint256 public nextRoundId;
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => Hint[]) public roundHints;

    error RoundNotActive();
    error RoundNotFound();
    error InsufficientBuyIn();
    error InvalidSignature();
    error TransferFailed();

    constructor(address _verifier) {
        verifier = ITEEVerifier(_verifier);
        nextRoundId = 1;
    }

    // ─── Round Management ──────────────────────────────────────────────────────

    /// @inheritdoc IHotColdLotto
    function startRound(
        bytes32 commitmentHash,
        uint256 baseBuyIn,
        bytes calldata enclaveSignature,
        uint256 nonce
    ) external {
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                _uint256ToString(nextRoundId),
                commitmentHash,
                baseBuyIn,
                nonce
            )
        );

        verifier.verifyAndConsumeNonce(messageHash, enclaveSignature, nonce);

        uint256 roundId = nextRoundId++;
        Round storage r = rounds[roundId];
        r.id = roundId;
        r.commitmentHash = commitmentHash;
        r.baseBuyIn = baseBuyIn;
        r.currentBuyIn = baseBuyIn;
        r.startBlock = block.number;
        r.status = RoundStatus.Active;

        emit RoundStarted(roundId, commitmentHash, baseBuyIn);
    }

    /// @inheritdoc IHotColdLotto
    function submitGuess(uint256 roundId) external payable {
        Round storage r = rounds[roundId];
        if (r.id == 0) revert RoundNotFound();
        if (r.status != RoundStatus.Active) revert RoundNotActive();
        if (msg.value < r.currentBuyIn) revert InsufficientBuyIn();

        r.pool += msg.value;
        r.guessCount++;

        emit GuessMade(roundId, msg.sender, msg.value);
    }

    /// @inheritdoc IHotColdLotto
    function recordHint(
        uint256 roundId,
        address player,
        uint8 digitsCorrect,
        uint8 digitsInPlace,
        uint256 numericDistance,
        bytes calldata sig,
        uint256 nonce
    ) external {
        Round storage r = rounds[roundId];
        if (r.id == 0) revert RoundNotFound();
        if (r.status != RoundStatus.Active) revert RoundNotActive();

        bytes32 messageHash = keccak256(
            abi.encodePacked(
                _uint256ToString(roundId),
                player,
                digitsCorrect,
                digitsInPlace,
                numericDistance,
                nonce
            )
        );

        verifier.verifyAndConsumeNonce(messageHash, sig, nonce);

        roundHints[roundId].push(Hint({
            player: player,
            roundId: roundId,
            digitsCorrect: digitsCorrect,
            digitsInPlace: digitsInPlace,
            numericDistance: numericDistance,
            timestamp: block.timestamp
        }));

        emit HintRecorded(roundId, player, digitsCorrect, digitsInPlace, numericDistance);
    }

    /// @inheritdoc IHotColdLotto
    function updateBuyIn(
        uint256 roundId,
        uint256 newBuyIn,
        bytes calldata sig,
        uint256 nonce
    ) external {
        Round storage r = rounds[roundId];
        if (r.id == 0) revert RoundNotFound();
        if (r.status != RoundStatus.Active) revert RoundNotActive();

        bytes32 messageHash = keccak256(
            abi.encodePacked(
                _uint256ToString(roundId),
                newBuyIn,
                nonce
            )
        );

        verifier.verifyAndConsumeNonce(messageHash, sig, nonce);

        r.currentBuyIn = newBuyIn;

        emit BuyInUpdated(roundId, newBuyIn);
    }

    /// @inheritdoc IHotColdLotto
    function declareWinner(
        uint256 roundId,
        address winner,
        bytes calldata sig,
        uint256 nonce
    ) external nonReentrant {
        Round storage r = rounds[roundId];
        if (r.id == 0) revert RoundNotFound();
        if (r.status != RoundStatus.Active) revert RoundNotActive();

        bytes32 messageHash = keccak256(
            abi.encodePacked(
                _uint256ToString(roundId),
                winner,
                nonce
            )
        );

        verifier.verifyAndConsumeNonce(messageHash, sig, nonce);

        r.status = RoundStatus.Completed;
        r.winner = winner;
        r.endBlock = block.number;

        uint256 payout = r.pool;
        r.pool = 0;

        (bool success, ) = winner.call{value: payout}("");
        if (!success) revert TransferFailed();

        emit WinnerDeclared(roundId, winner, payout);
    }

    /// @inheritdoc IHotColdLotto
    function anchorAuditRoot(
        uint256 roundId,
        bytes32 merkleRoot,
        uint256 entryCount,
        bytes calldata sig,
        uint256 nonce
    ) external {
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                _uint256ToString(roundId),
                merkleRoot,
                entryCount,
                nonce
            )
        );

        verifier.verifyAndConsumeNonce(messageHash, sig, nonce);

        emit AuditRootAnchored(roundId, merkleRoot, entryCount);
    }

    // ─── View Functions ────────────────────────────────────────────────────────

    function getRound(uint256 roundId) external view returns (Round memory) {
        return rounds[roundId];
    }

    function getHintCount(uint256 roundId) external view returns (uint256) {
        return roundHints[roundId].length;
    }

    function getHint(uint256 roundId, uint256 index) external view returns (Hint memory) {
        return roundHints[roundId][index];
    }

    // ─── Internal Helpers ──────────────────────────────────────────────────────

    /// @dev Convert uint256 to its decimal string representation.
    ///      This matches ethers.js solidityPacked("string", [roundId]) encoding.
    function _uint256ToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    receive() external payable {}
}
