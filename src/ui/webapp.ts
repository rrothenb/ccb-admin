/**
 * Web App entry point and access control
 *
 * This replaces the sidebar-based approach with a standalone web app.
 * Access is controlled by checking if the user has access to a designated
 * "CCB Webapp Access Control" spreadsheet - reusing Google Drive's sharing as the access control list.
 */

import { SheetName } from '../types';

/**
 * The CCB Webapp Access Control spreadsheet ID - used for access control.
 * Users with view or edit access to this spreadsheet can use the web app.
 *
 * Set this using the setAccessControlId() function after creating the spreadsheet.
 */
const ACCESS_CONTROL_SPREADSHEET_ID =
  PropertiesService.getScriptProperties().getProperty('ACCESS_CONTROL_SPREADSHEET_ID') || '';

/**
 * Checks if the current user has access to the CCB Webapp Access Control spreadsheet
 */
function checkAccess(): { authorized: boolean; email: string; error?: string } {
  const user = Session.getActiveUser().getEmail();

  if (!user) {
    return { authorized: false, email: '', error: 'Could not determine user email' };
  }

  if (!ACCESS_CONTROL_SPREADSHEET_ID) {
    // No Access Control spreadsheet configured - deny all access
    Logger.log(`Access denied for ${user}: ACCESS_CONTROL_SPREADSHEET_ID not configured.`);
    return {
      authorized: false,
      email: user,
      error: 'Access Control not configured. Contact administrator.'
    };
  }

  try {
    const file = DriveApp.getFileById(ACCESS_CONTROL_SPREADSHEET_ID);
    const editors = file.getEditors().map((e) => e.getEmail().toLowerCase());
    const viewers = file.getViewers().map((e) => e.getEmail().toLowerCase());
    const owner = file.getOwner()?.getEmail().toLowerCase() || '';

    const userLower = user.toLowerCase();
    const authorized =
      editors.includes(userLower) || viewers.includes(userLower) || owner === userLower;

    return { authorized, email: user };
  } catch (e) {
    // If we can't access the file, user is not authorized
    Logger.log(`Access check failed for ${user}: ${e}`);
    return { authorized: false, email: user, error: 'Could not verify access' };
  }
}

/**
 * Main entry point for the web app
 * This function is called when someone visits the web app URL
 */
function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  const access = checkAccess();

  if (!access.authorized) {
    return HtmlService.createHtmlOutput(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Library Manager - Access Denied</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              padding: 40px;
              text-align: center;
              background-color: #f9fafb;
              color: #1f2937;
            }
            .container {
              max-width: 400px;
              margin: 80px auto;
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            }
            h1 {
              color: #dc2626;
              font-size: 24px;
              margin-bottom: 16px;
            }
            p {
              color: #6b7280;
              line-height: 1.6;
            }
            .email {
              font-size: 13px;
              color: #9ca3af;
              margin-top: 24px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Access Denied</h1>
            <p>You don't have permission to use this application.</p>
            <p>Please contact the library administrator to request access.</p>
            <p class="email">Logged in as: ${access.email || 'unknown'}</p>
          </div>
        </body>
      </html>
    `)
      .setTitle('Library Manager - Access Denied')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService.createTemplateFromFile('App')
    .evaluate()
    .setTitle('Library Manager')
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

/**
 * Sets the CCB Webapp Access Control spreadsheet ID for access control
 * Call this once during initial setup
 */
function setAccessControlSpreadsheetId(id: string): void {
  PropertiesService.getScriptProperties().setProperty('ACCESS_CONTROL_SPREADSHEET_ID', id);
  Logger.log(`CCB Webapp Access Control spreadsheet ID set to: ${id}`);
}

/**
 * Gets the current CCB Webapp Access Control spreadsheet ID
 */
function getAccessControlSpreadsheetId(): string {
  return PropertiesService.getScriptProperties().getProperty('ACCESS_CONTROL_SPREADSHEET_ID') || '';
}

/**
 * Checks if the current user has access, throws error if not
 * Call this at the start of every server-side function that handles data
 */
function requireAccess(): void {
  const access = checkAccess();
  if (!access.authorized) {
    throw new Error(`Access denied for user: ${access.email}. ${access.error || 'Contact administrator for access.'}`);
  }
}

export { doGet, checkAccess, getAppContext, include, setAccessControlSpreadsheetId, getAccessControlSpreadsheetId, requireAccess };
