/**
 * Website class-schedule generator (GAS side).
 *
 * Builds the schedule from the uploaded Master + Register (the only data
 * sources) and rewrites a single canonical Google Doc with a stable PDF-export
 * URL. Teacher/level come from the Register, day/time + enrolment from the
 * Master; capacity/fee/term come from the roster config (rendered "—" until the
 * org supplies them — never taken from the website). Reads only.
 */

import { parseMasterGrid } from '../ingest/master';
import { parseRegisterTabs } from '../ingest/register';
import { uploadedXlsxToSheetId, trashSheet, sheetToStringGrid } from '../ingest/xlsx';
import { buildSchedule, ScheduleRow } from './build';
import { CLASS_ROSTER } from './roster';
import { logAdmin } from '../log';

const SCHEDULE_DOC_ID_PROPERTY = 'SCHEDULE_DOC_ID';
const SCHEDULE_DOC_NAME = 'CCB Class Schedule';

export interface ScheduleResult {
  success: boolean;
  error?: string;
  docUrl?: string;
  pdfUrl?: string;
  generatedAt?: string;
  rows?: ScheduleRow[];
}

/** Picks the current-year Master tab (same tolerant selection as the sync). */
function pickMasterTab(ss: GoogleAppsScript.Spreadsheet.Spreadsheet): GoogleAppsScript.Spreadsheet.Sheet {
  const sheets = ss.getSheets();
  const byName = (re: RegExp) => sheets.find((s) => re.test(s.getName()));
  return byName(/master file.*2[67]\s*[-/]?\s*2[67]/i) || byName(/master file/i) || sheets[0];
}

/** Gets (or creates) the canonical schedule Doc so reruns keep the same URL. */
function openOrCreateScheduleDoc(): GoogleAppsScript.Document.Document {
  const props = PropertiesService.getScriptProperties();
  const storedId = props.getProperty(SCHEDULE_DOC_ID_PROPERTY);
  if (storedId) {
    try {
      return DocumentApp.openById(storedId);
    } catch (e) {
      Logger.log(`Schedule Doc ${storedId} not accessible (${e}); creating a fresh one.`);
    }
  }
  const doc = DocumentApp.create(SCHEDULE_DOC_NAME);
  props.setProperty(SCHEDULE_DOC_ID_PROPERTY, doc.getId());
  return doc;
}

/** "—" for unknown numbers so the table never shows a misleading 0/blank. */
function dash(v: number | null): string {
  return v == null ? '—' : String(v);
}

/**
 * Rebuilds the class-schedule Doc from the uploaded Master + Register.
 * Idempotent — rewrites the same canonical Doc so its PDF-export URL is stable.
 */
function generateSchedule(
  masterB64: string,
  masterName: string,
  registerB64: string,
  registerName: string,
  generalCapacity?: number,
  storyCapacity?: number
): ScheduleResult {
  let masterSheetId = '';
  let registerSheetId = '';
  try {
    if (!masterB64 || !registerB64) {
      return { success: false, error: 'Both the Master file and the Register file are required.' };
    }
    const capacities = {
      general: Number(generalCapacity) > 0 ? Number(generalCapacity) : 10,
      story: Number(storyCapacity) > 0 ? Number(storyCapacity) : 8,
    };

    masterSheetId = uploadedXlsxToSheetId(masterB64, masterName, 'schedule-master');
    const masterTab = pickMasterTab(SpreadsheetApp.openById(masterSheetId));
    const masterParse = parseMasterGrid(sheetToStringGrid(masterTab));
    if (masterParse.error) return { success: false, error: `Master file: ${masterParse.error}` };

    registerSheetId = uploadedXlsxToSheetId(registerB64, registerName, 'schedule-register');
    const registerGrids = SpreadsheetApp.openById(registerSheetId).getSheets().map((s) => sheetToStringGrid(s));
    const register = parseRegisterTabs(registerGrids);

    const rows = buildSchedule(CLASS_ROSTER, masterParse.members, register, capacities, new Date());

    const doc = openOrCreateScheduleDoc();
    const body = doc.getBody();
    body.clear();

    const generatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMM yyyy, HH:mm');
    body.appendParagraph('CCB English Conversation Classes').setHeading(DocumentApp.ParagraphHeading.TITLE);

    const tableRows: string[][] = [['Class', 'Day / Time', 'Teacher', 'Level', 'Places Available', 'Weeks Left', 'Fee']];
    for (const r of rows) {
      tableRows.push([
        r.id,
        r.dayTime || '—',
        r.teacher || '—',
        r.level || '—',
        r.placesAvailable === 0 ? 'Full' : String(r.placesAvailable),
        dash(r.weeksLeft),
        r.fee || '—',
      ]);
    }
    const table = body.appendTable(tableRows);
    try {
      const headerRow = table.getRow(0);
      for (let c = 0; c < headerRow.getNumCells(); c++) headerRow.getCell(c).editAsText().setBold(true);
    } catch (e) {
      Logger.log(`Header styling skipped: ${e}`);
    }

    doc.saveAndClose();

    const file = DriveApp.getFileById(doc.getId());
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const pdfUrl = `https://docs.google.com/document/d/${doc.getId()}/export?format=pdf`;

    logAdmin(
      `Generated class schedule: ${rows.length} classes (${masterParse.members.length} enrolments; capacity ${capacities.general}/story ${capacities.story})`
    );

    return { success: true, docUrl: doc.getUrl(), pdfUrl, generatedAt, rows };
  } catch (e) {
    return { success: false, error: String(e) };
  } finally {
    if (masterSheetId) trashSheet(masterSheetId);
    if (registerSheetId) trashSheet(registerSheetId);
  }
}

export { generateSchedule };
