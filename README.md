# HotColdLotto — TEE-Enforced Guessing Game on EigenCompute

A provably fair "hot-cold" lottery where a TEE enclave generates a sealed 12-digit target number. Players submit guesses with ETH buy-ins; the enclave returns deterministic distance hints. As guesses get closer, buy-ins automatically escalate to slow brute-force and grow the pot. First exact match wins the entire pool.

All logic is enclave-enforced with signed audit trails, designed for deployment on EigenCloud (Layr-Labs Intel TDX infrastructure).

## Architecture

```
┌──────────────┐         HTTPS          ┌──────────────────────┐
│   Players    │ ◄─────────────────────► │   TEE Enclave        │
│              │   guess → signed hint   │   (TypeScript/Node)  │
│  submit ETH  │                         │   - target sealed    │
│  to contract │                         │   - distance calc    │
└──────┬───────┘                         │   - pricing engine   │
       │                                 │   - audit trail      │
       │ on-chain                        └──────────┬───────────┘
       ▼                                            │
┌──────────────────────┐     signed messages        │
│  HotColdLotto.sol    │ ◄──────────────────────────┘
│  - pool management   │   (hints, prices, winner)
│  - buy-in collection │
│  - payout            │   Verified via TEEVerifier.sol
│  - audit anchoring   │   using ECDSA ecrecover
└──────────────────────┘
```

Guesses go off-chain to the enclave (prevents mempool front-running). The contract only records that a player paid. Signed hints/pricing/winner declarations are posted on-chain for transparency.

## Project Structure

```
priv casino/
├── contracts/
│   ├── src/
│   │   ├── HotColdLotto.sol          # Main game: rounds, pool, payouts
│   │   ├── TEEVerifier.sol           # ECDSA signature + nonce verification
│   │   └── interfaces/
│   │       ├── IHotColdLotto.sol
│   │       └── ITEEVerifier.sol
│   ├── test/
│   │   └── HotColdLotto.t.sol
│   ├── script/
│   │   └── Deploy.s.sol
│   └── foundry.toml
├── enclave/
│   ├── src/
│   │   ├── index.ts                  # Express API server
│   │   ├── game.ts                   # Target gen, distance calc, round state
│   │   ├── crypto.ts                 # ECDSA signing, commitment, seal/unseal
│   │   ├── pricing.ts               # Deterministic tier-based pricing curve
│   │   ├── audit.ts                  # Hash-chained log + Merkle tree
│   │   └── types.ts                  # Shared type definitions
│   ├── test/
│   │   └── game.test.ts
│   ├── package.json
│   └── tsconfig.json
├── Dockerfile                        # EigenCloud TEE deployment (linux/amd64)
├── .env.example
└── README.md
```

## How It Works

### Game Flow

1. **Round Start** — The enclave generates a random 12-digit target, seals it, and publishes a commitment hash (`keccak256(target, roundId, salt)`) on-chain.
2. **Guess Submission** — Players call `submitGuess()` on-chain with ETH equal to the current buy-in. The actual guess (12 digits) is sent off-chain to the enclave via `POST /guess`.
3. **Hint Response** — The enclave computes a deterministic distance hint:
   - **Bulls** (`digitsInPlace`): digits in the exact correct position
   - **Cows** (`digitsCorrect`): correct digits in wrong positions
   - **Numeric distance**: `|target - guess|`
4. **Price Escalation** — When any guess gets close, the buy-in escalates globally:
   | Tier | Distance | Multiplier |
   |------|----------|------------|
   | Base | > 1000 | 1x |
   | Warm | ≤ 1000 | 2x |
   | Hot | ≤ 100 | 5x |
   | Scorching | ≤ 10 | 10x |
5. **Winner** — First exact match (all 12 digits correct) wins the entire pool. The enclave signs a winner declaration posted on-chain to trigger payout.

### Security Model

- **Target sealed in TEE** — The target is generated inside the enclave and encrypted at rest (AES-256 in dev, TDX sealing in production).
- **No mempool exposure** — Guesses are sent directly to the enclave over HTTPS, not on-chain.
- **Signed audit trail** — Every action (guess, hint, price change, winner) is logged in a hash-chained audit trail with Merkle root anchored on-chain.
- **Replay prevention** — Each signed message includes a monotonic nonce consumed on-chain.
- **Rate limiting** — 1 guess per 12 seconds per IP to prevent brute-force.

## Setup

### Prerequisites

- Node.js ≥ 20
- [Foundry](https://book.getfoundry.sh/getting-started/installation)

### Enclave (TypeScript)

```bash
cd enclave
npm install

# Copy env and configure
cp ../.env.example .env

# Run dev server
npm run dev

# Run tests
npm test
```

### Contracts (Solidity)

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts

# Run tests
forge test -vvv

# Deploy (local anvil)
ENCLAVE_ADDRESS=0x... forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/round/start` | Start a new round. Body: `{ "baseBuyIn": "10000000000000000" }` |
| `POST` | `/guess` | Submit a guess. Body: `{ "roundId", "guess", "player", "txHash" }` |
| `GET` | `/round/:id/status` | Round status: buy-in, pool, guess count, price tier |
| `GET` | `/round/:id/audit` | Full audit trail with signed Merkle root |
| `GET` | `/attestation` | Enclave public key and mode (tee/simulation) |

## Deployment (EigenCloud)

Build the Docker image targeting `linux/amd64` as required by EigenCloud TDX:

```bash
docker build --platform linux/amd64 -t hotcoldlotto-enclave .
```

In production, set the `MNEMONIC` environment variable (derived from TDX sealing) instead of `DEV_PRIVATE_KEY`.

## Verification

1. **Enclave tests**: `cd enclave && npm test` — distance calculation, pricing tiers, audit chain integrity, round lifecycle
2. **Contract tests**: `cd contracts && forge test -vvv` — round lifecycle, signature verification, replay prevention, price escalation, winner payout
3. **Integration**: Start the enclave locally, call `/round/start`, submit guesses via `/guess`, verify signed hints decode correctly against the enclave's public key
4. **Audit verification**: Fetch `/round/:id/audit`, rebuild the Merkle tree from entries, verify root matches the signed root, verify hash chain integrity
