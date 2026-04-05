// Google Apps Script - Backend API for Fiesta 50 Transport RSVP
// Deploy as Web App: Execute as "Me", Access "Anyone"

const SPREADSHEET_ID = '1Rmd_HnvhE94kexOc-kfqaNLdkBBYnUi-cPZ16-evXag';
const SHEET_NAME = 'Sheet3';
const COL_DNI_PERSONAL = 12;  // Column L (1-indexed)
const COL_DNI_PAREJA = 15;    // Column O (1-indexed)
const COL_TRANSPORTE = 31;    // Column AE (1-indexed)

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const id = String(data.id).trim();
    const qty = data.qty === 2 ? 2 : 1;

    if (!id) {
      return jsonResponse({ success: false, message: 'Debes ingresar un DNI o CI.' });
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      return jsonResponse({ success: false, message: 'No se encontraron invitados.' });
    }

    const dataRange = sheet.getRange(2, 1, lastRow - 1, COL_TRANSPORTE);
    const values = dataRange.getValues();

    for (let i = 0; i < values.length; i++) {
      const dniPersonal = String(values[i][COL_DNI_PERSONAL - 1]).trim();
      const dniPareja = String(values[i][COL_DNI_PAREJA - 1]).trim();

      if (dniPersonal === id || dniPareja === id) {
        const currentTransport = String(values[i][COL_TRANSPORTE - 1]).trim();

        if (currentTransport !== '') {
          return jsonResponse({
            success: true,
            alreadyRegistered: true,
            message: 'Ya estás registrado/a para el transporte.'
          });
        }

        // Write "SI x1" or "SI x2" in column AE
        sheet.getRange(i + 2, COL_TRANSPORTE).setValue('SI x' + qty);

        return jsonResponse({
          success: true,
          alreadyRegistered: false,
          message: 'Confirmado. ' + qty + (qty === 1 ? ' lugar' : ' lugares') + ' en el transporte.'
        });
      }
    }

    return jsonResponse({
      success: false,
      message: 'DNI/CI no encontrado. Verificá el número e intentá de nuevo.'
    });

  } catch (error) {
    return jsonResponse({ success: false, message: 'Error del servidor. Intentá de nuevo.' });
  }
}

function doGet(e) {
  return jsonResponse({ status: 'ok', message: 'API de Transporte Fiesta 50 activa.' });
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
