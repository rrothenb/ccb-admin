/**
 * Web App entry point
 *
 * This replaces the sidebar-based approach with a standalone web app.
 * Access is controlled by Google's built-in sharing on the underlying spreadsheets.
 */

import { SheetName } from '../types';
import { writeAuditLog } from '../services/audit-log';

/**
 * Main entry point for the web app
 * This function is called when someone visits the web app URL
 */
function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createTemplateFromFile('App')
    .evaluate()
    .setTitle('CCB Library Admin')
    .setFaviconUrl('https://www.ccb-lille.com/wp-content/uploads/2024/02/cropped-favicon-32x32.png')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Gets the current app context for the client. Called once per page load, so
 * we also use it as the "session started" hook for the audit log — one entry
 * per visit, keeping the log lean.
 */
function getAppContext(): { view: SheetName; userEmail: string } {
  const userEmail = Session.getActiveUser().getEmail();
  writeAuditLog(userEmail, 'opened CCB Library Admin');
  return {
    view: 'Borrowers', // Default view
    userEmail,
  };
}

/**
 * Helper to include other HTML files (for CSS/JS partials)
 */
function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

export { doGet, getAppContext, include };
