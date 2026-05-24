/**
 * Bulk upload professional photos to R2 from a local directory.
 *
 * Usage:
 *   node upload-pro-bulk.js /path/to/folder
 *
 * - Uploads all .jpg/.jpeg/.png files to R2 under party-pro/
 * - Runs Rekognition matching for each in parallel batches
 * - Updates mappings.json
 * - Skips files already uploaded (matching by original filename)
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const r2 = require("./r2");
const rekognition = require("./rekognition");
const mappings = require("./mappings");
const sheets = require("./sheets");
const crypto = require("crypto");

function generateGuestId(name) {
  const normalized = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const hash = crypto.createHash("md5").update(name).digest("hex").slice(0, 6);
  return normalized + "-" + hash;
}

const CONCURRENCY = 8;
const MAX_WIDTH = 1920;
const QUALITY = 85;

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: node upload-pro-bulk.js /path/to/folder");
    process.exit(1);
  }
  if (!fs.existsSync(dir)) {
    console.error("Directory not found:", dir);
    process.exit(1);
  }

  // Find all image files
  function walk(d) {
    const out = [];
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        out.push(...walk(full));
      } else if (/\.(jpg|jpeg|png)$/i.test(f) && !f.startsWith(".")) {
        out.push(full);
      }
    }
    return out;
  }

  const files = walk(dir);
  console.log(`[INFO] Found ${files.length} image files in ${dir}`);

  // Load selfies for matching
  const guests = await sheets.getAllGuests();
  const selfieIds = guests.filter((g) => g.selfieMain && g.guestId).map((g) => g.guestId);
  for (const g of guests) {
    if (g.selfiePartner && g.partnerName) {
      selfieIds.push(generateGuestId(g.partnerName));
    }
  }
  console.log(`[INFO] ${selfieIds.length} selfies loaded for matching`);

  // Check what's already uploaded (skip those)
  console.log(`[INFO] Listing existing party-pro/...`);
  const existing = await r2.listFiles("party-pro/");
  const existingNames = new Set(existing.map((f) => path.basename(f.key, ".jpg")));
  console.log(`[INFO] ${existingNames.size} already in R2`);

  let uploaded = 0;
  let matched = 0;
  let skipped = 0;
  let errors = 0;
  let processed = 0;
  const startTime = Date.now();

  async function processOne(file) {
    const baseName = path.basename(file, path.extname(file));
    // Stable photoId based on filename (so re-runs skip already done)
    const photoId = `pro-${baseName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

    if (existingNames.has(photoId)) {
      skipped++;
      processed++;
      if (processed % 50 === 0) console.log(`[${processed}/${files.length}] skipped (already in R2)`);
      return;
    }

    try {
      // Compress with sharp (resize + JPEG quality)
      const buf = await sharp(file)
        .rotate() // auto-rotate based on EXIF
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: QUALITY, mozjpeg: true })
        .toBuffer();

      // Upload to R2
      await r2.uploadProPhoto(photoId, buf);
      uploaded++;

      // Match in background
      try {
        const matches = await rekognition.matchPhoto(buf, selfieIds);
        if (matches.length > 0) {
          await mappings.addMatch(photoId, "pro", matches);
          matched++;
        }
      } catch (e) {
        console.error(`[REKOG ERR] ${photoId}:`, e.message);
      }

      processed++;
      const dt = ((Date.now() - startTime) / 60000).toFixed(1);
      if (processed % 10 === 0 || processed === files.length) {
        console.log(`[${processed}/${files.length}] uploaded=${uploaded} matched=${matched} skipped=${skipped} errors=${errors} (${dt}min)`);
      }
    } catch (e) {
      errors++;
      processed++;
      console.error(`[ERR] ${file}:`, e.message);
    }
  }

  // Process in concurrent batches
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(processOne));
  }

  const totalMin = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n=== DONE in ${totalMin} min ===`);
  console.log(`Uploaded: ${uploaded}`);
  console.log(`Matched: ${matched}`);
  console.log(`Skipped (already in R2): ${skipped}`);
  console.log(`Errors: ${errors}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
