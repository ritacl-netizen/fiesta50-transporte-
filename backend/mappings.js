const r2 = require("./r2");

const MAPPINGS_KEY = "data/mappings.json";

// In-memory cache
let cache = null;

async function load() {
  if (cache) return cache;

  try {
    const buf = await r2.getFile(MAPPINGS_KEY);
    cache = JSON.parse(buf.toString());
    return cache;
  } catch (e) {
    cache = {
      photo_to_guests: { whatsapp: {}, pro: {} },
      guest_to_photos: {},
      stats: {},
    };
    return cache;
  }
}

async function save(data) {
  cache = data;
  await r2.uploadFile(MAPPINGS_KEY, Buffer.from(JSON.stringify(data, null, 2)), "application/json");
}

// Add a photo match for a guest
async function addMatch(photoId, source, guestIds) {
  const data = await load();

  if (!data.photo_to_guests[source]) data.photo_to_guests[source] = {};
  data.photo_to_guests[source][photoId] = guestIds;

  for (const guestId of guestIds) {
    if (!data.guest_to_photos[guestId]) data.guest_to_photos[guestId] = {};
    if (!data.guest_to_photos[guestId][source]) data.guest_to_photos[guestId][source] = [];
    if (!data.guest_to_photos[guestId][source].includes(photoId)) {
      data.guest_to_photos[guestId][source].push(photoId);
    }
  }

  await save(data);
  return data;
}

module.exports = { load, save, addMatch };
