import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import {
  StartRoundRequestSchema,
  GuessRequestSchema,
  type RoundStatusResponse,
  type AuditResponse,
  type AttestationResponse,
} from "./types.js";
import {
  initSigner,
  initSignerFromMnemonic,
  getSigner,
} from "./crypto.js";
import {
  startNewRound,
  processGuess,
  getRound,
} from "./game.js";
import {
  getAuditTrail,
  computeMerkleRoot,
  getSignedAuditRoot,
} from "./audit.js";

const app = express();
app.use(express.json());
app.use(cors());
app.use(helmet());

// Rate limit: 1 guess per 12 seconds per IP
const guessLimiter = rateLimit({
  windowMs: 12_000,
  max: 1,
  message: { error: "Rate limited: 1 guess per 12 seconds" },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Initialize signer ────────────────────────────────────────────────────────

function initializeEnclave() {
  const mnemonic = process.env.MNEMONIC;
  const devKey = process.env.DEV_PRIVATE_KEY;

  if (mnemonic) {
    initSignerFromMnemonic(mnemonic);
    console.log("Enclave initialized in TEE mode");
  } else if (devKey) {
    initSigner(devKey);
    console.log("Enclave initialized in SIMULATION mode");
  } else {
    throw new Error(
      "No signer configured. Set MNEMONIC (TEE) or DEV_PRIVATE_KEY (simulation)",
    );
  }

  const wallet = getSigner();
  console.log(`Enclave address: ${wallet.address}`);
}

// ─── Routes ────────────────────────────────────────────────────────────────────

app.post("/round/start", async (req, res) => {
  try {
    const parsed = StartRoundRequestSchema.parse(req.body);
    const baseBuyIn = BigInt(parsed.baseBuyIn);

    const { round, signedStartRound } = await startNewRound(baseBuyIn);

    res.json({
      roundId: round.id,
      commitmentHash: round.commitmentHash,
      baseBuyIn: round.baseBuyIn.toString(),
      signedStartRound,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/guess", guessLimiter, async (req, res) => {
  try {
    const parsed = GuessRequestSchema.parse(req.body);
    const { roundId, guess, player, txHash } = parsed;

    const round = getRound(roundId);
    if (!round) {
      res.status(404).json({ error: "Round not found" });
      return;
    }

    // In production, verify txHash on-chain to confirm buy-in payment.
    // For now, use the round's currentBuyIn as the assumed payment.
    const buyInPaid = round.currentBuyIn;

    const result = await processGuess(roundId, player, guess, buyInPaid);

    res.json({
      hint: {
        digitsInPlace: result.hint.digitsInPlace,
        digitsCorrect: result.hint.digitsCorrect,
        numericDistance: result.hint.numericDistance.toString(),
        priceTier: result.hint.priceTier,
      },
      signedHint: result.signedHint,
      pricingUpdate: result.priceUpdate,
      winner: result.winnerDeclaration,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/round/:id/status", (req, res) => {
  try {
    const round = getRound(req.params.id);
    if (!round) {
      res.status(404).json({ error: "Round not found" });
      return;
    }

    const response: RoundStatusResponse = {
      roundId: round.id,
      status: round.status,
      currentBuyIn: round.currentBuyIn.toString(),
      pool: round.pool.toString(),
      guessCount: round.guesses.length,
      priceTier: round.currentTier,
      commitmentHash: round.commitmentHash,
    };

    res.json(response);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/round/:id/audit", async (req, res) => {
  try {
    const trail = getAuditTrail(req.params.id);
    const merkleRoot =
      trail.entries.length > 0
        ? computeMerkleRoot(req.params.id)
        : null;
    const signedMerkleRoot =
      trail.entries.length > 0
        ? await getSignedAuditRoot(req.params.id)
        : null;

    const response: AuditResponse = {
      entries: trail.entries,
      merkleRoot,
      signedMerkleRoot,
    };

    res.json(response);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/attestation", (_req, res) => {
  try {
    const wallet = getSigner();
    const mode = process.env.MNEMONIC ? "tee" : "simulation";

    const response: AttestationResponse = {
      address: wallet.address,
      publicKey: wallet.signingKey.publicKey,
      mode,
    };

    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3000", 10);

initializeEnclave();
app.listen(PORT, () => {
  console.log(`HotColdLotto enclave running on port ${PORT}`);
});

export default app;
