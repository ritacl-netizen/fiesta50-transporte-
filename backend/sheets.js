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

// Bot columns (AX onwards - all empty/ours)
const COL_EXTRA = {
  GUEST_ID: 49, // AX - [BOT] Guest unique ID
  SELFIE_MAIN: 50, // AY - [BOT] Selfie recibida (principal)
  SELFIE_PARTNER: 51, // AZ - [BOT] Selfie recibida (pareja)
  PARTNER_PHONE: 52, // BA - [BOT] Teléfono pareja
  ALBUM_SENT_MAIN: 53, // BB - [BOT] Album enviado (principal)
  ALBUM_SENT_PARTNER: 54, // BC - [BOT] Album enviado (pareja)
  PHOTOS_COUNT: 55, // BD - [BOT] Fotos subidas
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
    range: `${SHEET_NAME}!A2:BD`,
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
  // Remove spaces, dashes, parentheses, dots, plus
  let clean = phone.replace(/[\s\-\(\)\.+]/g, "");
  // Uruguay: 0XX -> 598XX
  if (clean.startsWith("0")) {
    clean = "598" + clean.slice(1);
  }
  // Argentina: normalize 549XX to 54XX (WhatsApp sends without the 9)
  if (clean.startsWith("549")) {
    clean = "54" + clean.slice(3);
  }
  return clean;
}

// Compare two phone numbers accounting for Argentine 9 variant
function phonesMatch(a, b) {
  if (!a || !b) return false;
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (na === nb) return true;
  // Also try with/without Argentine 9
  const stripAr9 = (p) => p.startsWith("549") ? "54" + p.slice(3) : p;
  const addAr9 = (p) => p.startsWith("54") && !p.startsWith("549") ? "549" + p.slice(2) : p;
  return stripAr9(na) === stripAr9(nb) || addAr9(na) === addAr9(nb);
}

async function findGuestByPhone(phone) {
  const guests = await getAllGuests();
  return guests.find(
    (g) => phonesMatch(g.mainPhone, phone) || phonesMatch(g.partnerPhone, phone)
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

async function incrementPhotoCount(rowIndex) {
  const col = COL_EXTRA.PHOTOS_COUNT;
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
  phonesMatch,
  COL,
  COL_EXTRA,
};
