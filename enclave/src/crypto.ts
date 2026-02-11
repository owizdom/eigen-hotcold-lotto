import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { Wallet, solidityPackedKeccak256, getBytes, keccak256 } from "ethers";

let signer: Wallet | null = null;
let nonceCounter = 0;

// ─── Signer Management ────────────────────────────────────────────────────────

export function initSignerFromMnemonic(mnemonic: string): Wallet {
  signer = Wallet.fromPhrase(mnemonic);
  nonceCounter = 0;
  return signer;
}

export function initSigner(privateKey: string): Wallet {
  signer = new Wallet(privateKey);
  nonceCounter = 0;
  return signer;
}

export function getSigner(): Wallet {
  if (!signer) throw new Error("Signer not initialized");
  return signer;
}

export function getNextNonce(): number {
  return nonceCounter++;
}

// ─── Target Generation ─────────────────────────────────────────────────────────

export function generateTarget(): { target: string; salt: string } {
  // Generate 12-digit target using crypto.randomBytes
  const bytes = randomBytes(8); // 64 bits of randomness
  const num = BigInt("0x" + bytes.toString("hex")) % 1000000000000n;
  const target = num.toString().padStart(12, "0");

  const salt = "0x" + randomBytes(32).toString("hex");
  return { target, salt };
}

// ─── Commitment ────────────────────────────────────────────────────────────────

export function computeCommitment(
  target: string,
  roundId: string,
  salt: string,
): string {
  return solidityPackedKeccak256(
    ["string", "string", "bytes32"],
    [target, roundId, salt],
  );
}

// ─── Signing Functions ─────────────────────────────────────────────────────────

export async function signStartRound(
  roundId: string,
  commitmentHash: string,
  baseBuyIn: bigint,
  nonce: number,
): Promise<string> {
  const w = getSigner();
  const messageHash = solidityPackedKeccak256(
    ["string", "bytes32", "uint256", "uint256"],
    [roundId, commitmentHash, baseBuyIn, nonce],
  );
  return w.signMessage(getBytes(messageHash));
}

export async function signHint(
  roundId: string,
  player: string,
  digitsCorrect: number,
  digitsInPlace: number,
  numericDistance: bigint,
  nonce: number,
): Promise<string> {
  const w = getSigner();
  const messageHash = solidityPackedKeccak256(
    ["string", "address", "uint8", "uint8", "uint256", "uint256"],
    [roundId, player, digitsCorrect, digitsInPlace, numericDistance, nonce],
  );
  return w.signMessage(getBytes(messageHash));
}

export async function signPriceUpdate(
  roundId: string,
  newBuyIn: bigint,
  nonce: number,
): Promise<string> {
  const w = getSigner();
  const messageHash = solidityPackedKeccak256(
    ["string", "uint256", "uint256"],
    [roundId, newBuyIn, nonce],
  );
  return w.signMessage(getBytes(messageHash));
}

export async function signWinner(
  roundId: string,
  winner: string,
  nonce: number,
): Promise<string> {
  const w = getSigner();
  const messageHash = solidityPackedKeccak256(
    ["string", "address", "uint256"],
    [roundId, winner, nonce],
  );
  return w.signMessage(getBytes(messageHash));
}

export async function signAuditRoot(
  roundId: string,
  merkleRoot: string,
  entryCount: number,
  nonce: number,
): Promise<string> {
  const w = getSigner();
  const messageHash = solidityPackedKeccak256(
    ["string", "bytes32", "uint256", "uint256"],
    [roundId, merkleRoot, entryCount, nonce],
  );
  return w.signMessage(getBytes(messageHash));
}

// ─── Seal / Unseal (AES-256 simulation for dev) ───────────────────────────────

const SEAL_KEY_HEX =
  process.env.SEAL_KEY || "0".repeat(64); // 32 bytes hex — dev default
const SEAL_KEY = Buffer.from(SEAL_KEY_HEX, "hex");

export function sealData(plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", SEAL_KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function unsealData(sealed: string): string {
  const [ivHex, encHex] = sealed.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encHex, "hex");
  const decipher = createDecipheriv("aes-256-cbc", SEAL_KEY, iv);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
}
