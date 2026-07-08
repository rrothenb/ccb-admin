/**
 * Admin web app entry point (served from the separate admin-only Apps Script
 * project). This companion app holds the sensitive `contacts` (and Drive)
 * scopes so the main public web app never has to — keeping regular users'
 * consent screen unchanged. Only the master account ever authorizes this one.
 */

/**
 * Served when the admin visits the admin web app URL.
 */
function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createTemplateFromFile('Admin')
    .evaluate()
    .setTitle('CCB Admin Sync')
    .setFaviconUrl('https://www.ccb-lille.com/wp-content/uploads/2024/02/cropped-favicon-32x32.png')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Helper to include other HTML files (for CSS/JS partials). Same helper as the
 * main app's webapp.ts.
 */
function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

export { doGet, include };
