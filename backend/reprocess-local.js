require("dotenv").config();
const sheets = require("./sheets");
const rekognition = require("./rekognition");
const mappings = require("./mappings");
const r2 = require("./r2");
const crypto = require("crypto");

function generateGuestId(name) {
  const normalized = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const hash = crypto.createHash("md5").update(name).digest("hex").slice(0, 6);
  return normalized + "-" + hash;
}

(async () => {
  const startTime = Date.now();
  const guests = await sheets.getAllGuests();
  const selfieIds = guests.filter((g) => g.selfieMain && g.guestId).map((g) => g.guestId);
  for (const g of guests) {
    if (g.selfiePartner && g.partnerName) {
      selfieIds.push(generateGuestId(g.partnerName));
    }
  }
  console.log(`[INFO] ${selfieIds.length} selfies loaded`);

  const waPhotos = await r2.listFiles("party-whatsapp/");
  const proPhotos = await r2.listFiles("party-pro/");
  const allPhotos = [...waPhotos, ...proPhotos];
  console.log(`[INFO] ${allPhotos.length} photos to process`);

  // Load existing mappings to skip already-matched photos if same selfie count
  const existing = await mappings.load();

  let processed = 0;
  let matched = 0;
  let skipped = 0;
  let errors = 0;

  for (const photo of allPhotos) {
    const source = photo.key.startsWith("party-whatsapp/") ? "whatsapp" : "pro";
    const photoId = photo.key.replace(/^party-(whatsapp|pro)\//, "").replace(/\.jpg$/, "");

    try {
      const buf = await r2.getFile(photo.key);
      if (buf[0] !== 0xFF) {
        skipped++;
        continue;
      }

      processed++;
      const t0 = Date.now();
      const matches = await rekognition.matchPhoto(buf, selfieIds);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);

      if (matches.length > 0) {
        await mappings.addMatch(photoId, source, matches);
        matched++;
        console.log(`[${processed}/${allPhotos.length}] ${dt}s - ${photoId} -> ${matches.join(", ")}`);
      } else {
        console.log(`[${processed}/${allPhotos.length}] ${dt}s - ${photoId} (no match)`);
      }
    } catch (e) {
      errors++;
      console.error(`[ERR] ${photoId}:`, e.message);
    }
  }

  const totalMin = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n=== DONE in ${totalMin} min ===`);
  console.log(`Processed: ${processed}`);
  console.log(`Matched: ${matched}`);
  console.log(`Skipped (invalid): ${skipped}`);
  console.log(`Errors: ${errors}`);
})();
