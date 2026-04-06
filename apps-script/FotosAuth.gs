// Google Apps Script - Authentication API for Fotografias section
// Deploy as Web App: Execute as "Me", Access "Anyone"
//
// Supports both GET (with query params) and POST (with JSON body)
// GET: ?ci=12345678&phone4=1234
// POST: {"ci":"12345678","phone4":"1234"}

const SPREADSHEET_ID = '1Rmd_HnvhE94kexOc-kfqaNLdkBBYnUi-cPZ16-evXag';
const SHEET_NAME = 'Sheet3';

const COL_PARTNER_NAME = 11;   // K
const COL_MAIN_NAME = 14;      // N
const COL_MAIN_DNI = 15;       // O
const COL_MAIN_PHONE = 16;     // P
const COL_PARTNER_DNI = 12;    // L
const COL_GUEST_ID = 50;       // AX - [BOT] Guest ID
const COL_PARTNER_PHONE = 53;  // BA - [BOT] Tel Pareja
const COL_PARTNER_GUEST_ID = 57; // BE - [BOT] Partner Guest ID

function doGet(e) {
  var ci = (e && e.parameter && e.parameter.ci) || '';
  var phone4 = (e && e.parameter && e.parameter.phone4) || '';

  if (!ci || !phone4) {
    return jsonResponse({ status: 'ok', message: 'API de Fotografias MYN50 activa.' });
  }

  return doAuth(ci.trim(), phone4.trim());
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    return doAuth(String(data.ci).trim(), String(data.phone4).trim());
  } catch (error) {
    return jsonResponse({ success: false, message: 'Error del servidor. Intenta de nuevo.' });
  }
}

function doAuth(ci, phone4) {
  if (!ci || !phone4) {
    return jsonResponse({ success: false, message: 'Completa todos los campos.' });
  }

  if (!/^\d+$/.test(ci) || !/^\d{4}$/.test(phone4)) {
    return jsonResponse({ success: false, message: 'CI y celular deben ser solo numeros.' });
  }

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return jsonResponse({ success: false, message: 'No se encontraron invitados.' });
  }

  var dataRange = sheet.getRange(2, 1, lastRow - 1, 57); // Read up to column BE
  var values = dataRange.getValues();

  for (var i = 0; i < values.length; i++) {
    var mainDni = String(values[i][COL_MAIN_DNI - 1]).trim();
    var partnerDni = String(values[i][COL_PARTNER_DNI - 1]).trim();
    var mainName = String(values[i][COL_MAIN_NAME - 1]).trim();
    var partnerName = String(values[i][COL_PARTNER_NAME - 1]).trim();
    var mainPhone = cleanPhone(String(values[i][COL_MAIN_PHONE - 1]).trim());
    var partnerPhone = cleanPhone(String(values[i][COL_PARTNER_PHONE - 1]).trim());
    var guestId = String(values[i][COL_GUEST_ID - 1]).trim();
    var partnerGuestId = String(values[i][COL_PARTNER_GUEST_ID - 1]).trim();

    if (mainDni === ci) {
      if (!mainPhone) {
        return jsonResponse({
          success: false,
          message: 'No tenemos tu numero registrado. Pedile a tu acompanante que nos lo pase por WhatsApp.'
        });
      }
      if (mainPhone.slice(-4) === phone4) {
        return jsonResponse({
          success: true,
          name: mainName,
          guestId: guestId || generateGuestId(mainName)
        });
      } else {
        return jsonResponse({
          success: false,
          message: 'Los ultimos 4 digitos no coinciden con el celular registrado.'
        });
      }
    }

    if (partnerDni === ci) {
      if (!partnerPhone) {
        return jsonResponse({
          success: false,
          message: 'No tenemos tu numero registrado. Pedile a ' + mainName + ' que nos lo pase por WhatsApp.'
        });
      }
      if (partnerPhone.slice(-4) === phone4) {
        return jsonResponse({
          success: true,
          name: partnerName,
          guestId: partnerGuestId || generateGuestId(partnerName)
        });
      } else {
        return jsonResponse({
          success: false,
          message: 'Los ultimos 4 digitos no coinciden con el celular registrado.'
        });
      }
    }
  }

  return jsonResponse({
    success: false,
    message: 'CI no encontrada. Verifica el numero e intenta de nuevo.'
  });
}

function cleanPhone(phone) {
  if (!phone) return '';
  return phone.replace(/[\s\-\(\)\.+]/g, '');
}

function generateGuestId(name) {
  var normalized = name
    .toLowerCase()
    .replace(/[áàäâ]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  var hash = 0;
  for (var c = 0; c < name.length; c++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(c);
    hash = hash & hash;
  }
  var hexHash = Math.abs(hash).toString(16).slice(0, 6);
  while (hexHash.length < 6) hexHash = '0' + hexHash;

  return normalized + '-' + hexHash;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
