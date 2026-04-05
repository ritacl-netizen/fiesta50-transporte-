const { google } = require("googleapis");

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || "Sheet3";

// Column indices (0-based) from the spreadsheet
const COL = {
  PARTNER_NAME: 10, // K - nombre pareja
  MAIN_NAME: 13, // N - nombre principal
  MAIN_DNI: 14, // O - DNI principal
  MAIN_PHONE: 15, // P - teléfono principal
};

// New columns we'll add (adjust these based on actual sheet)
const COL_EXTRA = {
  GUEST_ID: 35, // AJ - Guest unique ID
  SELFIE_MAIN: 36, // AK - Selfie recibida (principal)
  SELFIE_PARTNER: 37, // AL - Selfie recibida (pareja)
  PARTNER_PHONE: 38, // AM - Teléfono pareja
  ALBUM_SENT_MAIN: 39, // AN - Album enviado (principal)
  ALBUM_SENT_PARTNER: 40, // AO - Album enviado (pareja)
  PHOTOS_COUNT_MAIN: 41, // AP - Cantidad fotos subidas (principal)
  PHOTOS_COUNT_PARTNER: 42, // AQ - Cantidad fotos subidas (pareja)
};

let sheetsApi = null;

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheets() {
  if (!sheetsApi) {
    const auth = getAuth();
    sheetsApi = google.sheets({ version: "v4", auth });
  }
  return sheetsApi;
}

function colLetter(index) {
  if (index < 26) return String.fromCharCode(65 + index);
  return (
    String.fromCharCode(64 + Math.floor(index / 26)) +
    String.fromCharCode(65 + (index % 26))
  );
}

async function getAllGuests() {
  const sheets = await getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:AO`,
  });

  const rows = response.data.values || [];
  const guests = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const mainName = (row[COL.MAIN_NAME] || "").trim();
    const partnerName = (row[COL.PARTNER_NAME] || "").trim();
    const mainPhone = (row[COL.MAIN_PHONE] || "").trim();
    const guestId = (row[COL_EXTRA.GUEST_ID] || "").trim();
    const selfieMain = (row[COL_EXTRA.SELFIE_MAIN] || "").trim();
    const selfiePartner = (row[COL_EXTRA.SELFIE_PARTNER] || "").trim();
    const partnerPhone = (row[COL_EXTRA.PARTNER_PHONE] || "").trim();

    if (!mainName) continue;

    guests.push({
      rowIndex: i + 2, // 1-based, skip header
      mainName,
      partnerName,
      mainPhone: normalizePhone(mainPhone),
      partnerPhone: normalizePhone(partnerPhone),
      guestId,
      selfieMain: selfieMain === "SI",
      selfiePartner: selfiePartner === "SI",
    });
  }

  return guests;
}

function normalizePhone(phone) {
  if (!phone) return "";
  // Remove spaces, dashes, parentheses
  let clean = phone.replace(/[\s\-\(\)\.]/g, "");
  // Ensure it starts with country code
  if (clean.startsWith("0")) {
    clean = "598" + clean.slice(1); // Uruguay default
  }
  if (!clean.startsWith("+")) {
    // If no +, assume it already has country code
  } else {
    clean = clean.slice(1); // remove +
  }
  return clean;
}

async function findGuestByPhone(phone) {
  const guests = await getAllGuests();
  const normalized = normalizePhone(phone);
  return guests.find(
    (g) => g.mainPhone === normalized || g.partnerPhone === normalized
  );
}

async function updateCell(rowIndex, colIndex, value) {
  const sheets = await getSheets();
  const cell = `${SHEET_NAME}!${colLetter(colIndex)}${rowIndex}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: cell,
    valueInputOption: "RAW",
    requestBody: { values: [[value]] },
  });
}

async function markSelfieReceived(rowIndex, isPartner) {
  const col = isPartner ? COL_EXTRA.SELFIE_PARTNER : COL_EXTRA.SELFIE_MAIN;
  await updateCell(rowIndex, col, "SI");
}

async function setGuestId(rowIndex, guestId) {
  await updateCell(rowIndex, COL_EXTRA.GUEST_ID, guestId);
}

async function setPartnerPhone(rowIndex, phone) {
  await updateCell(rowIndex, COL_EXTRA.PARTNER_PHONE, normalizePhone(phone));
}

async function markAlbumSent(rowIndex, isPartner) {
  const col = isPartner
    ? COL_EXTRA.ALBUM_SENT_PARTNER
    : COL_EXTRA.ALBUM_SENT_MAIN;
  await updateCell(rowIndex, col, "SI");
}

async function incrementPhotoCount(rowIndex, isPartner) {
  const col = isPartner ? COL_EXTRA.PHOTOS_COUNT_PARTNER : COL_EXTRA.PHOTOS_COUNT_MAIN;
  const sheets = await getSheets();
  const cell = `${SHEET_NAME}!${colLetter(col)}${rowIndex}`;
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: cell,
  });
  const count = parseInt((current.data.values?.[0]?.[0]) || "0", 10);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: cell,
    valueInputOption: "RAW",
    requestBody: { values: [[count + 1]] },
  });
  return count + 1;
}

module.exports = {
  getAllGuests,
  findGuestByPhone,
  markSelfieReceived,
  setGuestId,
  setPartnerPhone,
  markAlbumSent,
  incrementPhotoCount,
  updateCell,
  normalizePhone,
  COL,
  COL_EXTRA,
};
