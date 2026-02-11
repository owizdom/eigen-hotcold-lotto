import { describe, it, expect, beforeAll } from "vitest";
import { calculateDistance } from "../src/game.js";
import {
  determinePriceTier,
  computeBuyIn,
  shouldUpdatePrice,
} from "../src/pricing.js";
import {
  initSigner,
  generateTarget,
  computeCommitment,
  getSigner,
  sealData,
  unsealData,
} from "../src/crypto.js";
import { addAuditEntry, computeMerkleRoot, verifyChainIntegrity } from "../src/audit.js";
import { PriceTier, AuditEntryType, DEFAULT_PRICING_CONFIG } from "../src/types.js";
import { startNewRound, processGuess, getRound } from "../src/game.js";

// Test private key (DO NOT use in production)
const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

beforeAll(() => {
  initSigner(TEST_PRIVATE_KEY);
});

// ─── Distance Calculation ──────────────────────────────────────────────────────

describe("calculateDistance", () => {
  it("should detect exact match", () => {
    const result = calculateDistance("123456789012", "123456789012");
    expect(result.digitsInPlace).toBe(12);
    expect(result.digitsCorrect).toBe(0);
    expect(result.numericDistance).toBe(0n);
    expect(result.isExactMatch).toBe(true);
  });

  it("should count bulls (exact position matches)", () => {
    const result = calculateDistance("123456789012", "123000000000");
    expect(result.digitsInPlace).toBe(4); // 1, 2, 3 in positions 0-2 + '0' at position 9
  });

  it("should count cows (right digit, wrong position)", () => {
    // target: 123456789012, guess: 210000000000
    // bulls: '0' at position 9 matches → 1 bull
    // cows: '2' at pos 0 matches target pos 1, '1' at pos 1 matches target pos 0 → 2 cows
    const result = calculateDistance("123456789012", "210000000000");
    expect(result.digitsInPlace).toBe(1); // '0' at position 9
    expect(result.digitsCorrect).toBe(2); // '2' and '1'
  });

  it("should handle partial match (mixed bulls and cows)", () => {
    // target: 111222333444
    // guess:  112233444333
    // Position matches: pos0='1', pos1='1', pos4='3', pos5='3'... let me trace carefully
    // pos 0: 1 vs 1 → bull
    // pos 1: 1 vs 1 → bull
    // pos 2: 1 vs 2 → no
    // pos 3: 2 vs 2 → bull
    // pos 4: 2 vs 3 → no
    // pos 5: 2 vs 3 → no
    // pos 6: 3 vs 4 → no
    // pos 7: 3 vs 4 → no
    // pos 8: 3 vs 4 → no
    // pos 9: 4 vs 3 → no
    // pos10: 4 vs 3 → no
    // pos11: 4 vs 3 → no
    // Bulls = 3 (pos 0, 1, 3)
    // Remaining target: [_, _, 1, _, 2, 2, 3, 3, 3, 4, 4, 4]
    // Remaining guess:  [_, _, 2, _, 3, 3, 4, 4, 4, 3, 3, 3]
    // Cow matching: guess '2' → target has '2' at pos4 → cow. guess '3' → target has '3' at pos6 → cow. etc.
    const result = calculateDistance("111222333444", "112233444333");
    expect(result.digitsInPlace).toBe(3);
    expect(result.digitsCorrect).toBeGreaterThan(0);
  });

  it("should handle leading zeros", () => {
    const result = calculateDistance("000000000001", "000000000002");
    expect(result.digitsInPlace).toBe(11);
    expect(result.numericDistance).toBe(1n);
    expect(result.isExactMatch).toBe(false);
  });

  it("should compute numeric distance correctly", () => {
    const result = calculateDistance("999999999999", "000000000000");
    expect(result.numericDistance).toBe(999999999999n);
  });

  it("should compute max distance", () => {
    const result = calculateDistance("000000000000", "999999999999");
    expect(result.numericDistance).toBe(999999999999n);
  });

  it("should throw for wrong length", () => {
    expect(() => calculateDistance("123", "456")).toThrow("12 digits");
  });
});

// ─── Pricing ───────────────────────────────────────────────────────────────────

describe("pricing", () => {
  it("should return Base tier for large distances", () => {
    expect(determinePriceTier(500000000000n)).toBe(PriceTier.Base);
  });

  it("should return Warm tier for distance <= 1000", () => {
    expect(determinePriceTier(1000n)).toBe(PriceTier.Warm);
    expect(determinePriceTier(500n)).toBe(PriceTier.Warm);
  });

  it("should return Hot tier for distance <= 100", () => {
    expect(determinePriceTier(100n)).toBe(PriceTier.Hot);
    expect(determinePriceTier(50n)).toBe(PriceTier.Hot);
  });

  it("should return Scorching tier for distance <= 10", () => {
    expect(determinePriceTier(10n)).toBe(PriceTier.Scorching);
    expect(determinePriceTier(1n)).toBe(PriceTier.Scorching);
    expect(determinePriceTier(0n)).toBe(PriceTier.Scorching);
  });

  it("should compute correct buy-in for each tier", () => {
    const base = DEFAULT_PRICING_CONFIG.baseBuyIn;
    expect(computeBuyIn(999999999999n)).toBe(base * 1n); // Base
    expect(computeBuyIn(500n)).toBe(base * 2n); // Warm
    expect(computeBuyIn(50n)).toBe(base * 5n); // Hot
    expect(computeBuyIn(5n)).toBe(base * 10n); // Scorching
  });

  it("should not de-escalate price", () => {
    // Currently at Hot, new distance is large → should NOT update
    expect(shouldUpdatePrice(PriceTier.Hot, 999999999999n)).toBe(false);
    // Currently at Base, new distance is small → should update
    expect(shouldUpdatePrice(PriceTier.Base, 50n)).toBe(true);
  });

  it("should escalate from Warm to Hot", () => {
    expect(shouldUpdatePrice(PriceTier.Warm, 50n)).toBe(true);
  });

  it("should not escalate if same tier", () => {
    expect(shouldUpdatePrice(PriceTier.Hot, 60n)).toBe(false);
  });
});

// ─── Crypto ────────────────────────────────────────────────────────────────────

describe("crypto", () => {
  it("should generate 12-digit targets", () => {
    for (let i = 0; i < 10; i++) {
      const { target, salt } = generateTarget();
      expect(target).toMatch(/^\d{12}$/);
      expect(salt).toMatch(/^0x[a-f0-9]{64}$/);
    }
  });

  it("should compute deterministic commitments", () => {
    const c1 = computeCommitment("123456789012", "round-1", "0x" + "ab".repeat(32));
    const c2 = computeCommitment("123456789012", "round-1", "0x" + "ab".repeat(32));
    expect(c1).toBe(c2);
  });

  it("should produce different commitments for different targets", () => {
    const salt = "0x" + "ab".repeat(32);
    const c1 = computeCommitment("123456789012", "round-1", salt);
    const c2 = computeCommitment("999999999999", "round-1", salt);
    expect(c1).not.toBe(c2);
  });

  it("should seal and unseal data", () => {
    const original = "secret-target-123456789012";
    const sealed = sealData(original);
    expect(sealed).not.toBe(original);
    const unsealed = unsealData(sealed);
    expect(unsealed).toBe(original);
  });
});

// ─── Audit ─────────────────────────────────────────────────────────────────────

describe("audit", () => {
  it("should build a hash chain", () => {
    const roundId = "audit-test-round";
    addAuditEntry(roundId, AuditEntryType.RoundStart, { test: true });
    addAuditEntry(roundId, AuditEntryType.Guess, { player: "0x1234" });
    addAuditEntry(roundId, AuditEntryType.Hint, { distance: 100 });

    expect(verifyChainIntegrity(roundId)).toBe(true);
  });

  it("should compute a merkle root", () => {
    const roundId = "merkle-test-round";
    addAuditEntry(roundId, AuditEntryType.RoundStart, { test: true });
    addAuditEntry(roundId, AuditEntryType.Guess, { player: "0xabcd" });

    const root = computeMerkleRoot(roundId);
    expect(root).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("should produce consistent merkle roots", () => {
    const roundId = "merkle-consistency";
    addAuditEntry(roundId, AuditEntryType.RoundStart, { test: true });

    const root1 = computeMerkleRoot(roundId);
    const root2 = computeMerkleRoot(roundId);
    expect(root1).toBe(root2);
  });
});

// ─── Round Lifecycle ───────────────────────────────────────────────────────────

describe("round lifecycle", () => {
  it("should start a new round", async () => {
    const baseBuyIn = 10000000000000000n; // 0.01 ETH
    const { round, signedStartRound } = await startNewRound(baseBuyIn);

    expect(round.id).toBeTruthy();
    expect(round.target).toMatch(/^\d{12}$/);
    expect(round.commitmentHash).toMatch(/^0x/);
    expect(round.baseBuyIn).toBe(baseBuyIn);
    expect(round.currentBuyIn).toBe(baseBuyIn);
    expect(round.pool).toBe(0n);
    expect(signedStartRound.signature).toBeTruthy();
  });

  it("should process guesses and return hints", async () => {
    const { round } = await startNewRound(10000000000000000n);
    const result = await processGuess(
      round.id,
      "0x1234567890123456789012345678901234567890",
      "000000000000",
      round.currentBuyIn,
    );

    expect(result.hint.digitsInPlace).toBeGreaterThanOrEqual(0);
    expect(result.hint.digitsCorrect).toBeGreaterThanOrEqual(0);
    expect(result.signedHint.signature).toBeTruthy();
  });

  it("should detect a winner on exact match", async () => {
    const { round } = await startNewRound(10000000000000000n);
    const player = "0x1234567890123456789012345678901234567890";

    // Cheat: use the actual target to simulate a winning guess
    const target = round.target;
    const result = await processGuess(
      round.id,
      player,
      target,
      round.currentBuyIn,
    );

    expect(result.hint.isExactMatch).toBe(true);
    expect(result.winnerDeclaration).not.toBeNull();
    expect(result.winnerDeclaration!.winner).toBe(player);

    const updated = getRound(round.id);
    expect(updated!.status).toBe("completed");
    expect(updated!.winner).toBe(player);
  });

  it("should reject guesses on completed rounds", async () => {
    const { round } = await startNewRound(10000000000000000n);
    const player = "0x1234567890123456789012345678901234567890";

    // Win the round
    await processGuess(round.id, player, round.target, round.currentBuyIn);

    // Try to guess again
    await expect(
      processGuess(round.id, player, "000000000000", round.currentBuyIn),
    ).rejects.toThrow("not active");
  });

  it("should reject insufficient buy-in", async () => {
    const { round } = await startNewRound(10000000000000000n);
    const player = "0x1234567890123456789012345678901234567890";

    await expect(
      processGuess(round.id, player, "000000000000", 1n),
    ).rejects.toThrow("Insufficient buy-in");
  });
});
