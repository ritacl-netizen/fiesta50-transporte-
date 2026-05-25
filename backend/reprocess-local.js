require("dotenv").config();
const sheets = require("./sheets");
const rekognition = require("./rekognition");
const mappings = require("./mappings");
const r2 = require("./r2");
const crypto = require("crypto");

function generateGuestId(name) {
  const normalized = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const hash = crypto.createHash("md5").update(name).digest("hex").slice(0, 6);
  return normalized + "-" + hash;
}

const PHOTO_CONCURRENCY = 8; // photos in parallel
const SAVE_EVERY = 30; // save mappings every N processed photos

(async () => {
  const startTime = Date.now();
  const guests = await sheets.getAllGuests();
  const selfieIds = guests.filter((g) => g.selfieMain && g.guestId).map((g) => g.guestId);
  for (const g of guests) {
    if (g.selfiePartner && g.partnerName) {
      // Use partnerGuestId from sheet if available, otherwise generate
      selfieIds.push(g.partnerGuestId || generateGuestId(g.partnerName));
    }
  }
  console.log(`[INFO] ${selfieIds.length} selfies loaded`);

  const waPhotos = await r2.listFiles("party-whatsapp/");
  const proPhotos = await r2.listFiles("party-pro/");
  const allPhotos = [...waPhotos, ...proPhotos];
  console.log(`[INFO] ${allPhotos.length} photos to process`);

  // Pending matches buffer
  const pendingMatches = []; // { photoId, source, guestIds }
  let processed = 0;
  let matched = 0;
  let errors = 0;

  async function flushPending() {
    if (pendingMatches.length === 0) return;
    const data = await mappings.load();
    for (const m of pendingMatches) {
      if (!data.photo_to_guests[m.source]) data.photo_to_guests[m.source] = {};
      data.photo_to_guests[m.source][m.photoId] = m.guestIds;
      for (const gid of m.guestIds) {
        if (!data.guest_to_photos[gid]) data.guest_to_photos[gid] = {};
        if (!data.guest_to_photos[gid][m.source]) data.guest_to_photos[gid][m.source] = [];
        if (!data.guest_to_photos[gid][m.source].includes(m.photoId)) {
          data.guest_to_photos[gid][m.source].push(m.photoId);
        }
      }
    }
    await mappings.save(data);
    console.log(`  [FLUSH] saved ${pendingMatches.length} matches to R2`);
    pendingMatches.length = 0;
  }

  async function processOne(photo) {
    const source = photo.key.startsWith("party-whatsapp/") ? "whatsapp" : "pro";
    const photoId = photo.key.replace(/^party-(whatsapp|pro)\//, "").replace(/\.jpg$/, "");

    try {
      const buf = await r2.getFile(photo.key);
      if (buf[0] !== 0xFF) return;

      const t0 = Date.now();
      const matches = await rekognition.matchPhoto(buf, selfieIds);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);

      processed++;
      if (matches.length > 0) {
        pendingMatches.push({ photoId, source, guestIds: matches });
        matched++;
        console.log(`[${processed}/${allPhotos.length}] ${dt}s - ${photoId} -> ${matches.join(", ")}`);
      } else {
        if (processed % 20 === 0) {
          console.log(`[${processed}/${allPhotos.length}] ${dt}s - ${photoId} (no match)`);
        }
      }

      // Periodic save
      if (processed % SAVE_EVERY === 0) {
        await flushPending();
      }
    } catch (e) {
      errors++;
      console.error(`[ERR] ${photoId}:`, e.message);
    }
  }

  // Process in concurrent waves
  for (let i = 0; i < allPhotos.length; i += PHOTO_CONCURRENCY) {
    const wave = allPhotos.slice(i, i + PHOTO_CONCURRENCY).map(processOne);
    await Promise.all(wave);
  }

  // Final flush
  await flushPending();

  const totalMin = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n=== DONE in ${totalMin} min ===`);
  console.log(`Processed: ${processed}`);
  console.log(`Matched: ${matched}`);
  console.log(`Errors: ${errors}`);
})();
