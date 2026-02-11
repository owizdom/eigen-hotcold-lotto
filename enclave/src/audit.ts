import { keccak256, solidityPackedKeccak256, toUtf8Bytes } from "ethers";
import { AuditEntry, AuditEntryType, AuditTrail } from "./types.js";
import { signAuditRoot, getNextNonce } from "./crypto.js";

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

// In-memory audit trails keyed by roundId
const trails = new Map<string, AuditTrail>();

function getOrCreateTrail(roundId: string): AuditTrail {
  if (!trails.has(roundId)) {
    trails.set(roundId, { roundId, entries: [], merkleRoot: null });
  }
  return trails.get(roundId)!;
}

/**
 * Add an entry to the hash-chained audit log.
 * Each entry hash = keccak256(index, type, roundId, data, timestamp, previousHash)
 */
export function addAuditEntry(
  roundId: string,
  type: AuditEntryType,
  data: Record<string, unknown>,
): AuditEntry {
  const trail = getOrCreateTrail(roundId);
  const index = trail.entries.length;
  const previousHash =
    index > 0 ? trail.entries[index - 1].hash : ZERO_HASH;
  const timestamp = Date.now();
  const dataStr = JSON.stringify(data);

  const hash = solidityPackedKeccak256(
    ["uint256", "string", "string", "string", "uint256", "bytes32"],
    [index, type, roundId, dataStr, timestamp, previousHash],
  );

  const entry: AuditEntry = {
    index,
    type,
    roundId,
    data: dataStr,
    timestamp,
    previousHash,
    hash,
  };

  trail.entries.push(entry);
  trail.merkleRoot = null; // invalidate cached root
  return entry;
}

/**
 * Build a binary Merkle tree from entry hashes and return the root.
 */
export function computeMerkleRoot(roundId: string): string {
  const trail = getOrCreateTrail(roundId);
  if (trail.entries.length === 0) return ZERO_HASH;

  let leaves = trail.entries.map((e) => e.hash);

  // Pad to power of 2
  while (leaves.length > 1 && (leaves.length & (leaves.length - 1)) !== 0) {
    leaves.push(ZERO_HASH);
  }

  while (leaves.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < leaves.length; i += 2) {
      const left = leaves[i];
      const right = i + 1 < leaves.length ? leaves[i + 1] : ZERO_HASH;
      next.push(
        solidityPackedKeccak256(["bytes32", "bytes32"], [left, right]),
      );
    }
    leaves = next;
  }

  trail.merkleRoot = leaves[0];
  return leaves[0];
}

/**
 * Get the signed Merkle root for on-chain anchoring.
 */
export async function getSignedAuditRoot(roundId: string) {
  const merkleRoot = computeMerkleRoot(roundId);
  const trail = getOrCreateTrail(roundId);
  const entryCount = trail.entries.length;
  const nonce = getNextNonce();
  const signature = await signAuditRoot(roundId, merkleRoot, entryCount, nonce);

  return {
    roundId,
    merkleRoot,
    entryCount,
    nonce,
    signature,
  };
}

/**
 * Get the full audit trail for a round.
 */
export function getAuditTrail(roundId: string): AuditTrail {
  return getOrCreateTrail(roundId);
}

/**
 * Verify hash chain integrity for a round's audit trail.
 */
export function verifyChainIntegrity(roundId: string): boolean {
  const trail = getOrCreateTrail(roundId);
  for (let i = 0; i < trail.entries.length; i++) {
    const entry = trail.entries[i];
    const expectedPrev = i > 0 ? trail.entries[i - 1].hash : ZERO_HASH;
    if (entry.previousHash !== expectedPrev) return false;

    const expectedHash = solidityPackedKeccak256(
      ["uint256", "string", "string", "string", "uint256", "bytes32"],
      [entry.index, entry.type, entry.roundId, entry.data, entry.timestamp, entry.previousHash],
    );
    if (entry.hash !== expectedHash) return false;
  }
  return true;
}
