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
  const mediaId = props.getProperty(PROPERTY_KEYS.MEDIA_SPREADSHEET_ID);
  const loansId = props.getProperty(PROPERTY_KEYS.LOANS_SPREADSHEET_ID);
  const lastDiscoveryDate = props.getProperty(PROPERTY_KEYS.LAST_DISCOVERY_DATE);

  if (!borrowersId && !mediaId && !loansId) {
    return null;
  }

  return {
    borrowersId: borrowersId || '',
    mediaId: mediaId || '',
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
  getMasterSpreadsheetId,
  getMasterConfig,
  openMasterSpreadsheet,
  clearMasterConfig,
  getPropertyKeyForSheet,
};
