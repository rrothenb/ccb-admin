/**
 * Audit logging service - writes action records to a Google Sheet
 *
 * Configure by calling setAuditLogSpreadsheetId() with the ID of any
 * spreadsheet you want to use. An "Audit Log" tab will be created there.
 * Falls back to Logger.log if not configured.
 */

const AUDIT_LOG_PROPERTY_KEY = 'AUDIT_LOG_SPREADSHEET_ID';

function getAuditLogSheet(): GoogleAppsScript.Spreadsheet.Sheet | null {
  const spreadsheetId =
    PropertiesService.getScriptProperties().getProperty(AUDIT_LOG_PROPERTY_KEY);
  if (!spreadsheetId) {
    return null;
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    let sheet = spreadsheet.getSheetByName('Audit Log');
    if (!sheet) {
      sheet = spreadsheet.insertSheet('Audit Log');
      sheet.appendRow(['Timestamp', 'User', 'Action']);
      sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    }
    return sheet;
  } catch (e) {
    Logger.log(`Could not open audit log spreadsheet: ${e}`);
    return null;
  }
}

function writeAuditLog(user: string, action: string): void {
  Logger.log(`[AUDIT] ${user}: ${action}`);

  const sheet = getAuditLogSheet();
  if (!sheet) return;

  sheet.appendRow([new Date(), user, action]);
}

function setAuditLogSpreadsheetId(): void {
  PropertiesService.getScriptProperties().setProperty(AUDIT_LOG_PROPERTY_KEY, '14uxC2oEdsepGraOAFA2xfJ2QEtn5M3tjgvgVBvYBLWw');
  Logger.log(`Audit log spreadsheet ID set to: 14uxC2oEdsepGraOAFA2xfJ2QEtn5M3tjgvgVBvYBLWw`);
}

function getAuditLogSpreadsheetId(): string {
  return PropertiesService.getScriptProperties().getProperty(AUDIT_LOG_PROPERTY_KEY) || '';
}

export { writeAuditLog, setAuditLogSpreadsheetId, getAuditLogSpreadsheetId };
