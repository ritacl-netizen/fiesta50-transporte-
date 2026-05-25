const {
  RekognitionClient,
  CompareFacesCommand,
} = require("@aws-sdk/client-rekognition");
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const https = require("https");
const r2 = require("./r2");

// Custom HTTPS agent with bigger socket pool
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 500,
});

// Sharp is optional - only used to shrink images > 5MB
let sharp = null;
try { sharp = require("sharp"); } catch (e) {}

const REKOGNITION_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

async function shrinkForRekognition(buffer) {
  if (buffer.length <= REKOGNITION_MAX_BYTES) return buffer;
  if (!sharp) return buffer; // can't shrink, will error
  // Progressive resize until under 5MB
  for (const maxW of [1920, 1280, 960, 720]) {
    const out = await sharp(buffer)
      .rotate()
      .resize({ width: maxW, withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    if (out.length <= REKOGNITION_MAX_BYTES) return out;
  }
  // Last attempt with lower quality
  return await sharp(buffer)
    .rotate()
    .resize({ width: 720, withoutEnlargement: true })
    .jpeg({ quality: 70, mozjpeg: true })
    .toBuffer();
}

const rekClient = new RekognitionClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  requestHandler: new NodeHttpHandler({ httpsAgent }),
});

const SIMILARITY_THRESHOLD = 80; // 0-100, higher = stricter

// Cache selfie buffers in memory to avoid re-downloading
const selfieCache = new Map();

async function loadSelfie(guestId) {
  if (selfieCache.has(guestId)) return selfieCache.get(guestId);

  try {
    const raw = await r2.getFile(`selfies/${guestId}.jpg`);
    // Verify it's a real JPEG
    if (raw[0] === 0xFF && raw[1] === 0xD8) {
      const buffer = await shrinkForRekognition(raw);
      selfieCache.set(guestId, buffer);
      return buffer;
    }
  } catch (e) {
    // Selfie not found
  }
  return null;
}

// Compare a photo against a single selfie
async function compareFaces(photoBuffer, selfieBuffer) {
  try {
    const result = await rekClient.send(
      new CompareFacesCommand({
        SourceImage: { Bytes: selfieBuffer },
        TargetImage: { Bytes: photoBuffer },
        SimilarityThreshold: SIMILARITY_THRESHOLD,
      })
    );
    return result.FaceMatches && result.FaceMatches.length > 0;
  } catch (e) {
    // InvalidParameterException = no face detected, not an error
    if (e.name === "InvalidParameterException") return false;
    console.error("[Rekognition] Compare error:", e.message);
    return false;
  }
}

// Cache shrunken photo buffer per matchPhoto call
async function ensureSize(buffer) {
  return shrinkForRekognition(buffer);
}

// Match a photo against all known selfies in parallel (batched)
// Returns array of matched guestIds
async function matchPhoto(photoBuffer, guestSelfieIds) {
  const BATCH_SIZE = 40; // Parallel comparisons per batch (Rekognition allows high concurrency)
  const matches = [];

  // Shrink photo once if needed (Rekognition limit 5MB)
  const photoForRekognition = await ensureSize(photoBuffer);

  for (let i = 0; i < guestSelfieIds.length; i += BATCH_SIZE) {
    const batch = guestSelfieIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (guestId) => {
        const selfieBuffer = await loadSelfie(guestId);
        if (!selfieBuffer) return null;
        const isMatch = await compareFaces(photoForRekognition, selfieBuffer);
        return isMatch ? guestId : null;
      })
    );
    for (const r of results) {
      if (r) matches.push(r);
    }
  }

  return matches;
}

// Clear cache (e.g., when new selfies are uploaded)
function clearCache() {
  selfieCache.clear();
}

module.exports = { matchPhoto, clearCache, loadSelfie };
