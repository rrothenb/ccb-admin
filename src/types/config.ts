/**
 * Configuration types for the library management system
 */

import { SheetName } from './entities';

/** Configuration for master spreadsheet connections */
export interface MasterSpreadsheetConfig {
  borrowersId: string;
  mediaId: string;
  loansId: string;
  lastDiscoveryDate: string; // ISO date string
}

/** Property keys used in PropertiesService */
export const PROPERTY_KEYS = {
  BORROWERS_SPREADSHEET_ID: 'BORROWERS_SPREADSHEET_ID',
  MEDIA_SPREADSHEET_ID: 'MEDIA_SPREADSHEET_ID',
  LOANS_SPREADSHEET_ID: 'LOANS_SPREADSHEET_ID',
  LAST_DISCOVERY_DATE: 'LAST_DISCOVERY_DATE',
} as const;

/** Result of spreadsheet discovery */
export interface DiscoveryResult {
  sheetName: SheetName;
  spreadsheetId: string;
  spreadsheetName: string;
  lastModified: Date;
}

/** Result of an operation */
export interface OperationResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}
