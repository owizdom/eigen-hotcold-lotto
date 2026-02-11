# HotColdLotto — Setup, Test & Play

## Step 1: Install Dependencies

### Enclave (TypeScript)

```bash
cd "priv casino/enclave"
npm install
```

### Contracts (Solidity)

```bash
cd "priv casino/contracts"
git init && git add -A && git commit -m "init"
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts
```

---

## Step 2: Run Tests

### Enclave Tests (28 tests)

```bash
cd "priv casino/enclave"
npm test
```

Expected output:

```
 ✓ test/game.test.ts (28 tests) 36ms

 Test Files  1 passed (1)
      Tests  28 passed (28)
```

### Contract Tests (13 tests)

```bash
cd "priv casino/contracts"
forge test -vvv
```

Expected output:

```
[PASS] test_AnchorAuditRoot()
[PASS] test_DeclareWinner()
[PASS] test_InvalidSignatureReverts()
[PASS] test_MultipleRounds()
[PASS] test_PriceEscalationFlow()
[PASS] test_RecordHint()
[PASS] test_ReplayPrevention()
[PASS] test_RevertDeclareWinnerOnCompletedRound()
[PASS] test_RevertInsufficientBuyIn()
[PASS] test_RoundNotFound()
[PASS] test_StartRound()
[PASS] test_SubmitGuess()
[PASS] test_UpdateBuyIn()

Suite result: ok. 13 passed; 0 failed; 0 skipped
```

---

## Step 3: Play a Game Locally

### 3a. Start the Enclave Server

```bash
cd "priv casino/enclave"
DEV_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 npx tsx src/index.ts
```

You should see:

```
Enclave initialized in SIMULATION mode
Enclave address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
HotColdLotto enclave running on port 3000
```

> If you get `EADDRINUSE`, kill the old process first:
> `lsof -ti :3000 | xargs kill`
>
> Or use a different port:
> `PORT=3001 DEV_PRIVATE_KEY=0x... npx tsx src/index.ts`

### 3b. Check Attestation

Open a second terminal:

```bash
curl -s http://localhost:3000/attestation | python3 -m json.tool
```

```json
{
    "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "publicKey": "0x048318535b54105d4a7aae60c08fc45f9687181b...",
    "mode": "simulation"
}
```

### 3c. Start a Round

```bash
curl -s -X POST http://localhost:3000/round/start \
  -H "Content-Type: application/json" \
  -d '{"baseBuyIn":"10000000000000000"}' | python3 -m json.tool
```

```json
{
    "roundId": "812c5975-43b7-48ad-bc35-481c809d3cc4",
    "commitmentHash": "0x0a27ea5e...",
    "baseBuyIn": "10000000000000000",
    "signedStartRound": { "..." }
}
```

Copy the `roundId` — you need it for every guess.

### 3d. Submit Your First Guess

Start in the middle — guess `500000000000` to binary-search:

```bash
curl -s -X POST http://localhost:3000/guess \
  -H "Content-Type: application/json" \
  -d '{"roundId":"YOUR_ROUND_ID","guess":"500000000000","player":"0x70997970C51812dc3A010C7d01b50e0d17dc79C8","txHash":"0x0000000000000000000000000000000000000000000000000000000000000001"}' \
  | python3 -m json.tool
```

Example response:

```json
{
    "hint": {
        "digitsInPlace": 1,
        "digitsCorrect": 1,
        "numericDistance": "459276513081",
        "priceTier": "base"
    },
    "signedHint": { "..." },
    "pricingUpdate": null,
    "winner": null
}
```

Reading the hint:
- **numericDistance = 459,276,513,081** — the target is exactly this far from your guess
- **digitsInPlace = 1** — one digit is in the exact right spot
- **digitsCorrect = 1** — one more digit is correct but in the wrong position

> There's a **12-second rate limit** between guesses. Wait before sending the next one.

### 3e. Narrow Down Using Distance

The distance tells you the target is either `500B + 459B` or `500B - 459B`. Try one:

```bash
# Wait 12+ seconds, then:
curl -s -X POST http://localhost:3000/guess \
  -H "Content-Type: application/json" \
  -d '{"roundId":"YOUR_ROUND_ID","guess":"040723486919","player":"0x70997970C51812dc3A010C7d01b50e0d17dc79C8","txHash":"0x0000000000000000000000000000000000000000000000000000000000000002"}' \
  | python3 -m json.tool
```

If the distance goes **way up** (e.g., 918B), you guessed the wrong direction — the target is the other option. If the distance goes **down**, you're getting warmer.

### 3f. Win the Game

Once you know the exact number, submit it:

```bash
# Wait 12+ seconds, then:
curl -s -X POST http://localhost:3000/guess \
  -H "Content-Type: application/json" \
  -d '{"roundId":"YOUR_ROUND_ID","guess":"959276513081","player":"0x70997970C51812dc3A010C7d01b50e0d17dc79C8","txHash":"0x0000000000000000000000000000000000000000000000000000000000000003"}' \
  | python3 -m json.tool
```

Winning response:

```json
{
    "hint": {
        "digitsInPlace": 12,
        "digitsCorrect": 0,
        "numericDistance": "0",
        "priceTier": "scorching"
    },
    "pricingUpdate": {
        "newBuyIn": "100000000000000000"
    },
    "winner": {
        "winner": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "signature": "0x..."
    }
}
```

- `digitsInPlace: 12` — all 12 digits matched
- `numericDistance: "0"` — exact match
- `winner` — signed declaration to post on-chain and claim the pool

### 3g. Check Final Round Status

```bash
curl -s http://localhost:3000/round/YOUR_ROUND_ID/status | python3 -m json.tool
```

```json
{
    "roundId": "812c5975-...",
    "status": "completed",
    "currentBuyIn": "100000000000000000",
    "pool": "30000000000000000",
    "guessCount": 3,
    "priceTier": "scorching"
}
```

### 3h. View Audit Trail

```bash
curl -s http://localhost:3000/round/YOUR_ROUND_ID/audit | python3 -m json.tool
```

Shows every action in a hash-chained log:

```
Entry 0: ROUND_START  — commitment hash published
Entry 1: GUESS        — player submitted guess #1
Entry 2: HINT         — enclave returned distance hint
Entry 3: GUESS        — player submitted guess #2
Entry 4: HINT         — enclave returned distance hint
Entry 5: GUESS        — player submitted guess #3
Entry 6: HINT         — 12/12 digits matched!
Entry 7: PRICE_CHANGE — escalated to scorching tier (10x)
Entry 8: WINNER       — winner declared
```

Each entry includes a hash linking to the previous entry (hash chain), plus a signed Merkle root for on-chain anchoring.

---

## Strategy Guide

1. **Binary search with distance** — Start at `500000000000`. The `numericDistance` tells you exactly how far off you are. The target is either `guess + distance` or `guess - distance`. Try one; if the distance doubles, it's the other one.

2. **Use bulls/cows for digit-level hints** — Once you're close numerically, use `digitsInPlace` (bulls) and `digitsCorrect` (cows) to pin individual digits.

3. **Watch the price tier** — As you get closer, the buy-in escalates:
   | Tier | Distance | Buy-in |
   |------|----------|--------|
   | base | > 1000 | 0.01 ETH |
   | warm | <= 1000 | 0.02 ETH |
   | hot | <= 100 | 0.05 ETH |
   | scorching | <= 10 | 0.10 ETH |

4. **Minimum 3 guesses to win** — First guess gives you the distance, second guess resolves the direction, third guess is the exact answer.

---

## Quick Reference

| Endpoint | Method | What It Does |
|---|---|---|
| `/attestation` | GET | Enclave public key & mode |
| `/round/start` | POST | Start a new round |
| `/guess` | POST | Submit a 12-digit guess |
| `/round/:id/status` | GET | Pool, buy-in, guess count |
| `/round/:id/audit` | GET | Full audit trail + Merkle root |


for the frontend

 To test:

  # Terminal 1: Start enclave
  cd "/Users/Apple/Desktop/priv casino/enclave" && DEV_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 npx tsx src/index.ts

  # Terminal 2: Serve frontend
  cd "/Users/Apple/Desktop/priv casino/frontend" && python3 -m http.server 8080

  # Then open http://localhost:8080