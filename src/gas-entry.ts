/**
 * Google Apps Script entry points
 *
 * This file exposes all functions that need to be accessible from
 * the Google Apps Script runtime (menus, dialogs, triggers, etc.)
 *
 * Note: In GAS, all functions must be in the global scope.
 * TypeScript modules are compiled but the exports need to be
 * re-exported here as global functions.
 */

import {
  discoverAllMasterSpreadsheets,
  getMasterConfig,
  clearMasterConfig,
} from './services/discovery';

import {
  showContextSidebar,
  getSidebarContext,
  include,
} from './ui/sidebar';

import { getBorrowerService } from './services/borrowers';
import { getMediaService } from './services/media';
import { getLoanService } from './services/loans';

// ============================================================================
// TRIGGERS & MENU
// ============================================================================

/**
 * Runs when the spreadsheet is opened
 * Creates the custom menu
 */
function onOpen(): void {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Library Manager')
    .addItem('Open Sidebar', 'showContextSidebar')
    .addSeparator()
    .addSubMenu(
      ui.createMenu('Setup')
        .addItem('Discover Master Spreadsheets', 'runDiscovery')
        .addItem('View Configuration', 'showConfig')
        .addItem('Clear Configuration', 'clearConfig')
    )
    .addSeparator()
    .addSubMenu(
      ui.createMenu('Maintenance')
        .addItem('Update Overdue Statuses', 'updateOverdueStatuses')
        .addItem('Initialize Headers', 'initializeAllHeaders')
    )
    .addToUi();

  // Auto-show sidebar
  showContextSidebar();
}

/**
 * Runs when the spreadsheet is installed (first use)
 */
function onInstall(): void {
  onOpen();
}

// ============================================================================
// SETUP FUNCTIONS
// ============================================================================

/**
 * Runs the master spreadsheet discovery process
 */
function runDiscovery(): void {
  const ui = SpreadsheetApp.getUi();

  const result = discoverAllMasterSpreadsheets();

  if (result.success && result.data) {
    const found = result.data
      .map((r) => `- ${r.sheetName}: "${r.spreadsheetName}"`)
      .join('\n');

    let message = `Discovery complete!\n\nFound:\n${found}`;
    if (result.error) {
      message += `\n\nWarnings:\n${result.error}`;
    }

    ui.alert('Discovery Complete', message, ui.ButtonSet.OK);
  } else {
    ui.alert('Discovery Failed', result.error || 'Unknown error', ui.ButtonSet.OK);
  }
}

/**
 * Shows the current configuration
 */
function showConfig(): void {
  const ui = SpreadsheetApp.getUi();
  const config = getMasterConfig();

  if (!config) {
    ui.alert(
      'No Configuration',
      'No master spreadsheets configured. Run "Discover Master Spreadsheets" first.',
      ui.ButtonSet.OK
    );
    return;
  }

  const message = `Current Configuration:

Borrowers ID: ${config.borrowersId || '(not set)'}
Media ID: ${config.mediaId || '(not set)'}
Loans ID: ${config.loansId || '(not set)'}

Last Discovery: ${config.lastDiscoveryDate || '(never)'}`;

  ui.alert('Configuration', message, ui.ButtonSet.OK);
}

/**
 * Clears the current configuration
 */
function clearConfig(): void {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    'Clear Configuration',
    'Are you sure you want to clear the master spreadsheet configuration?',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    clearMasterConfig();
    ui.alert('Configuration Cleared', 'Configuration has been cleared.', ui.ButtonSet.OK);
  }
}

// ============================================================================
// MAINTENANCE FUNCTIONS
// ============================================================================

/**
 * Updates overdue loan statuses
 */
function updateOverdueStatuses(): void {
  const ui = SpreadsheetApp.getUi();
  const loanService = getLoanService();

  const result = loanService.updateOverdueStatuses();

  if (result.success) {
    ui.alert(
      'Update Complete',
      `Updated ${result.data} loans to overdue status.`,
      ui.ButtonSet.OK
    );
  } else {
    ui.alert('Update Failed', result.error || 'Unknown error', ui.ButtonSet.OK);
  }
}

/**
 * Initializes headers on all master sheets
 */
function initializeAllHeaders(): void {
  const ui = SpreadsheetApp.getUi();

  const borrowerResult = getBorrowerService().ensureHeaders();
  const mediaResult = getMediaService().ensureHeaders();
  const loanResult = getLoanService().ensureHeaders();

  const results = [
    `Borrowers: ${borrowerResult.success ? 'OK' : borrowerResult.error}`,
    `Media: ${mediaResult.success ? 'OK' : mediaResult.error}`,
    `Loans: ${loanResult.success ? 'OK' : loanResult.error}`,
  ].join('\n');

  ui.alert('Header Initialization', results, ui.ButtonSet.OK);
}

// ============================================================================
// SIDEBAR FUNCTIONS (called from client-side JS)
// ============================================================================

// Re-export sidebar functions for global scope
// These are imported and need to be exposed globally
(globalThis as Record<string, unknown>).showContextSidebar = showContextSidebar;
(globalThis as Record<string, unknown>).getSidebarContext = getSidebarContext;
(globalThis as Record<string, unknown>).include = include;

// ============================================================================
// BORROWER DIALOG FUNCTIONS
// ============================================================================

/**
 * Shows the add borrower dialog
 */
function showAddBorrowerDialog(): void {
  const html = HtmlService.createTemplateFromFile('BorrowerDialog')
    .evaluate()
    .setWidth(400)
    .setHeight(450);

  SpreadsheetApp.getUi().showModalDialog(html, 'Add Borrower');
}

/**
 * Shows the edit borrower dialog for the selected row
 */
function showEditBorrowerDialog(): void {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();

  if (row <= 1) {
    SpreadsheetApp.getUi().alert('Please select a borrower row (not the header).');
    return;
  }

  const data = sheet.getRange(row, 1, 1, 7).getValues()[0];
  const borrower = {
    id: data[0],
    name: data[1],
    email: data[2],
    phone: data[3],
    status: data[4],
    joinDate: data[5],
    notes: data[6],
  };

  const template = HtmlService.createTemplateFromFile('BorrowerDialog');
  template.borrower = borrower;
  template.isEdit = true;

  const html = template.evaluate().setWidth(400).setHeight(450);
  SpreadsheetApp.getUi().showModalDialog(html, 'Edit Borrower');
}

/**
 * Shows the search borrowers dialog
 */
function showSearchBorrowersDialog(): void {
  const html = HtmlService.createTemplateFromFile('SearchDialog')
    .evaluate()
    .setWidth(500)
    .setHeight(400);

  SpreadsheetApp.getUi().showModalDialog(html, 'Search Borrowers');
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
 * Views loans for selected borrower
 */
function viewBorrowerLoans(): string {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();

  if (row <= 1) {
    throw new Error('Please select a borrower row');
  }

  const borrowerId = sheet.getRange(row, 1).getValue();
  const loanService = getLoanService();
  const result = loanService.getActiveLoansByBorrower(borrowerId);

  if (!result.success) {
    throw new Error(result.error);
  }

  return `Found ${result.data?.length || 0} active loans`;
}

/**
 * Suspends the selected borrower
 */
function suspendSelectedBorrower(): void {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();

  if (row <= 1) {
    throw new Error('Please select a borrower row');
  }

  const borrowerId = sheet.getRange(row, 1).getValue();
  const service = getBorrowerService();
  const result = service.suspendBorrower(borrowerId);

  if (!result.success) {
    throw new Error(result.error);
  }
}

// ============================================================================
// MEDIA DIALOG FUNCTIONS
// ============================================================================

/**
 * Shows the add media dialog
 */
function showAddMediaDialog(): void {
  const html = HtmlService.createTemplateFromFile('MediaDialog')
    .evaluate()
    .setWidth(400)
    .setHeight(450);

  SpreadsheetApp.getUi().showModalDialog(html, 'Add Media');
}

/**
 * Shows the edit media dialog for the selected row
 */
function showEditMediaDialog(): void {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();

  if (row <= 1) {
    SpreadsheetApp.getUi().alert('Please select a media row (not the header).');
    return;
  }

  const data = sheet.getRange(row, 1, 1, 7).getValues()[0];
  const media = {
    id: data[0],
    title: data[1],
    author: data[2],
    type: data[3],
    isbn: data[4],
    status: data[5],
    notes: data[6],
  };

  const template = HtmlService.createTemplateFromFile('MediaDialog');
  template.media = media;
  template.isEdit = true;

  const html = template.evaluate().setWidth(400).setHeight(450);
  SpreadsheetApp.getUi().showModalDialog(html, 'Edit Media');
}

/**
 * Shows the search media dialog
 */
function showSearchMediaDialog(): void {
  const html = HtmlService.createTemplateFromFile('SearchDialog')
    .evaluate()
    .setWidth(500)
    .setHeight(400);

  SpreadsheetApp.getUi().showModalDialog(html, 'Search Media');
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

/**
 * Checks availability of selected media
 */
function checkMediaAvailability(): string {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();

  if (row <= 1) {
    throw new Error('Please select a media row');
  }

  const mediaId = sheet.getRange(row, 1).getValue();
  const service = getMediaService();
  const result = service.isAvailable(mediaId);

  if (!result.success) {
    throw new Error(result.error);
  }

  return result.data ? 'Item is available' : 'Item is not available';
}

/**
 * Marks selected media as lost
 */
function markSelectedMediaAsLost(): void {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();

  if (row <= 1) {
    throw new Error('Please select a media row');
  }

  const mediaId = sheet.getRange(row, 1).getValue();
  const service = getMediaService();
  const result = service.markAsLost(mediaId);

  if (!result.success) {
    throw new Error(result.error);
  }
}

// ============================================================================
// LOAN DIALOG FUNCTIONS
// ============================================================================

/**
 * Shows the checkout dialog
 */
function showCheckoutDialog(): void {
  const html = HtmlService.createTemplateFromFile('CheckoutDialog')
    .evaluate()
    .setWidth(450)
    .setHeight(400);

  SpreadsheetApp.getUi().showModalDialog(html, 'New Checkout');
}

/**
 * Shows the extend loan dialog
 */
function showExtendLoanDialog(): void {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();

  if (row <= 1) {
    SpreadsheetApp.getUi().alert('Please select a loan row (not the header).');
    return;
  }

  const loanId = sheet.getRange(row, 1).getValue();

  const template = HtmlService.createTemplateFromFile('ExtendLoanDialog');
  template.loanId = loanId;

  const html = template.evaluate().setWidth(350).setHeight(200);
  SpreadsheetApp.getUi().showModalDialog(html, 'Extend Loan');
}

/**
 * Processes a checkout
 */
function processCheckout(data: {
  borrowerId: string;
  mediaId: string;
  loanDays: number;
}): { success: boolean; error?: string } {
  const service = getLoanService();
  const result = service.checkout(data.borrowerId, data.mediaId, data.loanDays);
  return { success: result.success, error: result.error };
}

/**
 * Processes return for selected loan
 */
function processSelectedReturn(): void {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();

  if (row <= 1) {
    throw new Error('Please select a loan row');
  }

  const loanId = sheet.getRange(row, 1).getValue();
  const service = getLoanService();
  const result = service.processReturn(loanId);

  if (!result.success) {
    throw new Error(result.error);
  }
}

/**
 * Extends a loan
 */
function extendLoan(loanId: string, days: number): { success: boolean; error?: string } {
  const service = getLoanService();
  const result = service.extendLoan(loanId, days);
  return { success: result.success, error: result.error };
}

/**
 * Filters to show overdue loans
 */
function filterOverdueLoans(): number {
  const service = getLoanService();
  const result = service.getOverdueLoans();

  if (!result.success || !result.data) {
    throw new Error(result.error);
  }

  // TODO: Apply filter to sheet
  return result.data.length;
}

/**
 * Filters to show active loans
 */
function filterActiveLoans(): number {
  const service = getLoanService();
  const result = service.getActiveLoans();

  if (!result.success || !result.data) {
    throw new Error(result.error);
  }

  // TODO: Apply filter to sheet
  return result.data.length;
}

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

/**
 * Searches borrowers
 */
function searchBorrowers(query: string): unknown[] {
  const service = getBorrowerService();
  const result = service.searchBorrowers(query);

  if (!result.success || !result.data) {
    return [];
  }

  return result.data;
}

/**
 * Searches media
 */
function searchMedia(query: string): unknown[] {
  const service = getMediaService();
  const result = service.searchMedia(query);

  if (!result.success || !result.data) {
    return [];
  }

  return result.data;
}

/**
 * Gets all borrowers (for autocomplete)
 */
function getAllBorrowers(): unknown[] {
  const service = getBorrowerService();
  const result = service.getActiveBorrowers();
  return result.success && result.data ? result.data : [];
}

/**
 * Gets all available media (for autocomplete)
 */
function getAvailableMedia(): unknown[] {
  const service = getMediaService();
  const result = service.getAvailableMedia();
  return result.success && result.data ? result.data : [];
}

// ============================================================================
// EXPOSE GLOBAL FUNCTIONS
// ============================================================================

// These need to be in global scope for GAS
(globalThis as Record<string, unknown>).onOpen = onOpen;
(globalThis as Record<string, unknown>).onInstall = onInstall;
(globalThis as Record<string, unknown>).runDiscovery = runDiscovery;
(globalThis as Record<string, unknown>).showConfig = showConfig;
(globalThis as Record<string, unknown>).clearConfig = clearConfig;
(globalThis as Record<string, unknown>).updateOverdueStatuses = updateOverdueStatuses;
(globalThis as Record<string, unknown>).initializeAllHeaders = initializeAllHeaders;
(globalThis as Record<string, unknown>).showAddBorrowerDialog = showAddBorrowerDialog;
(globalThis as Record<string, unknown>).showEditBorrowerDialog = showEditBorrowerDialog;
(globalThis as Record<string, unknown>).showSearchBorrowersDialog = showSearchBorrowersDialog;
(globalThis as Record<string, unknown>).saveBorrower = saveBorrower;
(globalThis as Record<string, unknown>).viewBorrowerLoans = viewBorrowerLoans;
(globalThis as Record<string, unknown>).suspendSelectedBorrower = suspendSelectedBorrower;
(globalThis as Record<string, unknown>).showAddMediaDialog = showAddMediaDialog;
(globalThis as Record<string, unknown>).showEditMediaDialog = showEditMediaDialog;
(globalThis as Record<string, unknown>).showSearchMediaDialog = showSearchMediaDialog;
(globalThis as Record<string, unknown>).saveMedia = saveMedia;
(globalThis as Record<string, unknown>).checkMediaAvailability = checkMediaAvailability;
(globalThis as Record<string, unknown>).markSelectedMediaAsLost = markSelectedMediaAsLost;
(globalThis as Record<string, unknown>).showCheckoutDialog = showCheckoutDialog;
(globalThis as Record<string, unknown>).showExtendLoanDialog = showExtendLoanDialog;
(globalThis as Record<string, unknown>).processCheckout = processCheckout;
(globalThis as Record<string, unknown>).processSelectedReturn = processSelectedReturn;
(globalThis as Record<string, unknown>).extendLoan = extendLoan;
(globalThis as Record<string, unknown>).filterOverdueLoans = filterOverdueLoans;
(globalThis as Record<string, unknown>).filterActiveLoans = filterActiveLoans;
(globalThis as Record<string, unknown>).searchBorrowers = searchBorrowers;
(globalThis as Record<string, unknown>).searchMedia = searchMedia;
(globalThis as Record<string, unknown>).getAllBorrowers = getAllBorrowers;
(globalThis as Record<string, unknown>).getAvailableMedia = getAvailableMedia;
