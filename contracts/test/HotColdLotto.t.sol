// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {TEEVerifier} from "../src/TEEVerifier.sol";
import {HotColdLotto} from "../src/HotColdLotto.sol";
import {IHotColdLotto} from "../src/interfaces/IHotColdLotto.sol";

contract HotColdLottoTest is Test {
    using MessageHashUtils for bytes32;

    TEEVerifier public verifier;
    HotColdLotto public lotto;

    // Test enclave key (Foundry default #0)
    uint256 constant ENCLAVE_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address enclaveAddr;

    address player1 = makeAddr("player1");
    address player2 = makeAddr("player2");

    uint256 constant BASE_BUY_IN = 0.01 ether;

    function setUp() public {
        enclaveAddr = vm.addr(ENCLAVE_PK);

        verifier = new TEEVerifier(enclaveAddr);
        lotto = new HotColdLotto(address(verifier));

        vm.deal(player1, 100 ether);
        vm.deal(player2, 100 ether);
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    function _signMessage(bytes32 messageHash) internal pure returns (bytes memory) {
        bytes32 ethHash = messageHash.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ENCLAVE_PK, ethHash);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Mirrors ethers.js solidityPackedKeccak256 for startRound
    function _startRoundHash(uint256 roundId, bytes32 commitment, uint256 baseBuyIn, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            _uintToString(roundId),
            commitment,
            baseBuyIn,
            nonce
        ));
    }

    function _hintHash(uint256 roundId, address player, uint8 digitsCorrect, uint8 digitsInPlace, uint256 numericDistance, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            _uintToString(roundId),
            player,
            digitsCorrect,
            digitsInPlace,
            numericDistance,
            nonce
        ));
    }

    function _buyInHash(uint256 roundId, uint256 newBuyIn, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            _uintToString(roundId),
            newBuyIn,
            nonce
        ));
    }

    function _winnerHash(uint256 roundId, address winner, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            _uintToString(roundId),
            winner,
            nonce
        ));
    }

    function _auditHash(uint256 roundId, bytes32 merkleRoot, uint256 entryCount, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            _uintToString(roundId),
            merkleRoot,
            entryCount,
            nonce
        ));
    }

    function _uintToString(uint256 value) internal pure returns (string memory) {
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

    // ─── Tests ─────────────────────────────────────────────────────────────────

    function test_StartRound() public {
        bytes32 commitment = keccak256("test-commitment");
        uint256 nonce = 0;

        bytes32 msgHash = _startRoundHash(1, commitment, BASE_BUY_IN, nonce);
        bytes memory sig = _signMessage(msgHash);

        lotto.startRound(commitment, BASE_BUY_IN, sig, nonce);

        IHotColdLotto.Round memory r = lotto.getRound(1);
        assertEq(r.id, 1);
        assertEq(r.commitmentHash, commitment);
        assertEq(r.baseBuyIn, BASE_BUY_IN);
        assertEq(r.currentBuyIn, BASE_BUY_IN);
        assertEq(r.pool, 0);
        assertEq(uint8(r.status), uint8(IHotColdLotto.RoundStatus.Active));
    }

    function test_SubmitGuess() public {
        // Start round
        bytes32 commitment = keccak256("test");
        bytes32 msgHash = _startRoundHash(1, commitment, BASE_BUY_IN, 0);
        lotto.startRound(commitment, BASE_BUY_IN, _signMessage(msgHash), 0);

        // Submit guess
        vm.prank(player1);
        lotto.submitGuess{value: BASE_BUY_IN}(1);

        IHotColdLotto.Round memory r = lotto.getRound(1);
        assertEq(r.pool, BASE_BUY_IN);
        assertEq(r.guessCount, 1);
    }

    function test_RevertInsufficientBuyIn() public {
        bytes32 commitment = keccak256("test");
        bytes32 msgHash = _startRoundHash(1, commitment, BASE_BUY_IN, 0);
        lotto.startRound(commitment, BASE_BUY_IN, _signMessage(msgHash), 0);

        vm.prank(player1);
        vm.expectRevert(HotColdLotto.InsufficientBuyIn.selector);
        lotto.submitGuess{value: BASE_BUY_IN - 1}(1);
    }

    function test_RecordHint() public {
        // Start round
        bytes32 commitment = keccak256("test");
        lotto.startRound(commitment, BASE_BUY_IN, _signMessage(_startRoundHash(1, commitment, BASE_BUY_IN, 0)), 0);

        // Submit guess
        vm.prank(player1);
        lotto.submitGuess{value: BASE_BUY_IN}(1);

        // Record hint
        uint8 digitsCorrect = 3;
        uint8 digitsInPlace = 1;
        uint256 numericDistance = 123456;
        uint256 nonce = 1;

        bytes32 msgHash = _hintHash(1, player1, digitsCorrect, digitsInPlace, numericDistance, nonce);
        lotto.recordHint(1, player1, digitsCorrect, digitsInPlace, numericDistance, _signMessage(msgHash), nonce);

        assertEq(lotto.getHintCount(1), 1);
        IHotColdLotto.Hint memory h = lotto.getHint(1, 0);
        assertEq(h.player, player1);
        assertEq(h.digitsCorrect, digitsCorrect);
        assertEq(h.digitsInPlace, digitsInPlace);
        assertEq(h.numericDistance, numericDistance);
    }

    function test_UpdateBuyIn() public {
        bytes32 commitment = keccak256("test");
        lotto.startRound(commitment, BASE_BUY_IN, _signMessage(_startRoundHash(1, commitment, BASE_BUY_IN, 0)), 0);

        uint256 newBuyIn = 0.05 ether; // 5x = Hot tier
        uint256 nonce = 1;

        bytes32 msgHash = _buyInHash(1, newBuyIn, nonce);
        lotto.updateBuyIn(1, newBuyIn, _signMessage(msgHash), nonce);

        IHotColdLotto.Round memory r = lotto.getRound(1);
        assertEq(r.currentBuyIn, newBuyIn);
    }

    function test_DeclareWinner() public {
        // Start round
        bytes32 commitment = keccak256("test");
        lotto.startRound(commitment, BASE_BUY_IN, _signMessage(_startRoundHash(1, commitment, BASE_BUY_IN, 0)), 0);

        // Two players submit guesses
        vm.prank(player1);
        lotto.submitGuess{value: BASE_BUY_IN}(1);
        vm.prank(player2);
        lotto.submitGuess{value: BASE_BUY_IN}(1);

        uint256 expectedPayout = BASE_BUY_IN * 2;
        uint256 player1BalBefore = player1.balance;

        // Declare winner
        uint256 nonce = 1;
        bytes32 msgHash = _winnerHash(1, player1, nonce);
        lotto.declareWinner(1, player1, _signMessage(msgHash), nonce);

        IHotColdLotto.Round memory r = lotto.getRound(1);
        assertEq(uint8(r.status), uint8(IHotColdLotto.RoundStatus.Completed));
        assertEq(r.winner, player1);
        assertEq(r.pool, 0);
        assertEq(player1.balance, player1BalBefore + expectedPayout);
    }

    function test_RevertDeclareWinnerOnCompletedRound() public {
        bytes32 commitment = keccak256("test");
        lotto.startRound(commitment, BASE_BUY_IN, _signMessage(_startRoundHash(1, commitment, BASE_BUY_IN, 0)), 0);

        vm.prank(player1);
        lotto.submitGuess{value: BASE_BUY_IN}(1);

        // First declaration
        uint256 nonce1 = 1;
        lotto.declareWinner(1, player1, _signMessage(_winnerHash(1, player1, nonce1)), nonce1);

        // Second attempt should fail
        uint256 nonce2 = 2;
        vm.expectRevert(HotColdLotto.RoundNotActive.selector);
        lotto.declareWinner(1, player1, _signMessage(_winnerHash(1, player1, nonce2)), nonce2);
    }

    function test_ReplayPrevention() public {
        bytes32 commitment = keccak256("test");
        uint256 nonce = 0;

        bytes32 msgHash = _startRoundHash(1, commitment, BASE_BUY_IN, nonce);
        bytes memory sig = _signMessage(msgHash);

        lotto.startRound(commitment, BASE_BUY_IN, sig, nonce);

        // Try to replay the same signed message — should revert
        vm.expectRevert();
        lotto.startRound(commitment, BASE_BUY_IN, sig, nonce);
    }

    function test_InvalidSignatureReverts() public {
        bytes32 commitment = keccak256("test");
        uint256 nonce = 0;

        // Sign with wrong data
        bytes32 wrongHash = keccak256("wrong-data");
        bytes memory badSig = _signMessage(wrongHash);

        vm.expectRevert();
        lotto.startRound(commitment, BASE_BUY_IN, badSig, nonce);
    }

    function test_AnchorAuditRoot() public {
        bytes32 commitment = keccak256("test");
        lotto.startRound(commitment, BASE_BUY_IN, _signMessage(_startRoundHash(1, commitment, BASE_BUY_IN, 0)), 0);

        bytes32 merkleRoot = keccak256("merkle-root");
        uint256 entryCount = 5;
        uint256 nonce = 1;

        bytes32 msgHash = _auditHash(1, merkleRoot, entryCount, nonce);
        lotto.anchorAuditRoot(1, merkleRoot, entryCount, _signMessage(msgHash), nonce);
        // If no revert, audit root was accepted
    }

    function test_MultipleRounds() public {
        // Start round 1
        bytes32 c1 = keccak256("round1");
        lotto.startRound(c1, BASE_BUY_IN, _signMessage(_startRoundHash(1, c1, BASE_BUY_IN, 0)), 0);

        // Start round 2
        bytes32 c2 = keccak256("round2");
        lotto.startRound(c2, BASE_BUY_IN, _signMessage(_startRoundHash(2, c2, BASE_BUY_IN, 1)), 1);

        assertEq(lotto.getRound(1).commitmentHash, c1);
        assertEq(lotto.getRound(2).commitmentHash, c2);
        assertEq(lotto.nextRoundId(), 3);
    }

    function test_RoundNotFound() public {
        vm.prank(player1);
        vm.expectRevert(HotColdLotto.RoundNotFound.selector);
        lotto.submitGuess{value: BASE_BUY_IN}(999);
    }

    function test_PriceEscalationFlow() public {
        // Start round
        bytes32 commitment = keccak256("test");
        lotto.startRound(commitment, BASE_BUY_IN, _signMessage(_startRoundHash(1, commitment, BASE_BUY_IN, 0)), 0);

        // Player submits at base price
        vm.prank(player1);
        lotto.submitGuess{value: BASE_BUY_IN}(1);

        // Escalate to 5x (Hot tier)
        uint256 hotBuyIn = BASE_BUY_IN * 5;
        lotto.updateBuyIn(1, hotBuyIn, _signMessage(_buyInHash(1, hotBuyIn, 1)), 1);

        // Player must now pay the escalated price
        vm.prank(player2);
        vm.expectRevert(HotColdLotto.InsufficientBuyIn.selector);
        lotto.submitGuess{value: BASE_BUY_IN}(1);

        // Pay correct amount
        vm.prank(player2);
        lotto.submitGuess{value: hotBuyIn}(1);

        assertEq(lotto.getRound(1).pool, BASE_BUY_IN + hotBuyIn);
    }
}
