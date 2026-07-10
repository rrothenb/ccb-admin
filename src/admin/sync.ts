/**
 * Membership sync orchestrator (GAS side).
 *
 * This is the admin-triggered detection phase: the admin uploads the two
 * spreadsheets, we ingest all three sources (Master xlsx, Register xlsx,
 * Borrowers via the service), reconcile them through the pure detector, and
 * return the tiered worklist. It performs NO writes — expiry writes + the
 * Contacts/website projection come after the admin clears/acknowledges the
 * worklist (next construction step).
 *
 * The pure cores (detector/*, ingest/master, ingest/register) do the real work
 * and are unit-tested; this file is the thin GAS glue that reads Drive/Sheets,
 * loads Borrowers, persists resolved-finding keys, and audit-logs the run.
 */

import { runDetector, reconcile, DetectorReport, DetectorInput } from './detector';
import { AppMember, MasterRow, RegisterRow } from './detector/types';
import { parseMasterGrid } from './ingest/master';
import { parseRegisterTabs } from './ingest/register';
import { membershipExpiry } from './expiry';
import { planExpiryWrites, ChangePlan } from './plan';
import { uploadedXlsxToSheetId, trashSheet, sheetToStringGrid } from './ingest/xlsx';
import { getBorrowerService } from '../services/borrowers';
import { logAdmin } from './log';

/** What the client receives from a sync detection run. */
export interface SyncDetectResult {
  success: boolean;
  error?: string;
  report?: DetectorReport;
  /** Preview of the app-member changes a future write phase would make (nothing is written now). */
  plan?: ChangePlan;
  stats?: {
    masterMembers: number;
    registerStudents: number;
    appMembers: number;
    classIds: string[];
    masterTab: string;
    masterHeaderRow: number;
    /** The uniform expiry every synced member will receive (school-year start + 1yr). */
    computedExpiry: string;
  };
}

/** Picks the current-year Master tab (mirrors the ingest spike's tolerant selection). */
function pickMasterTab(ss: GoogleAppsScript.Spreadsheet.Spreadsheet): GoogleAppsScript.Spreadsheet.Sheet {
  const sheets = ss.getSheets();
  const byName = (re: RegExp) => sheets.find((s) => re.test(s.getName()));
  return (
    byName(/master file.*2[67]\s*[-/]?\s*2[67]/i) ||
    byName(/master file/i) ||
    sheets[0]
  );
}

/** Loads the app's members (Borrowers) as detector AppMembers. */
function loadAppMembers(): AppMember[] {
  const res = getBorrowerService().getAll();
  if (!res.success || !res.data) {
    throw new Error(`Could not read app members: ${res.error || 'unknown error'}`);
  }
  return res.data.map((b) => ({
    id: String(b.id),
    rawName: b.name,
    email: b.email || '',
    expiryDate: b.expiryDate || '',
  }));
}

/**
 * Client entry point: runs the detector over the two uploaded spreadsheets +
 * the app's members, and returns the worklist. No writes.
 */
function runMembershipSync(
  masterB64: string,
  masterName: string,
  registerB64: string,
  registerName: string
): SyncDetectResult {
  let masterSheetId = '';
  let registerSheetId = '';
  try {
    if (!masterB64 || !registerB64) {
      return { success: false, error: 'Both the Master file and the Register file are required.' };
    }

    // --- Master ---
    masterSheetId = uploadedXlsxToSheetId(masterB64, masterName, 'sync-master');
    const masterSs = SpreadsheetApp.openById(masterSheetId);
    const masterTab = pickMasterTab(masterSs);
    const masterParse = parseMasterGrid(sheetToStringGrid(masterTab));
    if (masterParse.error) {
      return { success: false, error: `Master file: ${masterParse.error}` };
    }
    const master: MasterRow[] = masterParse.members;

    // --- Register (all tabs) ---
    registerSheetId = uploadedXlsxToSheetId(registerB64, registerName, 'sync-register');
    const registerSs = SpreadsheetApp.openById(registerSheetId);
    const registerGrids = registerSs.getSheets().map((s) => sheetToStringGrid(s));
    const register: RegisterRow[] = parseRegisterTabs(registerGrids);

    // --- App members ---
    const app = loadAppMembers();

    // Interim roster: bootstrap valid class ids from the Register until the
    // ratified canonical roster is stored. Keeps nonexistent-class meaningful
    // without falsely flagging classes the Register clearly knows about.
    const classIds = Array.from(new Set(register.map((r) => r.classId).filter(Boolean)));

    const input: DetectorInput = { master, register, app, roster: { validClassIds: classIds } };
    // Reconcile once and share the context with both the rules and the change plan.
    const ctx = reconcile(input);
    const report = runDetector(input, { context: ctx });

    // Uniform expiry for the whole cohort — school-year start + 1yr, from the tab name.
    const computedExpiry = membershipExpiry(masterTab.getName());
    const plan = planExpiryWrites(ctx, computedExpiry);

    logAdmin(
      `Sync detection run: ${master.length} Master members, ${register.length} Register students, ` +
        `${app.length} app members → ${report.counts.block} block / ${report.counts.confirm} confirm / ${report.counts.fyi} fyi ` +
        `(uniform expiry ${computedExpiry})`
    );

    return {
      success: true,
      report,
      plan,
      stats: {
        masterMembers: master.length,
        registerStudents: register.length,
        appMembers: app.length,
        classIds,
        masterTab: masterTab.getName(),
        masterHeaderRow: masterParse.headerRow,
        computedExpiry,
      },
    };
  } catch (e) {
    return { success: false, error: String(e) };
  } finally {
    if (masterSheetId) trashSheet(masterSheetId);
    if (registerSheetId) trashSheet(registerSheetId);
  }
}

export { runMembershipSync };
