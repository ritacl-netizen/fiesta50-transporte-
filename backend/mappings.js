const fs = require("fs");
const path = require("path");

const MAPPINGS_PATH = path.join(__dirname, "..", "data", "mappings.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(MAPPINGS_PATH, "utf8"));
  } catch (e) {
    return {
      photo_to_guests: { whatsapp: {}, pro: {} },
      guest_to_photos: {},
      stats: {},
    };
  }
}

function save(data) {
  fs.writeFileSync(MAPPINGS_PATH, JSON.stringify(data, null, 2));
}

// Add a photo match for a guest
function addMatch(photoId, source, guestIds) {
  const data = load();

  // Ensure structure
  if (!data.photo_to_guests[source]) data.photo_to_guests[source] = {};
  data.photo_to_guests[source][photoId] = guestIds;

  // Update reverse mapping
  for (const guestId of guestIds) {
    if (!data.guest_to_photos[guestId]) data.guest_to_photos[guestId] = {};
    if (!data.guest_to_photos[guestId][source]) data.guest_to_photos[guestId][source] = [];
    if (!data.guest_to_photos[guestId][source].includes(photoId)) {
      data.guest_to_photos[guestId][source].push(photoId);
    }
  }

  save(data);
  return data;
}

// Get all guest IDs that have selfies (for matching)
function getAllGuestIds() {
  const data = load();
  return Object.keys(data.guest_to_photos);
}

module.exports = { load, save, addMatch, getAllGuestIds };
