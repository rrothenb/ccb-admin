/**
 * Google Apps Script entry points for the ADMIN web app (separate project).
 *
 * Parallels src/gas-entry.ts but for the master-account-only sync tool. This
 * project carries the contacts/Drive scopes and will own the whole membership
 * sync + detector + Contacts/website projection flow.
 *
 * Note: In GAS, all client- or trigger-callable functions must be in the global
 * scope, so every exposed function is bound onto globalThis at the bottom. New
 * functions here need an explicit `globalThis.X = X` line or the client can't
 * call them.
 *
 * IMPORTANT: this is a SEPARATE Apps Script project from the main app, so it has
 * its own (initially empty) script-properties store. The master spreadsheet IDs
 * discovered by the main app are NOT visible here — `runDiscovery()` must be run
 * once from THIS project's editor before any feature can read/write the sheets.
 */

import {
  discoverAllMasterSpreadsheets,
  getMasterConfig,
  clearMasterConfig,
} from './services/discovery';

import { setAuditLogSpreadsheetId, getAuditLogSpreadsheetId } from './services/audit-log';

import { generateCatalogue } from './admin/catalogue';

import {
  contactsSpike_listManaged,
  contactsSpike_syncDryRun,
  contactsSpike_syncApply,
  contactsSpike_teardown,
} from './admin/contacts-spike';

import { doGet, include } from './admin/webapp';

// ============================================================================
// SETUP FUNCTIONS (run from the admin project's Apps Script editor)
// ============================================================================

/**
 * Locates the master spreadsheets by name and stores their IDs in this
 * project's script properties. Run once from the admin editor after deploying.
 * Mirrors the main app's runDiscovery() but populates the admin project's own
 * (separate) property store.
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
 * Shows the admin project's current spreadsheet configuration in the logs.
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
 * Clears the admin project's stored spreadsheet configuration.
 */
function clearConfig(): void {
  clearMasterConfig();
  Logger.log('Configuration cleared.');
}

// ============================================================================
// SYNC FUNCTIONS
// ============================================================================

/**
 * Placeholder for the membership sync entry point. Real implementation will:
 *  - accept the two uploaded spreadsheets (Master Membership + Register),
 *  - run the reconciliation detector (name-uniqueness first, then the rest),
 *  - return a worklist of flagged issues for the admin to resolve,
 *  - on a clean run: write expiry dates (DATE ENROLED + 1 year) to the members
 *    sheet and project to Gmail Contacts (labeled by class level/teacher/number)
 *    + the website artifacts.
 */
function runMembershipSync(): { success: boolean; error?: string } {
  return { success: false, error: 'Not implemented yet' };
}

// ============================================================================
// EXPOSE GLOBAL FUNCTIONS
// ============================================================================

// Web app entry points
(globalThis as Record<string, unknown>).doGet = doGet;
(globalThis as Record<string, unknown>).include = include;

// Setup functions
(globalThis as Record<string, unknown>).runDiscovery = runDiscovery;
(globalThis as Record<string, unknown>).showConfig = showConfig;
(globalThis as Record<string, unknown>).clearConfig = clearConfig;
(globalThis as Record<string, unknown>).setAuditLogSpreadsheetId = setAuditLogSpreadsheetId;
(globalThis as Record<string, unknown>).getAuditLogSpreadsheetId = getAuditLogSpreadsheetId;

// Sync functions
(globalThis as Record<string, unknown>).runMembershipSync = runMembershipSync;

// Website generation
(globalThis as Record<string, unknown>).generateCatalogue = generateCatalogue;

// Contacts spike (People API risk retirement)
(globalThis as Record<string, unknown>).contactsSpike_listManaged = contactsSpike_listManaged;
(globalThis as Record<string, unknown>).contactsSpike_syncDryRun = contactsSpike_syncDryRun;
(globalThis as Record<string, unknown>).contactsSpike_syncApply = contactsSpike_syncApply;
(globalThis as Record<string, unknown>).contactsSpike_teardown = contactsSpike_teardown;
