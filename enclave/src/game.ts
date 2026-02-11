import { randomUUID } from "node:crypto";
import {
  RoundState,
  RoundStatus,
  HintResult,
  GuessRecord,
  PriceTier,
  PricingConfig,
  DEFAULT_PRICING_CONFIG,
  AuditEntryType,
  SignedStartRound,
  SignedHint,
  SignedPriceUpdate,
  SignedWinnerDeclaration,
} from "./types.js";
import {
  generateTarget,
  computeCommitment,
  signStartRound,
  signHint,
  signPriceUpdate,
  signWinner,
  getNextNonce,
} from "./crypto.js";
import {
  determinePriceTier,
  computeBuyIn,
  shouldUpdatePrice,
} from "./pricing.js";
import { addAuditEntry } from "./audit.js";

// In-memory round storage (single active round for MVP)
const rounds = new Map<string, RoundState>();
let activeRoundId: string | null = null;

// ─── Distance Calculation ──────────────────────────────────────────────────────

/**
 * Calculate distance between target and guess (both 12-digit strings).
 * - digitsInPlace: exact position match count (bulls)
 * - digitsCorrect: right digit in wrong position count (cows, Bulls & Cows style)
 * - numericDistance: abs(BigInt(target) - BigInt(guess))
 */
export function calculateDistance(
  target: string,
  guess: string,
  config: PricingConfig = DEFAULT_PRICING_CONFIG,
): HintResult {
  if (target.length !== 12 || guess.length !== 12) {
    throw new Error("Target and guess must be 12 digits");
  }

  // Bulls (exact position match)
  let digitsInPlace = 0;
  const targetRemaining: (string | null)[] = [...target];
  const guessRemaining: (string | null)[] = [...guess];

  for (let i = 0; i < 12; i++) {
    if (target[i] === guess[i]) {
      digitsInPlace++;
      targetRemaining[i] = null;
      guessRemaining[i] = null;
    }
  }

  // Cows (right digit, wrong position)
  let digitsCorrect = 0;
  for (let i = 0; i < 12; i++) {
    if (guessRemaining[i] === null) continue;
    const idx = targetRemaining.indexOf(guessRemaining[i]);
    if (idx !== -1) {
      digitsCorrect++;
      targetRemaining[idx] = null;
    }
  }

  const numericDistance =
    BigInt(target) > BigInt(guess)
      ? BigInt(target) - BigInt(guess)
      : BigInt(guess) - BigInt(target);

  const isExactMatch = digitsInPlace === 12;
  const priceTier = determinePriceTier(numericDistance, config);

  return {
    digitsInPlace,
    digitsCorrect,
    numericDistance,
    isExactMatch,
    priceTier,
  };
}

// ─── Round Management ──────────────────────────────────────────────────────────

export async function startNewRound(
  baseBuyIn: bigint,
): Promise<{ round: RoundState; signedStartRound: SignedStartRound }> {
  const roundId = randomUUID();
  const { target, salt } = generateTarget();
  const commitmentHash = computeCommitment(target, roundId, salt);

  const round: RoundState = {
    id: roundId,
    target,
    salt,
    commitmentHash,
    baseBuyIn,
    currentBuyIn: baseBuyIn,
    currentTier: PriceTier.Base,
    pool: 0n,
    guesses: [],
    status: RoundStatus.Active,
    winner: null,
    startTimestamp: Date.now(),
    endTimestamp: null,
  };

  rounds.set(roundId, round);
  activeRoundId = roundId;

  // Sign round start
  const nonce = getNextNonce();
  const signature = await signStartRound(
    roundId,
    commitmentHash,
    baseBuyIn,
    nonce,
  );

  const signedStart: SignedStartRound = {
    roundId,
    commitmentHash,
    baseBuyIn: baseBuyIn.toString(),
    nonce,
    signature,
  };

  // Audit
  addAuditEntry(roundId, AuditEntryType.RoundStart, {
    commitmentHash,
    baseBuyIn: baseBuyIn.toString(),
  });

  return { round, signedStartRound: signedStart };
}

export async function processGuess(
  roundId: string,
  player: string,
  guess: string,
  buyInPaid: bigint,
): Promise<{
  hint: HintResult;
  signedHint: SignedHint;
  priceUpdate: SignedPriceUpdate | null;
  winnerDeclaration: SignedWinnerDeclaration | null;
}> {
  const round = rounds.get(roundId);
  if (!round) throw new Error("Round not found");
  if (round.status !== RoundStatus.Active)
    throw new Error("Round is not active");
  if (buyInPaid < round.currentBuyIn)
    throw new Error("Insufficient buy-in");

  // Calculate hint
  const hint = calculateDistance(round.target, guess);

  // Record guess
  const record: GuessRecord = {
    player,
    guess,
    hint,
    buyInPaid,
    timestamp: Date.now(),
  };
  round.guesses.push(record);
  round.pool += buyInPaid;

  // Audit: guess + hint
  addAuditEntry(roundId, AuditEntryType.Guess, {
    player,
    guessHash: guess, // in prod, you'd hash the guess
    buyInPaid: buyInPaid.toString(),
  });

  addAuditEntry(roundId, AuditEntryType.Hint, {
    player,
    digitsInPlace: hint.digitsInPlace,
    digitsCorrect: hint.digitsCorrect,
    numericDistance: hint.numericDistance.toString(),
  });

  // Sign hint
  const hintNonce = getNextNonce();
  const hintSig = await signHint(
    roundId,
    player,
    hint.digitsCorrect,
    hint.digitsInPlace,
    hint.numericDistance,
    hintNonce,
  );

  const signedHint: SignedHint = {
    roundId,
    player,
    digitsCorrect: hint.digitsCorrect,
    digitsInPlace: hint.digitsInPlace,
    numericDistance: hint.numericDistance.toString(),
    nonce: hintNonce,
    signature: hintSig,
  };

  // Check pricing escalation
  let priceUpdate: SignedPriceUpdate | null = null;
  if (shouldUpdatePrice(round.currentTier, hint.numericDistance)) {
    const newTier = determinePriceTier(hint.numericDistance);
    const newBuyIn = computeBuyIn(hint.numericDistance);
    round.currentTier = newTier;
    round.currentBuyIn = newBuyIn;

    const priceNonce = getNextNonce();
    const priceSig = await signPriceUpdate(roundId, newBuyIn, priceNonce);
    priceUpdate = {
      roundId,
      newBuyIn: newBuyIn.toString(),
      nonce: priceNonce,
      signature: priceSig,
    };

    addAuditEntry(roundId, AuditEntryType.PriceChange, {
      newTier,
      newBuyIn: newBuyIn.toString(),
    });
  }

  // Check winner
  let winnerDeclaration: SignedWinnerDeclaration | null = null;
  if (hint.isExactMatch) {
    round.status = RoundStatus.Completed;
    round.winner = player;
    round.endTimestamp = Date.now();

    const winnerNonce = getNextNonce();
    const winnerSig = await signWinner(roundId, player, winnerNonce);
    winnerDeclaration = {
      roundId,
      winner: player,
      nonce: winnerNonce,
      signature: winnerSig,
    };

    addAuditEntry(roundId, AuditEntryType.Winner, { winner: player });
  }

  return { hint, signedHint, priceUpdate, winnerDeclaration };
}

// ─── Getters ───────────────────────────────────────────────────────────────────

export function getRound(roundId: string): RoundState | undefined {
  return rounds.get(roundId);
}

export function getActiveRoundId(): string | null {
  return activeRoundId;
}
