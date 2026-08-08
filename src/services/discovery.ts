/**
 * Auto-discovery service for finding master spreadsheets by name
 *
 * Searches the user's Google Drive for spreadsheets matching the naming convention
 * (e.g., "Borrowers", "Borrowers-v2", "Media", "Loans") and returns the most recently
 * modified one for each entity type.
 */

import {
  SheetName,
  SHEET_TO_MASTER_PREFIX,
  DiscoveryResult,
  PROPERTY_KEYS,
  MasterSpreadsheetConfig,
  OperationResult,
} from '../types';

/**
 * Searches Drive for spreadsheets starting with the given prefix
 * Returns the most recently modified match
 */
function findNewestSpreadsheetByPrefix(prefix: string): DiscoveryResult | null {
  const query = `title contains '${prefix}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;

  const files = DriveApp.searchFiles(query);
  let newestFile: GoogleAppsScript.Drive.File | null = null;
  let newestDate: Date | null = null;

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();

    // Ensure the file name starts with the prefix (not just contains it)
    if (!fileName.startsWith(prefix)) {
      continue;
    }

    const lastUpdated = new Date(file.getLastUpdated().getTime());

    if (!newestDate || lastUpdated > newestDate) {
      newestDate = lastUpdated;
      newestFile = file;
    }
  }

  if (!newestFile || !newestDate) {
    return null;
  }

  return {
    sheetName: prefix as SheetName,
    spreadsheetId: newestFile.getId(),
    spreadsheetName: newestFile.getName(),
    lastModified: newestDate,
  };
}

/**
 * Discovers all master spreadsheets and stores their IDs in script properties
 */
function discoverAllMasterSpreadsheets(): OperationResult<DiscoveryResult[]> {
  const results: DiscoveryResult[] = [];
  const errors: string[] = [];

  const sheetNames: SheetName[] = ['Borrowers', 'Media', 'Loans'];

  for (const sheetName of sheetNames) {
    const prefix = SHEET_TO_MASTER_PREFIX[sheetName];
    const result = findNewestSpreadsheetByPrefix(prefix);

    if (result) {
      results.push(result);
      Logger.log(`Found ${sheetName}: "${result.spreadsheetName}" (${result.spreadsheetId})`);
    } else {
      errors.push(`Could not find spreadsheet starting with "${prefix}"`);
      Logger.log(`Warning: Could not find spreadsheet starting with "${prefix}"`);
    }
  }

  if (results.length === 0) {
    return {
      success: false,
      error: `No master spreadsheets found. Please create spreadsheets named "Borrowers", "Media", and "Loans" in your Drive. Errors: ${errors.join('; ')}`,
    };
  }

  // Store discovered IDs in script properties
  const props = PropertiesService.getScriptProperties();

  for (const result of results) {
    const propKey = getPropertyKeyForSheet(result.sheetName);
    if (propKey) {
      props.setProperty(propKey, result.spreadsheetId);
    }
  }

  props.setProperty(PROPERTY_KEYS.LAST_DISCOVERY_DATE, new Date().toISOString());

  if (errors.length > 0) {
    return {
      success: true,
      data: results,
      error: `Partial discovery. Missing: ${errors.join('; ')}`,
    };
  }

  return {
    success: true,
    data: results,
  };
}

/**
 * Sets the master spreadsheet IDs by hand, without searching Drive.
 *
 * This is the setup path for the MAIN app, because its manifest deliberately
 * carries no Drive scope — that's what keeps volunteers' consent screen down to
 * Sheets — and `discoverAllMasterSpreadsheets()` therefore cannot run there
 * (DriveApp.searchFiles would throw). Spelling the three IDs out also removes
 * discovery's one sharp edge: it takes the NEWEST name match, so an old copy of
 * "Borrowers" sitting in the account's Drive can silently win.
 *
 * Accepts either a bare spreadsheet ID or a full Google Sheets URL, so the
 * operator can paste straight from the address bar. Blank entries are left
 * untouched rather than cleared, so one sheet can be repointed on its own.
 */
function setMasterSpreadsheetIds(ids: { borrowers?: string; media?: string; loans?: string }): OperationResult<string[]> {
  const props = PropertiesService.getScriptProperties();
  const set: string[] = [];
  const pairs: [SheetName, string | undefined][] = [
    ['Borrowers', ids.borrowers],
    ['Media', ids.media],
    ['Loans', ids.loans],
  ];

  for (const [sheetName, raw] of pairs) {
    const id = extractSpreadsheetId(raw || '');
    if (!id) continue;
    const propKey = getPropertyKeyForSheet(sheetName);
    if (propKey) {
      props.setProperty(propKey, id);
      set.push(`${sheetName}: ${id}`);
    }
  }

  if (set.length === 0) {
    return { success: false, error: 'No spreadsheet IDs given — nothing was changed.' };
  }

  props.setProperty(PROPERTY_KEYS.LAST_DISCOVERY_DATE, new Date().toISOString());
  return { success: true, data: set };
}

/** Pulls the id out of a Sheets URL, or returns a bare id unchanged. */
function extractSpreadsheetId(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  const m = s.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : s;
}

/**
 * Gets the property key for a given sheet name
 */
function getPropertyKeyForSheet(sheetName: SheetName): string | null {
  switch (sheetName) {
    case 'Borrowers':
      return PROPERTY_KEYS.BORROWERS_SPREADSHEET_ID;
    case 'Media':
      return PROPERTY_KEYS.MEDIA_SPREADSHEET_ID;
    case 'Loans':
      return PROPERTY_KEYS.LOANS_SPREADSHEET_ID;
    default:
      return null;
  }
}

/**
 * Gets the stored master spreadsheet ID for a given sheet type
 */
function getMasterSpreadsheetId(sheetName: SheetName): string | null {
  const propKey = getPropertyKeyForSheet(sheetName);
  if (!propKey) {
    return null;
  }

  return PropertiesService.getScriptProperties().getProperty(propKey);
}

/**
 * Gets all stored master spreadsheet configuration
 */
function getMasterConfig(): MasterSpreadsheetConfig | null {
  const props = PropertiesService.getScriptProperties();

  const borrowersId = props.getProperty(PROPERTY_KEYS.BORROWERS_SPREADSHEET_ID);
  const barcode = props.getProperty(PROPERTY_KEYS.MEDIA_SPREADSHEET_ID);
  const loansId = props.getProperty(PROPERTY_KEYS.LOANS_SPREADSHEET_ID);
  const lastDiscoveryDate = props.getProperty(PROPERTY_KEYS.LAST_DISCOVERY_DATE);

  if (!borrowersId && !barcode && !loansId) {
    return null;
  }

  return {
    borrowersId: borrowersId || '',
    barcode: barcode || '',
    loansId: loansId || '',
    lastDiscoveryDate: lastDiscoveryDate || '',
  };
}

/**
 * Opens a master spreadsheet by sheet type
 */
function openMasterSpreadsheet(sheetName: SheetName): GoogleAppsScript.Spreadsheet.Spreadsheet | null {
  const spreadsheetId = getMasterSpreadsheetId(sheetName);

  if (!spreadsheetId) {
    Logger.log(`No spreadsheet ID configured for ${sheetName}. Run discovery first.`);
    return null;
  }

  try {
    return SpreadsheetApp.openById(spreadsheetId);
  } catch (e) {
    const msg = String(e).toLowerCase();
    if (msg.includes('permission') || msg.includes('not found')) {
      const email = Session.getActiveUser().getEmail();
      throw new Error(
        `Access denied to the ${sheetName} spreadsheet. ` +
        `Please ask your administrator to share it with: ${email}`
      );
    }
    Logger.log(`Error opening spreadsheet for ${sheetName}: ${e}`);
    return null;
  }
}

/**
 * Clears all stored configuration (useful for re-discovery)
 */
function clearMasterConfig(): void {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROPERTY_KEYS.BORROWERS_SPREADSHEET_ID);
  props.deleteProperty(PROPERTY_KEYS.MEDIA_SPREADSHEET_ID);
  props.deleteProperty(PROPERTY_KEYS.LOANS_SPREADSHEET_ID);
  props.deleteProperty(PROPERTY_KEYS.LAST_DISCOVERY_DATE);
}

// Export for use in other modules
export {
  findNewestSpreadsheetByPrefix,
  discoverAllMasterSpreadsheets,
  setMasterSpreadsheetIds,
  getMasterSpreadsheetId,
  getMasterConfig,
  openMasterSpreadsheet,
  clearMasterConfig,
  getPropertyKeyForSheet,
};
