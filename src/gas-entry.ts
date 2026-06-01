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
import { getMediaService, CLASSIFICATIONS, classificationMatches, matchesAnyClassification, NONE_VALUE, UNCLASSIFIED_VALUE, ClassificationOption } from './services/media';
import { getLoanService } from './services/loans';
import { writeAuditLog, setAuditLogSpreadsheetId, getAuditLogSpreadsheetId } from './services/audit-log';
import { Media, Loan } from './types';

/**
 * If `barcode` (one of `media`'s own copies) is assigned to a parent box via
 * `media.resourceBox`, returns the containing box's barcode and title.
 */
function findContainingBox(
  media: Media,
  barcode: string,
  allMedia: Media[]
): { boxBarcode: string; boxTitle: string } | null {
  if (!media.resourceBox) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(media.resourceBox);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const boxBarcode = parsed[barcode];
  if (typeof boxBarcode !== 'string' || !boxBarcode) return null;
  const box = allMedia.find((m) =>
    (m.barcodes || '').split('|').map((b) => b.trim()).includes(boxBarcode)
  );
  return { boxBarcode, boxTitle: box?.title || boxBarcode };
}

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
 * One-shot migration: adds an `id` column to the Media sheet and backfills
 * IDs for existing rows. Safe to re-run — does nothing if `id` is already
 * the first column. Run this from the Apps Script editor.
 */
function backfillMediaIds(): void {
  const result = getMediaService().backfillIds();
  if (result.success) {
    Logger.log(`Backfill complete. Rows updated: ${result.data?.rowsUpdated ?? 0}`);
  } else {
    Logger.log(`Backfill failed: ${result.error}`);
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
 * Gets all borrowers, sorted by name and annotated with an active/expired
 * `status` (same derivation as searchBorrowers) so the Members tab can show the
 * whole roster without requiring a search.
 */
function getAllBorrowers(): unknown[] {
  const service = getBorrowerService();
  const result = service.getAll();
  if (!result.success || !result.data) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return result.data
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(b => ({
      ...b,
      status: (b.expiryDate && new Date(b.expiryDate) > today) ? 'active' : 'expired',
    }));
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
 * Returns every barcode in the catalog (flat string array) for client-side prefix typeahead
 */
function getAllBarcodes(): string[] {
  const service = getMediaService();
  const result = service.getAllBarcodes();
  return result.success && result.data ? result.data : [];
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
 * Returns the curated list of classifications shown in the Resources tab dropdown.
 */
function getClassifications(): { value: string; label: string; prefix: boolean }[] {
  return CLASSIFICATIONS.map((c: ClassificationOption) => ({
    value: c.value,
    label: c.label,
    prefix: !!c.prefix,
  }));
}

/**
 * Searches all media and returns full objects with availability status (for Resources tab display).
 * Any of `query`, `classification`, or `status` may be empty; if all are empty the result is empty.
 * Provided filters are combined (intersection): the text query, classification, and availability
 * status each narrow the results.
 */
function searchAllMedia(query: string, classification: string = '', status: string = ''): unknown[] {
  const user = Session.getActiveUser().getEmail();
  Logger.log(`[AUDIT] ${user} searched all media: query="${query}" classification="${classification}" status="${status}"`);

  if (!query && !classification && !status) return [];

  const mediaService = getMediaService();
  const result = mediaService.getAll();
  const data = result.success && result.data ? result.data : [];

  const loanService = getLoanService();
  const loanResult = loanService.getAll();
  const loanedBarcodes = (loanResult.success && loanResult.data ? loanResult.data : []).map(l => l.barcode);

  const lowerQuery = query.toLowerCase();
  const hasQuery = !!query;
  const hasClassification = !!classification;

  return data
    .filter(item => {
      if (!hasClassification) return true;
      const itemCls = `${item.classification || ''}`.trim();
      if (classification === NONE_VALUE) return itemCls === '';
      if (classification === UNCLASSIFIED_VALUE) return itemCls !== '' && !matchesAnyClassification(itemCls);
      return classificationMatches(itemCls, classification);
    })
    .filter(item =>
      !hasQuery ||
      `${item.title}`.toLowerCase().includes(lowerQuery) ||
      `${item.author}`.toLowerCase().includes(lowerQuery) ||
      `${item.type}`.toLowerCase().includes(lowerQuery) ||
      `${item.classification}`.toLowerCase().includes(lowerQuery) ||
      `${item.resourceBox}`.toLowerCase().includes(lowerQuery) ||
      `${item.barcodes}`.toLowerCase().includes(lowerQuery)
    )
    .map(item => {
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(item)) {
        if (value !== '' && value !== null && value !== undefined) {
          clean[key] = value;
        }
      }
      const barcodeList = `${item.barcodes || ''}`.split('|').map((b: string) => b.trim()).filter(Boolean);
      if (barcodeList.length === 0) {
        clean.status = 'no-copies';
      } else {
        clean.status = barcodeList.some((b: string) => !loanedBarcodes.includes(b))
          ? 'available'
          : 'on-loan';
      }
      return clean;
    })
    .filter(item => !status || item.status === status);
}

/**
 * Saves a media item (create or update)
 */
function saveMedia(mediaData: {
  id?: string;
  title: string;
  author: string;
  type: string;
  classification: string;
  barcodes: string;
  resourceBox: string;
}): { success: boolean; error?: string } {
  const user = Session.getActiveUser().getEmail();

  const service = getMediaService();

  const fields = {
    title: mediaData.title,
    author: mediaData.author,
    type: mediaData.type,
    classification: mediaData.classification,
    barcodes: mediaData.barcodes,
    resourceBox: mediaData.resourceBox,
  };

  if (mediaData.id) {
    writeAuditLog(user, `updated media: ${mediaData.title} (ID: ${mediaData.id})`);
    const result = service.update(mediaData.id, fields);
    return { success: result.success, error: result.error };
  } else {
    writeAuditLog(user, `created media: ${mediaData.title}`);
    const result = service.createMedia(
      mediaData.title, mediaData.author, mediaData.type,
      mediaData.classification, mediaData.barcodes, mediaData.resourceBox
    );
    return { success: result.success, error: result.error };
  }
}

/**
 * Deletes a media item by ID. Outstanding loans for the resource are handled by
 * due date: overdue loans (the resource was checked out and never returned) are
 * deleted along with the resource, but a copy that is still out and not yet due
 * blocks deletion so we never discard a loan the borrower will return.
 */
function deleteMedia(id: string): { success: boolean; error?: string } {
  const user = Session.getActiveUser().getEmail();

  const service = getMediaService();
  const existing = service.getById(id);
  if (!existing.success || !existing.data) {
    return { success: false, error: 'Resource not found' };
  }
  const media = existing.data;

  const barcodes = `${media.barcodes ?? ''}`.split('|').map(b => b.trim()).filter(Boolean);
  let overdueLoans: Loan[] = [];
  if (barcodes.length) {
    const loanService = getLoanService();
    const loanResult = loanService.getAll();
    const loans = (loanResult.success && loanResult.data ? loanResult.data : [])
      .filter(l => barcodes.includes(l.barcode));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    overdueLoans = loans.filter(l => new Date(l.dueDate) < today);
    const currentLoans = loans.filter(l => new Date(l.dueDate) >= today);

    if (currentLoans.length) {
      const plural = currentLoans.length === 1;
      return {
        success: false,
        error: `Cannot delete "${media.title}" — ${currentLoans.length} ${plural ? 'copy is' : 'copies are'} currently on loan and not yet due. Return ${plural ? 'it' : 'them'} first.`,
      };
    }

    // Cascade-delete overdue loans (the never-returned scenario) so deleting the
    // resource doesn't leave orphaned loan rows.
    for (const loan of overdueLoans) {
      const delResult = loanService.delete(loan.id);
      if (!delResult.success) {
        return { success: false, error: `Failed to remove overdue loan for barcode ${loan.barcode}: ${delResult.error}` };
      }
      writeAuditLog(user, `deleted overdue loan during resource deletion: "${media.title}" (barcode=${loan.barcode}, loan=${loan.id}, borrower=${loan.borrowerName})`);
    }
  }

  writeAuditLog(user, `deleted media: ${media.title} (ID: ${id})`);
  const result = service.delete(id);
  return { success: result.success, error: result.error };
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

  const service = getLoanService();
  const result = service.processReturn(id);
  writeAuditLog(user, `returned loan: ${JSON.stringify(result)}`);
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

/**
 * Checks out a resource by barcode (for circulation desk barcode scanner workflow)
 */
function checkoutByBarcode(
  borrowerId: string,
  barcode: string,
  borrowerName: string,
  loanDays: number = 21
): { success: boolean; title?: string; error?: string } {
  const user = Session.getActiveUser().getEmail();

  const mediaService = getMediaService();
  const allMedia = mediaService.getAll();
  if (!allMedia.success || !allMedia.data) {
    return { success: false, error: 'Could not load resources' };
  }

  let foundMedia = null;
  for (const item of allMedia.data) {
    const barcodes = (item.barcodes || '').split('|').map((b: string) => b.trim());
    if (barcodes.includes(barcode)) {
      foundMedia = item;
      break;
    }
  }

  if (!foundMedia) {
    return { success: false, error: `Barcode ${barcode} not found in catalog` };
  }

  const containing = findContainingBox(foundMedia, barcode, allMedia.data);
  if (containing) {
    return {
      success: false,
      error: `"${foundMedia.title}" (${barcode}) is inside box "${containing.boxTitle}" (${containing.boxBarcode}). Check out the box instead.`,
    };
  }

  const loanService = getLoanService();
  const result = loanService.checkout(borrowerId, barcode, foundMedia.id, borrowerName, foundMedia.title, loanDays);
  if (result.success) {
    writeAuditLog(user, `checked out "${foundMedia.title}" (barcode=${barcode}) to ${borrowerName} (borrower=${borrowerId}) for ${loanDays} days`);
    return { success: true, title: foundMedia.title };
  }
  return { success: false, error: result.error };
}

/**
 * Returns a loan by barcode (for circulation desk barcode scanner workflow)
 */
function returnLoanByBarcode(barcode: string): { success: boolean; title?: string; borrowerName?: string; error?: string } {
  const user = Session.getActiveUser().getEmail();

  const service = getLoanService();
  const allLoans = service.getAll();
  if (!allLoans.success || !allLoans.data) {
    return { success: false, error: 'Could not load loans' };
  }

  const loan = allLoans.data.find((l) => l.barcode === barcode);
  if (!loan) {
    return { success: false, error: `No active loan found for barcode ${barcode}` };
  }

  const allMedia = getMediaService().getAll();
  if (allMedia.success && allMedia.data) {
    const owningMedia = allMedia.data.find((m) =>
      (m.barcodes || '').split('|').map((b) => b.trim()).includes(barcode)
    );
    if (owningMedia) {
      const containing = findContainingBox(owningMedia, barcode, allMedia.data);
      if (containing) {
        return {
          success: false,
          error: `"${loan.title}" (${barcode}) is inside box "${containing.boxTitle}" (${containing.boxBarcode}). Return the box instead.`,
        };
      }
    }
  }

  const returnResult = service.processReturn(loan.id);
  if (returnResult.success) {
    writeAuditLog(user, `returned "${loan.title}" (barcode=${barcode}) from ${loan.borrowerName}`);
    return { success: true, title: loan.title, borrowerName: loan.borrowerName };
  }
  return { success: false, error: returnResult.error };
}

/**
 * Extends a loan by barcode (for circulation desk barcode scanner workflow)
 */
function extendLoanByBarcode(barcode: string, days: number = 21): { success: boolean; title?: string; newDueDate?: string; error?: string } {
  const user = Session.getActiveUser().getEmail();

  const service = getLoanService();
  const allLoans = service.getAll();
  if (!allLoans.success || !allLoans.data) {
    return { success: false, error: 'Could not load loans' };
  }

  const allMedia = getMediaService().getAll();
  if (!allMedia.success || !allMedia.data) {
    return { success: false, error: 'Could not load resources' };
  }
  const knownBarcode = allMedia.data.some((m) =>
    (m.barcodes || '').split('|').map((b) => b.trim()).includes(barcode)
  );
  if (!knownBarcode) {
    return { success: false, error: `Barcode ${barcode} not found in catalog` };
  }

  const loan = allLoans.data.find((l) => l.barcode === barcode);
  if (!loan) {
    return { success: false, error: `Barcode ${barcode} is not currently checked out` };
  }

  const extendResult = service.extendLoan(loan.id, days);
  if (extendResult.success) {
    writeAuditLog(user, `extended "${loan.title}" (barcode=${barcode}) by ${days} days`);
    return { success: true, title: loan.title, newDueDate: extendResult.data?.dueDate };
  }
  return { success: false, error: extendResult.error };
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
(globalThis as Record<string, unknown>).backfillMediaIds = backfillMediaIds;
(globalThis as Record<string, unknown>).setAuditLogSpreadsheetId = setAuditLogSpreadsheetId;
(globalThis as Record<string, unknown>).getAuditLogSpreadsheetId = getAuditLogSpreadsheetId;

// Borrower functions
(globalThis as Record<string, unknown>).getAllBorrowers = getAllBorrowers;
(globalThis as Record<string, unknown>).searchBorrowers = searchBorrowers;
(globalThis as Record<string, unknown>).saveBorrower = saveBorrower;

// Media functions
(globalThis as Record<string, unknown>).getAllMedia = getAllMedia;
(globalThis as Record<string, unknown>).getAllBarcodes = getAllBarcodes;
(globalThis as Record<string, unknown>).getAvailableMedia = getAvailableMedia;
(globalThis as Record<string, unknown>).searchMedia = searchMedia;
(globalThis as Record<string, unknown>).searchAllMedia = searchAllMedia;
(globalThis as Record<string, unknown>).getClassifications = getClassifications;
(globalThis as Record<string, unknown>).saveMedia = saveMedia;
(globalThis as Record<string, unknown>).deleteMedia = deleteMedia;

// Loan functions
(globalThis as Record<string, unknown>).getActiveLoans = getActiveLoans;
(globalThis as Record<string, unknown>).getOverdueLoans = getOverdueLoans;
(globalThis as Record<string, unknown>).processCheckout = processCheckout;
(globalThis as Record<string, unknown>).returnLoanById = returnLoanById;
(globalThis as Record<string, unknown>).extendLoan = extendLoan;
(globalThis as Record<string, unknown>).checkoutByBarcode = checkoutByBarcode;
(globalThis as Record<string, unknown>).returnLoanByBarcode = returnLoanByBarcode;
(globalThis as Record<string, unknown>).extendLoanByBarcode = extendLoanByBarcode;
