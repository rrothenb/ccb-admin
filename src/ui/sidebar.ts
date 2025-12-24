/**
 * Context-aware sidebar service
 *
 * Detects the active sheet and shows the appropriate sidebar content
 * for that entity type (Borrowers, Media, or Loans).
 */

import { SheetName } from '../types';

/** Valid sheet names for sidebar context */
const VALID_SHEET_NAMES: SheetName[] = ['Borrowers', 'Media', 'Loans'];

/**
 * Gets the currently active sheet name if it's a valid entity sheet
 */
function getActiveSheetContext(): SheetName | null {
  const activeSheet = SpreadsheetApp.getActiveSheet();
  if (!activeSheet) {
    return null;
  }

  const sheetName = activeSheet.getName();

  if (VALID_SHEET_NAMES.includes(sheetName as SheetName)) {
    return sheetName as SheetName;
  }

  return null;
}

/**
 * Shows the sidebar with content appropriate for the current sheet
 */
function showContextSidebar(): void {
  const context = getActiveSheetContext();
  const html = createSidebarHtml(context);

  html.setTitle('Library Manager');
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Creates the sidebar HTML based on the current context
 */
function createSidebarHtml(context: SheetName | null): GoogleAppsScript.HTML.HtmlOutput {
  const template = HtmlService.createTemplateFromFile('Sidebar');
  template.context = context;
  template.contextLabel = context ? `${context} Actions` : 'No Context';

  return template.evaluate().setTitle('Library Manager');
}

/**
 * Refreshes the sidebar (called when sheet changes)
 */
function refreshSidebar(): void {
  showContextSidebar();
}

/**
 * Gets context info for the sidebar (called from client-side JS)
 */
function getSidebarContext(): { context: SheetName | null; label: string } {
  const context = getActiveSheetContext();
  return {
    context,
    label: context ? `${context} Actions` : 'Select a sheet (Borrowers, Media, or Loans)',
  };
}

/**
 * Helper to include other HTML files (for CSS/JS partials)
 */
function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// Export for use in other modules
export {
  getActiveSheetContext,
  showContextSidebar,
  createSidebarHtml,
  refreshSidebar,
  getSidebarContext,
  include,
};
