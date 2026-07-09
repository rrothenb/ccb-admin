/**
 * Master Membership parser (pure core).
 *
 * The Master is the enrolment/finance ledger — it OWNS membership, class
 * assignment, and the expiry driver (`DATE ENROLED`). This folds the validated
 * ingest-spike logic into a real parser that emits the detector's `MasterRow[]`.
 *
 * Tolerances (all seen on the real file): the header row can be row 1 or 2
 * (year-to-year drift); column labels vary ("DATE ENROLED" vs "DATE OF
 * ENROLLING"); section-marker rows sit among the data. Enrol dates that are
 * blank or a time-only cell (which converts to the 1899-12-30 epoch) are treated
 * as MISSING — the detector then blocks the sync (no fallback, decided).
 *
 * Pure module (operates on a string grid where the GAS layer has already
 * formatted Dates to ISO) so it's unit-testable without GAS.
 */

import { MasterRow } from '../detector/types';

/** Locates the header row (first of the top 4 rows containing "name"), or -1. */
function findHeaderRow(grid: string[][]): number {
  for (let r = 0; r < Math.min(4, grid.length); r++) {
    if (grid[r].some((c) => /name/i.test(c))) return r;
  }
  return -1;
}

/** Finds the first column whose header includes any of the given keywords, or -1. */
function findCol(headers: string[], ...keys: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    if (keys.some((k) => headers[i].includes(k))) return i;
  }
  return -1;
}

/**
 * Normalizes an enrol cell to an ISO date string, or '' if unusable. The GAS
 * layer formats real Dates to 'yyyy-MM-dd'; a time-only cell becomes an
 * 1899/1900 epoch date, so anything before 2000 is rejected as "no usable date".
 */
function usableEnrolDate(cell: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(cell.trim());
  if (!m) return '';
  return Number(m[1]) >= 2000 ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/**
 * Payment read from the "TOTAL PAID" column specifically (NOT an instalment
 * column like "PAYMENT 1" — a blank there just means "paid in one go", which
 * falsely reads as unpaid). Returns false only when the total is blank or zero;
 * undefined when the file has no total-paid column at all.
 */
function readPaid(row: string[], paidCol: number): boolean | undefined {
  if (paidCol < 0) return undefined;
  const raw = (row[paidCol] ?? '').trim();
  if (!raw) return false;
  const num = parseFloat(raw.replace(/[^\d.,-]/g, '').replace(',', '.'));
  if (!isNaN(num)) return num > 0;
  return true; // non-numeric but non-empty (e.g. "paid", "OK") → treat as paid
}

export interface MasterParseResult {
  members: MasterRow[];
  headerRow: number; // 1-based, for diagnostics
  columnMap: Record<string, number>;
  error?: string;
}

/** Parses the current-year Master tab's string grid into MasterRows. */
export function parseMasterGrid(grid: string[][]): MasterParseResult {
  const headerRowIdx = findHeaderRow(grid);
  if (headerRowIdx < 0) {
    return { members: [], headerRow: -1, columnMap: {}, error: 'Could not locate a header row containing "NAME".' };
  }

  const headers = grid[headerRowIdx].map((c) => c.toLowerCase().replace(/\s+/g, ' ').trim());
  const columnMap = {
    name: findCol(headers, 'name'),
    enrolled: findCol(headers, 'enrol'),
    classNo: findCol(headers, 'class'),
    dayTime: findCol(headers, 'day', 'time'),
    status: findCol(headers, 'status'),
    renewal: findCol(headers, 'renewal', 'new'),
    // The cumulative total, not an instalment column. Requires BOTH words so it
    // matches "TOTAL PAID €" and not "PAYMENT 1".
    paid: headers.findIndex((h) => h.includes('total') && h.includes('paid')),
  };
  if (columnMap.name < 0) {
    return { members: [], headerRow: headerRowIdx + 1, columnMap, error: 'No NAME column found.' };
  }

  const members: MasterRow[] = [];
  for (let r = headerRowIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    const rawName = (row[columnMap.name] ?? '').trim();
    if (!rawName) continue;
    // Skip section markers / non-name rows ("MASTER FILE", "Excel", banners).
    if (!/[a-z]/i.test(rawName) || /master|membership|excel/i.test(rawName)) continue;

    const enrolRaw = columnMap.enrolled >= 0 ? (row[columnMap.enrolled] ?? '') : '';
    members.push({
      rawName,
      enrolDate: usableEnrolDate(enrolRaw),
      classNumber: columnMap.classNo >= 0 ? (row[columnMap.classNo] ?? '').trim() : '',
      dayTime: columnMap.dayTime >= 0 ? (row[columnMap.dayTime] ?? '').trim() : '',
      status: (columnMap.status >= 0 ? (row[columnMap.status] ?? '') : '').toLowerCase().trim(),
      renewalType: (columnMap.renewal >= 0 ? (row[columnMap.renewal] ?? '') : '').toLowerCase().trim(),
      paid: readPaid(row, columnMap.paid),
      rowNumber: r + 1, // 1-based sheet row for pointing the admin at it
    });
  }

  return { members, headerRow: headerRowIdx + 1, columnMap };
}
