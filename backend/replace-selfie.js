/**
 * Replace specific guests' selfies and reprocess only those against all photos.
 *
 * Usage:
 *   node replace-selfie.js <guestId>:/path/to/selfie.jpg [...]
 *
 * Example:
 *   node replace-selfie.js jacobo-cohen-imach-7ed9db:~/Downloads/jacobo.jpeg
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const r2 = require("./r2");
const rekognition = require("./rekognition");
const mappings = require("./mappings");
const sharp = require("sharp");

const SELFIE_BATCH = 6; // photos in parallel for matching

(async () => {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node replace-selfie.js <guestId>:/path/to/selfie.jpg [...]");
    process.exit(1);
  }

  const pairs = [];
  for (const arg of args) {
    const idx = arg.indexOf(":");
    if (idx === -1) {
      console.error(`Invalid arg: ${arg} (expected guestId:/path)`);
      process.exit(1);
    }
    const guestId = arg.slice(0, idx);
    const filePath = arg.slice(idx + 1).replace(/^~/, process.env.HOME);
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    pairs.push({ guestId, filePath });
  }

  console.log(`[INFO] Replacing ${pairs.length} selfie(s)`);

  // Step 1: upload new selfies (compress + replace in R2)
  for (const { guestId, filePath } of pairs) {
    console.log(`[UPLOAD] ${guestId} <- ${filePath}`);
    const buf = await sharp(filePath)
      .rotate()
      .resize({ width: 1024, withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    await r2.uploadSelfie(guestId, buf);
    console.log(`  uploaded (${buf.length} bytes)`);
  }

  // Step 2: remove old matches from mappings
  console.log(`\n[CLEAN] Removing old matches from mappings...`);
  const data = await mappings.load();
  const targetIds = new Set(pairs.map((p) => p.guestId));
  let removedFromPhotos = 0;

  for (const source of ["whatsapp", "pro"]) {
    const photoToGuests = data.photo_to_guests[source] || {};
    for (const [photoId, guestIds] of Object.entries(photoToGuests)) {
      const filtered = guestIds.filter((g) => !targetIds.has(g));
      if (filtered.length !== guestIds.length) {
        photoToGuests[photoId] = filtered;
        removedFromPhotos++;
      }
    }
  }

  for (const guestId of targetIds) {
    if (data.guest_to_photos[guestId]) {
      delete data.guest_to_photos[guestId];
    }
  }

  await mappings.save(data);
  console.log(`  removed ${removedFromPhotos} old photo-guest links`);

  // Step 3: clear rekognition cache to use new selfies
  rekognition.clearCache();

  // Step 4: list all photos
  const [waPhotos, proPhotos] = await Promise.all([
    r2.listFiles("party-whatsapp/"),
    r2.listFiles("party-pro/"),
  ]);
  const allPhotos = [...waPhotos, ...proPhotos];
  console.log(`\n[MATCH] ${allPhotos.length} photos to check against ${pairs.length} new selfie(s)`);

  // Step 5: for each photo, check against ONLY the new selfies
  const targetSelfieIds = pairs.map((p) => p.guestId);
  let processed = 0;
  let matched = 0;
  const startTime = Date.now();
  const newMatches = [];

  async function processOne(photo) {
    const source = photo.key.startsWith("party-whatsapp/") ? "whatsapp" : "pro";
    const photoId = photo.key.replace(/^party-(whatsapp|pro)\//, "").replace(/\.jpg$/, "");

    try {
      const buf = await r2.getFile(photo.key);
      if (buf[0] !== 0xFF) return;

      const matches = await rekognition.matchPhoto(buf, targetSelfieIds);
      processed++;

      if (matches.length > 0) {
        newMatches.push({ photoId, source, guestIds: matches });
        matched++;
        console.log(`  [${processed}/${allPhotos.length}] ${photoId} -> ${matches.join(", ")}`);
      } else if (processed % 50 === 0) {
        const dt = ((Date.now() - startTime) / 60000).toFixed(1);
        console.log(`  [${processed}/${allPhotos.length}] matched=${matched} (${dt}min)`);
      }
    } catch (e) {
      console.error(`  [ERR] ${photoId}:`, e.message);
    }
  }

  // Process in concurrent batches
  for (let i = 0; i < allPhotos.length; i += SELFIE_BATCH) {
    const batch = allPhotos.slice(i, i + SELFIE_BATCH).map(processOne);
    await Promise.all(batch);
  }

  // Step 6: write all matches at once
  console.log(`\n[SAVE] Writing ${newMatches.length} matches to mappings...`);
  const finalData = await mappings.load();
  for (const m of newMatches) {
    if (!finalData.photo_to_guests[m.source]) finalData.photo_to_guests[m.source] = {};
    const existing = finalData.photo_to_guests[m.source][m.photoId] || [];
    const merged = Array.from(new Set([...existing, ...m.guestIds]));
    finalData.photo_to_guests[m.source][m.photoId] = merged;
    for (const gid of m.guestIds) {
      if (!finalData.guest_to_photos[gid]) finalData.guest_to_photos[gid] = {};
      if (!finalData.guest_to_photos[gid][m.source]) finalData.guest_to_photos[gid][m.source] = [];
      if (!finalData.guest_to_photos[gid][m.source].includes(m.photoId)) {
        finalData.guest_to_photos[gid][m.source].push(m.photoId);
      }
    }
  }
  await mappings.save(finalData);

  const totalMin = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n=== DONE in ${totalMin} min ===`);
  console.log(`Photos processed: ${processed}`);
  console.log(`New matches: ${matched}`);
  for (const id of targetSelfieIds) {
    const g = finalData.guest_to_photos[id];
    const wa = g?.whatsapp?.length || 0;
    const pro = g?.pro?.length || 0;
    console.log(`  ${id}: ${wa + pro} fotos (wa: ${wa}, pro: ${pro})`);
  }
})();
