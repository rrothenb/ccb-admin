/**
 * Web App entry point
 *
 * This replaces the sidebar-based approach with a standalone web app.
 * Access is controlled by Google's built-in sharing on the underlying spreadsheets.
 */

import { SheetName } from '../types';

/**
 * Main entry point for the web app
 * This function is called when someone visits the web app URL
 */
function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createTemplateFromFile('App')
    .evaluate()
    .setTitle('CCB Admin')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Gets the current app context for the client
 */
function getAppContext(): { view: SheetName; userEmail: string } {
  return {
    view: 'Borrowers', // Default view
    userEmail: Session.getActiveUser().getEmail(),
  };
}

/**
 * Helper to include other HTML files (for CSS/JS partials)
 */
function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

export { doGet, getAppContext, include };
