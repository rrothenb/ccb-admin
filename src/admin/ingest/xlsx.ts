/**
 * Shared xlsx-ingestion helpers for the admin sync (GAS side).
 *
 * The admin uploads .xlsx files (Master Membership + Register). GAS can't read
 * raw xlsx, so we convert each to a temporary Google Sheet via the Drive
 * advanced service (validated in the ingest spike), read its cells as a string
 * grid, then trash the temp Sheet so nothing accumulates in Drive.
 *
 * The pure parsers (master.ts / register.ts) operate on the returned string
 * grids, so they're unit-testable without GAS; only this file touches Drive.
 */

// Drive advanced service global, provided by GAS at runtime once enabled.
declare const Drive: any;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

/** Converts an uploaded xlsx blob to a Google Sheet, returning its file id. Hedges Drive v3/v2. */
export function convertXlsxToSheet(blob: GoogleAppsScript.Base.Blob, name: string): string {
  if (Drive.Files.create) {
    return Drive.Files.create({ name, mimeType: GSHEET_MIME }, blob).id; // v3
  }
  return Drive.Files.insert({ title: name, mimeType: GSHEET_MIME }, blob).id; // v2
}

/** Trashes the temp converted Sheet. Falls back to DriveApp if the advanced call fails. */
export function trashSheet(fileId: string): void {
  try {
    Drive.Files.remove(fileId);
  } catch (e) {
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
    } catch (e2) {
      Logger.log(`cleanup failed: ${e2}`);
    }
  }
}

/** Decodes a base64 xlsx upload to a Google Sheet id (caller must trashSheet when done). */
export function uploadedXlsxToSheetId(base64: string, filename: string, tag: string): string {
  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, XLSX_MIME, filename || 'upload.xlsx');
  return convertXlsxToSheet(blob, `[${tag}] ${filename || 'upload'}`);
}

/** Formats a cell value to a stable string: Dates → ISO yyyy-MM-dd, everything else String()'d. */
export function cellToString(v: unknown): string {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return v == null ? '' : String(v).trim();
}

/** Reads a Sheet's used range as a string grid (Dates → ISO), for the pure parsers. */
export function sheetToStringGrid(sheet: GoogleAppsScript.Spreadsheet.Sheet): string[][] {
  return sheet.getDataRange().getValues().map((row) => row.map(cellToString));
}
