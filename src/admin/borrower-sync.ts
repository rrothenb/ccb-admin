/**
 * Borrowers write spoke (GAS side).
 *
 * The one-way projection of the current-year cohort back INTO the app's own
 * Borrowers sheet — the ONLY place the sync writes to the app's data. It does
 * exactly two things, and only for names it is certain about:
 *   - ADD    a Master person missing from Borrowers (name + Register email + expiry);
 *   - UPDATE the expiry of a Master person already in Borrowers (expiry field only).
 *
 * Mirrors the Contacts spoke's preview-first rhythm:
 *   - previewBorrowerWrites(...)  READ-ONLY: returns the add/update/skip plan.
 *   - applyBorrowerWrites(...)    WRITES: adds/updates via the Borrower service.
 *
 * The pure planner (borrower-plan.ts) decides what is safe; anything ambiguous
 * (fuzzy/bridge match, colliding or shared name/email) is never written and never
 * silently dropped — it comes back in `plan.skipped` for the admin to fix. No
 * Borrower is ever deleted, and updates touch ONLY the expiry field.
 */

import { reconcile, DetectorInput } from './detector';
import { AppMember } from './detector/types';
import { parseMasterGrid } from './ingest/master';
import { parseRegisterTabs } from './ingest/register';
import { uploadedXlsxToSheetId, trashSheet, sheetToStringGrid } from './ingest/xlsx';
import { membershipExpiry } from './expiry';
import { planBorrowerWrites, isoToHuman, BorrowerWritePlan } from './borrower-plan';
import { getBorrowerService } from '../services/borrowers';
import { logAdmin } from './log';

export interface BorrowerWriteResult {
  success: boolean;
  error?: string;
  plan?: BorrowerWritePlan;
  stats?: {
    masterMembers: number;
    appMembers: number;
    computedExpiry: string;
    masterTab: string;
    applied?: { added: number; updated: number; failed: number };
    /** Per-record failures during apply (name → message), so nothing fails silently. */
    failures?: { name: string; error: string }[];
  };
}

/** Picks the current-year Master tab (same tolerant selection as the sync). */
function pickMasterTab(ss: GoogleAppsScript.Spreadsheet.Spreadsheet): GoogleAppsScript.Spreadsheet.Sheet {
  const sheets = ss.getSheets();
  const byName = (re: RegExp) => sheets.find((s) => re.test(s.getName()));
  return byName(/master file.*2[67]\s*[-/]?\s*2[67]/i) || byName(/master file/i) || sheets[0];
}

/** Loads the app's members (Borrowers) as detector AppMembers. */
function loadAppMembers(): AppMember[] {
  const res = getBorrowerService().getAll();
  if (!res.success || !res.data) throw new Error(`Could not read app members: ${res.error || 'unknown error'}`);
  return res.data.map((b) => ({ id: String(b.id), rawName: b.name, email: b.email || '', expiryDate: b.expiryDate || '' }));
}

/** Parses the uploads + Borrowers into a write plan (no side effects). */
function computePlan(
  masterB64: string,
  masterName: string,
  registerB64: string,
  registerName: string
): { plan: BorrowerWritePlan; masterCount: number; appCount: number; computedExpiry: string; masterTab: string } {
  let masterSheetId = '';
  let registerSheetId = '';
  try {
    masterSheetId = uploadedXlsxToSheetId(masterB64, masterName, 'borrower-master');
    const masterTab = pickMasterTab(SpreadsheetApp.openById(masterSheetId));
    const masterParse = parseMasterGrid(sheetToStringGrid(masterTab));
    if (masterParse.error) throw new Error(`Master file: ${masterParse.error}`);

    registerSheetId = uploadedXlsxToSheetId(registerB64, registerName, 'borrower-register');
    const register = parseRegisterTabs(SpreadsheetApp.openById(registerSheetId).getSheets().map((s) => sheetToStringGrid(s)));

    const app = loadAppMembers();
    const classIds = Array.from(new Set(register.map((r) => r.classId).filter(Boolean)));
    const input: DetectorInput = { master: masterParse.members, register, app, roster: { validClassIds: classIds } };
    const ctx = reconcile(input);

    const computedExpiry = membershipExpiry(masterTab.getName());
    return {
      plan: planBorrowerWrites(ctx, computedExpiry),
      masterCount: masterParse.members.length,
      appCount: app.length,
      computedExpiry,
      masterTab: masterTab.getName(),
    };
  } finally {
    if (masterSheetId) trashSheet(masterSheetId);
    if (registerSheetId) trashSheet(registerSheetId);
  }
}

/** READ-ONLY: returns the Borrowers write plan without touching the sheet. */
function previewBorrowerWrites(
  masterB64: string,
  masterName: string,
  registerB64: string,
  registerName: string
): BorrowerWriteResult {
  try {
    if (!masterB64 || !registerB64) return { success: false, error: 'Both the Master file and the Register file are required.' };
    const { plan, masterCount, appCount, computedExpiry, masterTab } = computePlan(masterB64, masterName, registerB64, registerName);
    logAdmin(
      `Previewed Borrowers writes: ${plan.toAdd.length} add / ${plan.toUpdate.length} update / ` +
        `${plan.alreadyCurrentCount} unchanged / ${plan.skipped.length} skipped (uniform expiry ${computedExpiry})`
    );
    return { success: true, plan, stats: { masterMembers: masterCount, appMembers: appCount, computedExpiry, masterTab } };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * WRITES: applies the plan to the Borrowers sheet — adds new members and updates
 * expiries. Guarded against an empty/garbage upload; only ever appends or changes
 * the expiry field, never deletes. Each record write is isolated so one failure
 * doesn't abort the rest, and every failure is reported (never silent).
 */
function applyBorrowerWrites(
  masterB64: string,
  masterName: string,
  registerB64: string,
  registerName: string
): BorrowerWriteResult {
  try {
    if (!masterB64 || !registerB64) return { success: false, error: 'Both the Master file and the Register file are required.' };
    const { plan, masterCount, appCount, computedExpiry, masterTab } = computePlan(masterB64, masterName, registerB64, registerName);

    // Refuse to write on an upload that resolved to nothing — a sign of a bad file.
    if (masterCount === 0) {
      return { success: false, error: 'No members resolved from the Master upload — refusing to write to Borrowers.' };
    }

    // All-or-nothing: if anything is ambiguous/incomplete, make NO changes.
    if (plan.skipped.length > 0) {
      return {
        success: false,
        error:
          `${plan.skipped.length} member(s) are ambiguous or incomplete, so no changes were made ` +
          `(writes are all-or-nothing). Resolve them — see the preview — and re-run detection first.`,
      };
    }

    const svc = getBorrowerService();
    const humanExpiry = isoToHuman(plan.targetExpiryISO);
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM d, yyyy');
    const failures: { name: string; error: string }[] = [];
    let added = 0;
    let updated = 0;

    for (const a of plan.toAdd) {
      try {
        const res = svc.createBorrower(a.name, a.email, '', '', '', '', '', humanExpiry, today);
        if (!res.success) throw new Error(res.error || 'unknown error');
        added++;
      } catch (e) {
        failures.push({ name: a.name, error: String((e as Error).message || e) });
      }
    }

    for (const u of plan.toUpdate) {
      try {
        const res = svc.update(u.id, { expiryDate: humanExpiry });
        if (!res.success) throw new Error(res.error || 'unknown error');
        updated++;
      } catch (e) {
        failures.push({ name: u.name, error: String((e as Error).message || e) });
      }
    }

    logAdmin(
      `Borrowers writes applied: +${added} added, ~${updated} expiry-updated, ${failures.length} failed, ` +
        `${plan.skipped.length} skipped (ambiguous) · expiry ${computedExpiry}`
    );

    return {
      success: true,
      plan,
      stats: {
        masterMembers: masterCount,
        appMembers: appCount,
        computedExpiry,
        masterTab,
        applied: { added, updated, failed: failures.length },
        failures,
      },
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export { previewBorrowerWrites, applyBorrowerWrites };
