/**
 * Google Apps Script entry points for Web App
 *
 * This file exposes all functions that need to be accessible from
 * the Google Apps Script runtime and client-side JavaScript.
 *
 * Note: In GAS, all functions must be in the global scope.
 */

import {
  discoverAllMasterSpreadsheets,
  getMasterConfig,
  clearMasterConfig,
} from './services/discovery';

import { doGet, getAppContext, include } from './ui/webapp';

import { getBorrowerService } from './services/borrowers';
import { getMediaService } from './services/media';
import { getLoanService } from './services/loans';
import { writeAuditLog, setAuditLogSpreadsheetId, getAuditLogSpreadsheetId } from './services/audit-log';

// ============================================================================
// WEB APP ENTRY POINT
// ============================================================================

// doGet is imported from webapp.ts and exposed globally below

// ============================================================================
// SETUP FUNCTIONS (run from Apps Script editor)
// ============================================================================

/**
 * Runs the master spreadsheet discovery process
 * Run this from the Apps Script editor after initial deployment
 */
function runDiscovery(): void {
  const result = discoverAllMasterSpreadsheets();

  if (result.success && result.data) {
    const found = result.data.map((r) => `- ${r.sheetName}: "${r.spreadsheetName}"`).join('\n');
    Logger.log(`Discovery complete!\n\nFound:\n${found}`);
    if (result.error) {
      Logger.log(`Warnings:\n${result.error}`);
    }
  } else {
    Logger.log(`Discovery Failed: ${result.error || 'Unknown error'}`);
  }
}

/**
 * Shows the current configuration in logs
 */
function showConfig(): void {
  const config = getMasterConfig();

  if (!config) {
    Logger.log('No Configuration - No master spreadsheets configured. Run runDiscovery() first.');
    return;
  }

  Logger.log(`Current Configuration:
Borrowers ID: ${config.borrowersId || '(not set)'}
Media ID: ${config.barcode || '(not set)'}
Loans ID: ${config.loansId || '(not set)'}
Last Discovery: ${config.lastDiscoveryDate || '(never)'}`);
}

/**
 * Clears the current configuration
 */
function clearConfig(): void {
  clearMasterConfig();
  Logger.log('Configuration cleared.');
}

// ============================================================================
// MAINTENANCE FUNCTIONS
// ============================================================================

/**
 * Initializes headers on all master sheets
 */
function initializeAllHeaders(): void {
  const borrowerResult = getBorrowerService().ensureHeaders();
  const mediaResult = getMediaService().ensureHeaders();
  const loanResult = getLoanService().ensureHeaders();

  Logger.log(`Header Initialization:
Borrowers: ${borrowerResult.success ? 'OK' : borrowerResult.error}
Media: ${mediaResult.success ? 'OK' : mediaResult.error}
Loans: ${loanResult.success ? 'OK' : loanResult.error}`);
}

// ============================================================================
// BORROWER FUNCTIONS (called from client-side JS)
// ============================================================================

/**
 * Gets all borrowers
 */
function getAllBorrowers(): unknown[] {
  const service = getBorrowerService();
  const result = service.getAll();
  return result.success && result.data ? result.data.sort((a, b) => a.name.localeCompare(b.name)) : [];
}

/**
 * Gets active borrowers only
 */
function getActiveBorrowers(): unknown[] {
  const service = getBorrowerService();
  const result = service.getActiveBorrowers();
  return result.success && result.data ? result.data.sort((a, b) => a.name.localeCompare(b.name)) : [];
}

/**
 * Searches borrowers
 */
function searchBorrowers(query: string): unknown[] {
  const service = getBorrowerService();
  const result = service.searchBorrowers(query);
  return result.success && result.data ? result.data : [];
}

/**
 * Saves a borrower (create or update)
 */
function saveBorrower(borrowerData: {
  id?: string;
  name: string;
  email: string;
  phone: string;
  gender: string;
  address: string;
  postcode: string;
  borrowerType: string;
  expiryDate: string;
  memberSince: string;
}): { success: boolean; error?: string } {
  const user = Session.getActiveUser().getEmail();

  const service = getBorrowerService();

  const fields = {
    name: borrowerData.name,
    email: borrowerData.email,
    phone: borrowerData.phone,
    gender: borrowerData.gender,
    address: borrowerData.address,
    postcode: borrowerData.postcode,
    borrowerType: borrowerData.borrowerType,
    expiryDate: borrowerData.expiryDate,
    memberSince: borrowerData.memberSince,
  };

  if (borrowerData.id) {
    writeAuditLog(user, `updated borrower: ${borrowerData.name} (ID: ${borrowerData.id})`);
    const result = service.update(borrowerData.id, fields);
    return { success: result.success, error: result.error };
  } else {
    writeAuditLog(user, `created borrower: ${borrowerData.name}`);
    const result = service.createBorrower(
      borrowerData.name,
      borrowerData.email,
      borrowerData.phone,
      borrowerData.gender,
      borrowerData.address,
      borrowerData.postcode,
      borrowerData.borrowerType,
      borrowerData.expiryDate,
      borrowerData.memberSince
    );
    return { success: result.success, error: result.error };
  }
}

// ============================================================================
// MEDIA FUNCTIONS (called from client-side JS)
// ============================================================================

/**
 * Gets all media
 */
function getAllMedia(): string {
  const user = Session.getActiveUser().getEmail();
  Logger.log(`[AUDIT] ${user} retrieved all media`);

  const mediaService = getMediaService();
  const result = mediaService.getAll();
  const data = result.success && result.data ? result.data : [];

  const results: (Partial<typeof data[number]> & { status?: string })[] = data.map(item => {
    const clean: Partial<typeof data[number]> = {};
    for (const [key, value] of Object.entries(item)) {
      if (value !== '' && value !== null && value !== undefined) {
        clean[key as keyof typeof item] = value;
      }
    }
    return clean;
  }).filter(item => item.barcodes);
  const loanService = getLoanService();
  const loanResult = loanService.getAll();
  const loans = loanResult.success && loanResult.data ? loanResult.data : [];
  const loanedBarcodes = loans.map(loan => loan.barcode);
  console.log(loanedBarcodes.slice(0,5))
  console.log(results.slice(0,5))
  for (const resource of results) {
    console.log(resource)
    console.log(resource.barcodes)
    console.log(resource.barcodes?.split('|'))
    resource.status = resource.barcodes?.split('|').some(barcode => !loanedBarcodes.includes(barcode)) ? 'available' : 'on-loan';
  }
  console.log(results.slice(0,5))
  const json = JSON.stringify(results);
  const blob = Utilities.newBlob(json, 'application/json');
  const gzipped = Utilities.gzip(blob);
  return Utilities.base64Encode(gzipped.getBytes());
}
/**
 * Gets available media (not on loan)
 */
function getAvailableMedia(): unknown[] {
  const user = Session.getActiveUser().getEmail();
  Logger.log(`[AUDIT] ${user} retrieved available media`);

  const service = getMediaService();
  const result = service.getAvailableMedia();
  return result.success && result.data ? result.data : [];
}

/**
 * Searches media
 */
function searchMedia(query: string): unknown[] {
  const user = Session.getActiveUser().getEmail();
  Logger.log(`[AUDIT] ${user} searched media: "${query}"`);

  const service = getMediaService();
  const result = service.searchMedia(query);
  return result.success && result.data ? result.data : [];
}

/**
 * Saves a media item (create or update)
 */
function saveMedia(mediaData: {
  id?: string;
  title: string;
  author: string;
  type: string;
  isbn: string;
  notes: string;
  genres: string;
  date: string;
  abstract: string;
  subjects: string;
  description: string;
  publisher: string;
  place: string;
  classification: string;
  barcodes: string;
}): { success: boolean; error?: string } {
  const user = Session.getActiveUser().getEmail();

  const service = getMediaService();

  const fields = {
    title: mediaData.title,
    author: mediaData.author,
    type: mediaData.type,
    isbn: mediaData.isbn,
    notes: mediaData.notes,
    genres: mediaData.genres,
    date: mediaData.date,
    abstract: mediaData.abstract,
    subjects: mediaData.subjects,
    description: mediaData.description,
    publisher: mediaData.publisher,
    place: mediaData.place,
    classification: mediaData.classification,
    barcodes: mediaData.barcodes,
  };

  if (mediaData.id) {
    writeAuditLog(user, `updated media: ${mediaData.title} (ID: ${mediaData.id})`);
    const result = service.update(mediaData.id, fields);
    return { success: result.success, error: result.error };
  } else {
    writeAuditLog(user, `created media: ${mediaData.title}`);
    const result = service.createMedia(
      mediaData.title, mediaData.author, mediaData.type,
      mediaData.isbn, mediaData.notes, mediaData.genres,
      mediaData.date, mediaData.abstract, mediaData.subjects,
      mediaData.description, mediaData.publisher, mediaData.place,
      mediaData.classification, mediaData.barcodes
    );
    return { success: result.success, error: result.error };
  }
}

// ============================================================================
// LOAN FUNCTIONS (called from client-side JS)
// ============================================================================

/**
 * Gets active loans
 */
function getActiveLoans(): unknown[] {
  const user = Session.getActiveUser().getEmail();
  Logger.log(`[AUDIT] ${user} retrieved active loans`);

  const loanService = getLoanService();

  const loansResult = loanService.getActiveLoans();
  if (!loansResult.success || !loansResult.data) {
    return [];
  }

  return loansResult.data;
}

/**
 * Gets overdue loans
 */
function getOverdueLoans(): unknown[] {
  const user = Session.getActiveUser().getEmail();
  Logger.log(`[AUDIT] ${user} retrieved overdue loans`);

  const service = getLoanService();
  const result = service.getOverdueLoans();
  return result.success && result.data ? result.data : [];
}

/**
 * Processes a new checkout
 */
function processCheckout(
  borrowerId: string,
  barcode: string,
  resourceId: string,
  title: string,
  borrowerName: string,
  loanDays: number = 21
): { success: boolean; error?: string } {
  const user = Session.getActiveUser().getEmail();
  writeAuditLog(user, `checked out "${title}" (barcode=${barcode}) to ${borrowerName} (borrower=${borrowerId}) for ${loanDays} days`);

  const service = getLoanService();
  const result = service.checkout(borrowerId, barcode, resourceId, borrowerName, title, loanDays );
  return { success: result.success, error: result.error };
}

/**
 * Returns a loan by ID
 */
function returnLoanById(id: string): { success: boolean; error?: string } {
  const user = Session.getActiveUser().getEmail();
  writeAuditLog(user, `returned loan: ${id}`);

  const service = getLoanService();
  const result = service.processReturn(id);
  return { success: result.success, error: result.error };
}

/**
 * Extends a loan
 */
function extendLoan(loanId: string, days: number): { success: boolean; error?: string } {
  const user = Session.getActiveUser().getEmail();
  writeAuditLog(user, `extended loan: ${loanId} by ${days} days`);

  const service = getLoanService();
  const result = service.extendLoan(loanId, days);
  return { success: result.success, error: result.error };
}

// ============================================================================
// EXPOSE GLOBAL FUNCTIONS
// ============================================================================

// Web app entry points
(globalThis as Record<string, unknown>).doGet = doGet;
(globalThis as Record<string, unknown>).getAppContext = getAppContext;
(globalThis as Record<string, unknown>).include = include;

// Setup functions
(globalThis as Record<string, unknown>).runDiscovery = runDiscovery;
(globalThis as Record<string, unknown>).showConfig = showConfig;
(globalThis as Record<string, unknown>).clearConfig = clearConfig;

(globalThis as Record<string, unknown>).initializeAllHeaders = initializeAllHeaders;
(globalThis as Record<string, unknown>).setAuditLogSpreadsheetId = setAuditLogSpreadsheetId;
(globalThis as Record<string, unknown>).getAuditLogSpreadsheetId = getAuditLogSpreadsheetId;

// Borrower functions
(globalThis as Record<string, unknown>).getAllBorrowers = getAllBorrowers;
(globalThis as Record<string, unknown>).getActiveBorrowers = getActiveBorrowers;
(globalThis as Record<string, unknown>).searchBorrowers = searchBorrowers;
(globalThis as Record<string, unknown>).saveBorrower = saveBorrower;

// Media functions
(globalThis as Record<string, unknown>).getAllMedia = getAllMedia;
(globalThis as Record<string, unknown>).getAvailableMedia = getAvailableMedia;
(globalThis as Record<string, unknown>).searchMedia = searchMedia;
(globalThis as Record<string, unknown>).saveMedia = saveMedia;

// Loan functions
(globalThis as Record<string, unknown>).getActiveLoans = getActiveLoans;
(globalThis as Record<string, unknown>).getOverdueLoans = getOverdueLoans;
(globalThis as Record<string, unknown>).processCheckout = processCheckout;
(globalThis as Record<string, unknown>).returnLoanById = returnLoanById;
(globalThis as Record<string, unknown>).extendLoan = extendLoan;
