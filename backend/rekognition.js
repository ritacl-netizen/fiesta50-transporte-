const {
  RekognitionClient,
  CompareFacesCommand,
} = require("@aws-sdk/client-rekognition");
const r2 = require("./r2");

const rekClient = new RekognitionClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const SIMILARITY_THRESHOLD = 80; // 0-100, higher = stricter

// Cache selfie buffers in memory to avoid re-downloading
const selfieCache = new Map();

async function loadSelfie(guestId) {
  if (selfieCache.has(guestId)) return selfieCache.get(guestId);

  try {
    const buffer = await r2.getFile(`selfies/${guestId}.jpg`);
    // Verify it's a real JPEG
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
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

// Match a photo against all known selfies in parallel (batched)
// Returns array of matched guestIds
async function matchPhoto(photoBuffer, guestSelfieIds) {
  const BATCH_SIZE = 10; // Parallel comparisons per batch
  const matches = [];

  for (let i = 0; i < guestSelfieIds.length; i += BATCH_SIZE) {
    const batch = guestSelfieIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (guestId) => {
        const selfieBuffer = await loadSelfie(guestId);
        if (!selfieBuffer) return null;
        const isMatch = await compareFaces(photoBuffer, selfieBuffer);
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
