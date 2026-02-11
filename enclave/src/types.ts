import { z } from "zod";

// ─── Price Tiers ───────────────────────────────────────────────────────────────

export enum PriceTier {
  Base = "base",
  Warm = "warm",
  Hot = "hot",
  Scorching = "scorching",
}

export interface PricingConfig {
  baseBuyIn: bigint;
  tiers: {
    tier: PriceTier;
    maxDistance: bigint; // numeric distance threshold (inclusive)
    multiplier: number;
  }[];
}

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  baseBuyIn: 10000000000000000n, // 0.01 ETH
  tiers: [
    { tier: PriceTier.Base, maxDistance: BigInt("999999999999"), multiplier: 1 },
    { tier: PriceTier.Warm, maxDistance: 1000n, multiplier: 2 },
    { tier: PriceTier.Hot, maxDistance: 100n, multiplier: 5 },
    { tier: PriceTier.Scorching, maxDistance: 10n, multiplier: 10 },
  ],
};

// ─── Game State ────────────────────────────────────────────────────────────────

export enum RoundStatus {
  Active = "active",
  Completed = "completed",
}

export interface HintResult {
  digitsInPlace: number; // exact position matches (bulls)
  digitsCorrect: number; // right digit, wrong position (cows)
  numericDistance: bigint;
  isExactMatch: boolean;
  priceTier: PriceTier;
}

export interface GuessRecord {
  player: string;
  guess: string;
  hint: HintResult;
  buyInPaid: bigint;
  timestamp: number;
}

export interface RoundState {
  id: string;
  target: string; // sealed in production
  salt: string;
  commitmentHash: string;
  baseBuyIn: bigint;
  currentBuyIn: bigint;
  currentTier: PriceTier;
  pool: bigint;
  guesses: GuessRecord[];
  status: RoundStatus;
  winner: string | null;
  startTimestamp: number;
  endTimestamp: number | null;
}

// ─── Signed Messages ───────────────────────────────────────────────────────────

export interface SignedStartRound {
  roundId: string;
  commitmentHash: string;
  baseBuyIn: string; // wei string
  nonce: number;
  signature: string;
}

export interface SignedHint {
  roundId: string;
  player: string;
  digitsCorrect: number;
  digitsInPlace: number;
  numericDistance: string; // bigint as string
  nonce: number;
  signature: string;
}

export interface SignedPriceUpdate {
  roundId: string;
  newBuyIn: string; // wei string
  nonce: number;
  signature: string;
}

export interface SignedWinnerDeclaration {
  roundId: string;
  winner: string;
  nonce: number;
  signature: string;
}

export interface SignedAuditRoot {
  roundId: string;
  merkleRoot: string;
  entryCount: number;
  nonce: number;
  signature: string;
}

// ─── Audit ─────────────────────────────────────────────────────────────────────

export enum AuditEntryType {
  RoundStart = "ROUND_START",
  Guess = "GUESS",
  Hint = "HINT",
  PriceChange = "PRICE_CHANGE",
  Winner = "WINNER",
}

export interface AuditEntry {
  index: number;
  type: AuditEntryType;
  roundId: string;
  data: string; // JSON-encoded payload
  timestamp: number;
  previousHash: string;
  hash: string;
}

export interface AuditTrail {
  roundId: string;
  entries: AuditEntry[];
  merkleRoot: string | null;
}

// ─── API Schemas (Zod) ────────────────────────────────────────────────────────

export const StartRoundRequestSchema = z.object({
  baseBuyIn: z
    .string()
    .regex(/^\d+$/, "baseBuyIn must be a numeric string (wei)"),
});

export const GuessRequestSchema = z.object({
  roundId: z.string().min(1),
  guess: z.string().regex(/^\d{12}$/, "Guess must be exactly 12 digits"),
  player: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address"),
  txHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "Invalid transaction hash"),
});

export type StartRoundRequest = z.infer<typeof StartRoundRequestSchema>;
export type GuessRequest = z.infer<typeof GuessRequestSchema>;

export interface StartRoundResponse {
  roundId: string;
  commitmentHash: string;
  baseBuyIn: string;
  signedStartRound: SignedStartRound;
}

export interface GuessResponse {
  hint: {
    digitsInPlace: number;
    digitsCorrect: number;
    numericDistance: string;
    priceTier: PriceTier;
  };
  signedHint: SignedHint;
  pricingUpdate: SignedPriceUpdate | null;
  winner: SignedWinnerDeclaration | null;
}

export interface RoundStatusResponse {
  roundId: string;
  status: RoundStatus;
  currentBuyIn: string;
  pool: string;
  guessCount: number;
  priceTier: PriceTier;
  commitmentHash: string;
}

export interface AuditResponse {
  entries: AuditEntry[];
  merkleRoot: string | null;
  signedMerkleRoot: SignedAuditRoot | null;
}

export interface AttestationResponse {
  address: string;
  publicKey: string;
  mode: "tee" | "simulation";
}
