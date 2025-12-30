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

import { doGet, getAppContext, include, setHubSpreadsheetId, getHubSpreadsheetId } from './ui/webapp';

import { getBorrowerService } from './services/borrowers';
import { getMediaService } from './services/media';
import { getLoanService } from './services/loans';

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
Media ID: ${config.mediaId || '(not set)'}
Loans ID: ${config.loansId || '(not set)'}
Hub ID: ${getHubSpreadsheetId() || '(not set)'}
Last Discovery: ${config.lastDiscoveryDate || '(never)'}`);
}

/**
 * Clears the current configuration
 */
function clearConfig(): void {
  clearMasterConfig();
  Logger.log('Configuration cleared.');
}

/**
 * Sets the Hub spreadsheet ID for access control
 * Run this from the Apps Script editor:
 *   setHubId('your-spreadsheet-id-here')
 */
function setHubId(id: string): void {
  setHubSpreadsheetId(id);
  Logger.log(`Hub ID set to: ${id}`);
}

// ============================================================================
// MAINTENANCE FUNCTIONS
// ============================================================================

/**
 * Updates overdue loan statuses
 */
function updateOverdueStatuses(): { updated: number; error?: string } {
  const loanService = getLoanService();
  const result = loanService.updateOverdueStatuses();

  if (result.success) {
    Logger.log(`Updated ${result.data} loans to overdue status.`);
    return { updated: result.data || 0 };
  } else {
    Logger.log(`Update failed: ${result.error}`);
    return { updated: 0, error: result.error };
  }
}

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
  return result.success && result.data ? result.data : [];
}

/**
 * Gets active borrowers only
 */
function getActiveBorrowers(): unknown[] {
  const service = getBorrowerService();
  const result = service.getActiveBorrowers();
  return result.success && result.data ? result.data : [];
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
  notes: string;
}): { success: boolean; error?: string } {
  const service = getBorrowerService();

  if (borrowerData.id) {
    const result = service.update(borrowerData.id, {
      name: borrowerData.name,
      email: borrowerData.email,
      phone: borrowerData.phone,
      notes: borrowerData.notes,
    });
    return { success: result.success, error: result.error };
  } else {
    const result = service.createBorrower(
      borrowerData.name,
      borrowerData.email,
      borrowerData.phone,
      borrowerData.notes
    );
    return { success: result.success, error: result.error };
  }
}

/**
 * Suspends a borrower by ID
 */
function suspendBorrowerById(id: string): { success: boolean; error?: string } {
  const service = getBorrowerService();
  const result = service.suspendBorrower(id);
  return { success: result.success, error: result.error };
}

/**
 * Activates a borrower by ID
 */
function activateBorrowerById(id: string): { success: boolean; error?: string } {
  const service = getBorrowerService();
  const result = service.update(id, { status: 'active' });
  return { success: result.success, error: result.error };
}

// ============================================================================
// MEDIA FUNCTIONS (called from client-side JS)
// ============================================================================

/**
 * Gets all media
 */
function getAllMedia(): unknown[] {
  const service = getMediaService();
  const result = service.getAll();
  return result.success && result.data ? result.data : [];
}

/**
 * Gets available media (not on loan)
 */
function getAvailableMedia(): unknown[] {
  const service = getMediaService();
  const result = service.getAvailableMedia();
  return result.success && result.data ? result.data : [];
}

/**
 * Searches media
 */
function searchMedia(query: string): unknown[] {
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
}): { success: boolean; error?: string } {
  const service = getMediaService();

  if (mediaData.id) {
    const result = service.update(mediaData.id, {
      title: mediaData.title,
      author: mediaData.author,
      type: mediaData.type as 'book' | 'dvd' | 'magazine' | 'audiobook' | 'other',
      isbn: mediaData.isbn,
      notes: mediaData.notes,
    });
    return { success: result.success, error: result.error };
  } else {
    const result = service.createMedia(
      mediaData.title,
      mediaData.author,
      mediaData.type as 'book' | 'dvd' | 'magazine' | 'audiobook' | 'other',
      mediaData.isbn,
      mediaData.notes
    );
    return { success: result.success, error: result.error };
  }
}

// ============================================================================
// LOAN FUNCTIONS (called from client-side JS)
// ============================================================================

/**
 * Gets active loans with borrower and media details
 */
function getActiveLoansWithDetails(): unknown[] {
  const loanService = getLoanService();
  const borrowerService = getBorrowerService();
  const mediaService = getMediaService();

  const loansResult = loanService.getActiveLoans();
  if (!loansResult.success || !loansResult.data) {
    return [];
  }

  // Enrich with borrower and media names
  const borrowersResult = borrowerService.getAll();
  const mediaResult = mediaService.getAll();

  const borrowersMap: Record<string, string> = {};
  const mediaMap: Record<string, string> = {};

  if (borrowersResult.success && borrowersResult.data) {
    borrowersResult.data.forEach((b) => {
      borrowersMap[b.id] = b.name;
    });
  }

  if (mediaResult.success && mediaResult.data) {
    mediaResult.data.forEach((m) => {
      mediaMap[m.id] = m.title;
    });
  }

  return loansResult.data.map((loan) => ({
    ...loan,
    borrowerName: borrowersMap[loan.borrowerId] || loan.borrowerId,
    mediaTitle: mediaMap[loan.mediaId] || loan.mediaId,
  }));
}

/**
 * Gets overdue loans
 */
function getOverdueLoans(): unknown[] {
  const service = getLoanService();
  const result = service.getOverdueLoans();
  return result.success && result.data ? result.data : [];
}

/**
 * Processes a new checkout
 */
function processCheckout(
  borrowerId: string,
  mediaId: string,
  loanDays: number = 14
): { success: boolean; error?: string } {
  const service = getLoanService();
  const result = service.checkout(borrowerId, mediaId, loanDays);
  return { success: result.success, error: result.error };
}

/**
 * Returns a loan by ID
 */
function returnLoanById(id: string): { success: boolean; error?: string } {
  const service = getLoanService();
  const result = service.processReturn(id);
  return { success: result.success, error: result.error };
}

/**
 * Extends a loan
 */
function extendLoan(loanId: string, days: number): { success: boolean; error?: string } {
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
(globalThis as Record<string, unknown>).setHubId = setHubId;
(globalThis as Record<string, unknown>).updateOverdueStatuses = updateOverdueStatuses;
(globalThis as Record<string, unknown>).initializeAllHeaders = initializeAllHeaders;

// Borrower functions
(globalThis as Record<string, unknown>).getAllBorrowers = getAllBorrowers;
(globalThis as Record<string, unknown>).getActiveBorrowers = getActiveBorrowers;
(globalThis as Record<string, unknown>).searchBorrowers = searchBorrowers;
(globalThis as Record<string, unknown>).saveBorrower = saveBorrower;
(globalThis as Record<string, unknown>).suspendBorrowerById = suspendBorrowerById;
(globalThis as Record<string, unknown>).activateBorrowerById = activateBorrowerById;

// Media functions
(globalThis as Record<string, unknown>).getAllMedia = getAllMedia;
(globalThis as Record<string, unknown>).getAvailableMedia = getAvailableMedia;
(globalThis as Record<string, unknown>).searchMedia = searchMedia;
(globalThis as Record<string, unknown>).saveMedia = saveMedia;

// Loan functions
(globalThis as Record<string, unknown>).getActiveLoansWithDetails = getActiveLoansWithDetails;
(globalThis as Record<string, unknown>).getOverdueLoans = getOverdueLoans;
(globalThis as Record<string, unknown>).processCheckout = processCheckout;
(globalThis as Record<string, unknown>).returnLoanById = returnLoanById;
(globalThis as Record<string, unknown>).extendLoan = extendLoan;
