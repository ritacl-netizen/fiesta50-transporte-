// Google Apps Script - Authentication API for Fotografias section
// Deploy as Web App: Execute as "Me", Access "Anyone"
//
// Uses same spreadsheet as Transport. Validates CI + last 4 digits of phone.
// Columns (1-indexed):
//   K (11) = Partner name
//   N (14) = Main name
//   O (15) = Main DNI/CI
//   P (16) = Main phone
//   AJ (36) = Guest ID
//   AM (39) = Partner phone

const SPREADSHEET_ID = '1Rmd_HnvhE94kexOc-kfqaNLdkBBYnUi-cPZ16-evXag';
const SHEET_NAME = 'Sheet3';

const COL_PARTNER_NAME = 11;   // K
const COL_MAIN_NAME = 14;      // N
const COL_MAIN_DNI = 15;       // O
const COL_MAIN_PHONE = 16;     // P
const COL_PARTNER_DNI = 12;    // L (DNI pareja, from transport Code.gs)
const COL_GUEST_ID = 36;       // AJ
const COL_PARTNER_PHONE = 39;  // AM

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ci = String(data.ci).trim();
    const phone4 = String(data.phone4).trim();

    if (!ci || !phone4) {
      return jsonResponse({ success: false, message: 'Completa todos los campos.' });
    }

    if (!/^\d+$/.test(ci) || !/^\d{4}$/.test(phone4)) {
      return jsonResponse({ success: false, message: 'CI y celular deben ser solo numeros.' });
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      return jsonResponse({ success: false, message: 'No se encontraron invitados.' });
    }

    const dataRange = sheet.getRange(2, 1, lastRow - 1, COL_PARTNER_PHONE);
    const values = dataRange.getValues();

    for (let i = 0; i < values.length; i++) {
      const mainDni = String(values[i][COL_MAIN_DNI - 1]).trim();
      const partnerDni = String(values[i][COL_PARTNER_DNI - 1]).trim();
      const mainName = String(values[i][COL_MAIN_NAME - 1]).trim();
      const partnerName = String(values[i][COL_PARTNER_NAME - 1]).trim();
      const mainPhone = cleanPhone(String(values[i][COL_MAIN_PHONE - 1]).trim());
      const partnerPhone = cleanPhone(String(values[i][COL_PARTNER_PHONE - 1]).trim());
      const guestId = String(values[i][COL_GUEST_ID - 1]).trim();

      // Check if CI matches main person
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

      // Check if CI matches partner
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
            guestId: generateGuestId(partnerName)
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

  } catch (error) {
    return jsonResponse({ success: false, message: 'Error del servidor. Intenta de nuevo.' });
  }
}

function doGet(e) {
  return jsonResponse({ status: 'ok', message: 'API de Fotografias MYN50 activa.' });
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

  // Simple hash (Apps Script doesn't have crypto)
  var hash = 0;
  for (var c = 0; c < name.length; c++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(c);
    hash = hash & hash; // Convert to 32bit integer
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
