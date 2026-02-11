// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IHotColdLotto {
    // ─── Structs ───────────────────────────────────────────────────────────────

    enum RoundStatus { Active, Completed }

    struct Round {
        uint256 id;
        bytes32 commitmentHash;
        uint256 baseBuyIn;
        uint256 currentBuyIn;
        uint256 pool;
        uint256 guessCount;
        uint256 startBlock;
        uint256 endBlock;
        address winner;
        RoundStatus status;
    }

    struct Hint {
        address player;
        uint256 roundId;
        uint8 digitsCorrect;
        uint8 digitsInPlace;
        uint256 numericDistance;
        uint256 timestamp;
    }

    // ─── Events ────────────────────────────────────────────────────────────────

    event RoundStarted(uint256 indexed roundId, bytes32 commitmentHash, uint256 baseBuyIn);
    event GuessMade(uint256 indexed roundId, address indexed player, uint256 buyIn);
    event HintRecorded(uint256 indexed roundId, address indexed player, uint8 digitsCorrect, uint8 digitsInPlace, uint256 numericDistance);
    event BuyInUpdated(uint256 indexed roundId, uint256 newBuyIn);
    event WinnerDeclared(uint256 indexed roundId, address indexed winner, uint256 payout);
    event AuditRootAnchored(uint256 indexed roundId, bytes32 merkleRoot, uint256 entryCount);

    // ─── Functions ─────────────────────────────────────────────────────────────

    function startRound(bytes32 commitmentHash, uint256 baseBuyIn, bytes calldata enclaveSignature, uint256 nonce) external;
    function submitGuess(uint256 roundId) external payable;
    function recordHint(uint256 roundId, address player, uint8 digitsCorrect, uint8 digitsInPlace, uint256 numericDistance, bytes calldata sig, uint256 nonce) external;
    function updateBuyIn(uint256 roundId, uint256 newBuyIn, bytes calldata sig, uint256 nonce) external;
    function declareWinner(uint256 roundId, address winner, bytes calldata sig, uint256 nonce) external;
    function anchorAuditRoot(uint256 roundId, bytes32 merkleRoot, uint256 entryCount, bytes calldata sig, uint256 nonce) external;
}
