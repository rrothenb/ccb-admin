/**
 * Spreadsheet ingestion spike (admin-only).
 *
 * Purpose: retire the last technical unknown — reading an uploaded .xlsx INSIDE
 * GAS. Validates the full path: browser upload -> base64 -> Drive converts the
 * xlsx to a Google Sheet -> we locate the current-year Master tab, tolerate the
 * year-to-year header drift, map columns, and extract the roster with a computed
 * expiry (DATE ENROLED + 1 year). Success = it reproduces the ~79 members the
 * local Python probe found.
 *
 * The temp converted Sheet is trashed after reading, so nothing accumulates in
 * Drive. Requires the Drive advanced service (added to appsscript.admin.json).
 */

// Drive advanced service global, provided by GAS at runtime once enabled.
declare const Drive: any;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

export interface IngestReport {
  success: boolean;
  error?: string;
  tabsFound?: string[];
  chosenTab?: string;
  headerRow?: number;               // 1-based
  detectedHeaders?: string[];
  columnMap?: Record<string, number>;
  memberCount?: number;
  withExpiry?: number;
  sample?: { name: string; enrolled: string; classNo: string; status: string; expiry: string }[];
  anomalies?: string[];
}

/** Converts an uploaded xlsx blob to a Google Sheet, returning its file id. Hedges v3/v2. */
function convertXlsxToSheet(blob: GoogleAppsScript.Base.Blob, name: string): string {
  if (Drive.Files.create) {
    return Drive.Files.create({ name, mimeType: GSHEET_MIME }, blob).id; // v3
  }
  return Drive.Files.insert({ title: name, mimeType: GSHEET_MIME }, blob).id; // v2
}

function trashSheet(fileId: string): void {
  try {
    Drive.Files.remove(fileId);
  } catch (e) {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e2) { Logger.log(`cleanup failed: ${e2}`); }
  }
}

function fmtDate(v: unknown): string {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return v ? String(v) : '';
}

/**
 * Expiry = enrol date + 1 year (per the agreed rule). '' if enrol isn't a usable
 * date. A time-only cell (e.g. "00:00:00") converts to the 1899-12-30 spreadsheet
 * epoch, so reject anything before 2000 as "no usable enrol date".
 */
function computeExpiry(enrol: unknown): string {
  if (enrol instanceof Date && enrol.getFullYear() >= 2000) {
    const d = new Date(enrol.getTime());
    d.setFullYear(d.getFullYear() + 1);
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return '';
}

/** Reads the current-year Master tab from a converted Sheet and extracts the roster. */
function analyzeMasterSheet(ssId: string): IngestReport {
  const ss = SpreadsheetApp.openById(ssId);
  const tabs = ss.getSheets().map((s) => s.getName());

  // Prefer the current-year Master tab, then any "Master File" tab, then first.
  const chosen =
    tabs.find((n) => /master file.*2[67]\s*[-/]?\s*2[67]/i.test(n)) ||
    tabs.find((n) => /master file/i.test(n)) ||
    tabs[0];
  const sheet = ss.getSheetByName(chosen);
  if (!sheet) return { success: false, error: `No readable tab (tabs: ${tabs.join(', ')})` };

  const values = sheet.getDataRange().getValues();

  // Header row can be row 1 or 2 (year drift) — find the first of the top 4 rows with "name".
  let headerRow = -1;
  for (let r = 0; r < Math.min(4, values.length); r++) {
    if (values[r].some((c) => /name/i.test(String(c)))) { headerRow = r; break; }
  }
  if (headerRow < 0) return { success: false, error: 'Could not locate a header row containing "NAME".', tabsFound: tabs, chosenTab: chosen };

  const headers = values[headerRow].map((c) => String(c).toLowerCase().replace(/\s+/g, ' ').trim());
  const findCol = (...keys: string[]) => {
    for (let i = 0; i < headers.length; i++) if (keys.some((k) => headers[i].includes(k))) return i;
    return -1;
  };
  // Tolerant to "DATE ENROLED" vs "DATE OF ENROLLING", "MEMBERSHIP EXPIRY" vs "DATE EXPIRY", etc.
  const columnMap = {
    name: findCol('name'),
    enrolled: findCol('enrol'),
    classNo: findCol('class'),
    status: findCol('status'),
  };
  if (columnMap.name < 0) return { success: false, error: 'No NAME column found.', tabsFound: tabs, chosenTab: chosen, detectedHeaders: headers };

  const members: IngestReport['sample'] = [];
  const anomalies: string[] = [];
  let withExpiry = 0;
  for (let r = headerRow + 1; r < values.length; r++) {
    const nm = String(values[r][columnMap.name] ?? '').trim();
    if (!nm) continue;
    if (!/[a-z]/i.test(nm) || /master|membership|excel/i.test(nm)) continue; // skip section markers
    const enrolRaw = columnMap.enrolled >= 0 ? values[r][columnMap.enrolled] : '';
    const expiry = computeExpiry(enrolRaw);
    if (expiry) withExpiry++;
    else anomalies.push(`row ${r + 1}: "${nm}" has no usable enrol date (expiry can't be computed)`);
    members.push({
      name: nm,
      enrolled: fmtDate(enrolRaw),
      classNo: columnMap.classNo >= 0 ? String(values[r][columnMap.classNo] ?? '').trim() : '',
      status: columnMap.status >= 0 ? String(values[r][columnMap.status] ?? '').trim() : '',
      expiry,
    });
  }

  return {
    success: true,
    tabsFound: tabs,
    chosenTab: chosen,
    headerRow: headerRow + 1,
    detectedHeaders: headers.filter(Boolean),
    columnMap,
    memberCount: members.length,
    withExpiry,
    sample: members.slice(0, 8),
    anomalies: anomalies.slice(0, 10),
  };
}

/**
 * Web-app entry point: takes a base64-encoded uploaded .xlsx, converts it, reads
 * the roster, and returns a report. Trashes the temp Sheet afterward.
 */
function ingestSpike_analyzeMaster(base64: string, filename: string): IngestReport {
  let ssId = '';
  try {
    const bytes = Utilities.base64Decode(base64);
    const blob = Utilities.newBlob(bytes, XLSX_MIME, filename || 'upload.xlsx');
    ssId = convertXlsxToSheet(blob, `[ingest-spike] ${filename || 'master'}`);
    return analyzeMasterSheet(ssId);
  } catch (e) {
    return { success: false, error: String(e) };
  } finally {
    if (ssId) trashSheet(ssId);
  }
}

export { ingestSpike_analyzeMaster };
