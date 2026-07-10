/**
 * Register parser (pure core).
 *
 * The Register is a per-teacher attendance workbook — freeform grids that drift
 * in column layout from tab to tab (a standard roster grid, plus Rebecca's kids
 * layout, plus combined-sibling rows). It is downstream/attendance, NOT the
 * authority for class assignment (the Master's CLASS NUMBER is), but it is where
 * we recover two things the Master lacks: the household **email** (feeds the
 * email bridge) and a cross-check of **class/level/teacher** (feeds the website
 * schedule + the class-disagreement finding).
 *
 * Strategy is layout-agnostic (validated in the spike, ~136 students / 13 class
 * blocks on the real file): walk each tab top-to-bottom, track the current
 * "Class N / Teacher" header as context, and for every subsequent row pull out a
 * name + email regardless of which columns they sit in. Combined sibling rows
 * ("SURNAME, Alban / Maxence") are kept verbatim — the detector splits them.
 *
 * Pure module (operates on a string grid) so it's unit-testable without GAS.
 */

import { RegisterRow } from '../detector/types';

/** An email anywhere in a cell (permissive — the grid has stray punctuation). */
const EMAIL_RE = /[^\s,;<>()]+@[^\s,;<>()]+\.[^\s,;<>()]+/;

/**
 * "Class 1", "Class 8a", "Class 11 & 12" — captures the id, tolerating spacing.
 * Anchored to the START of the cell so a real header ("Class 9 / Paula") matches
 * but an in-cell mention in a comment ("From Class 4", "moved to Class 7") does
 * NOT — otherwise a stray comment would switch the class context mid-block.
 */
const CLASS_HEADER_RE = /^\s*class\s*([0-9]+\s*[a-z]?(?:\s*&\s*[0-9]+\s*[a-z]?)?)/i;

/** Recognizable level tokens (CEFR + plain-English + kids). Best-effort. */
const LEVEL_RE =
  /\b(beginners?|elementary|pre[-\s]?intermediate|upper[-\s]?intermediate|intermediate|advanced|proficiency|cefr\s*[abc][12]|[abc][12]\+?)\b/i;

/** Header/annotation words a NAME cell must not start with. */
const NON_NAME_RE =
  /^(class|teacher|prof|professeur|level|niveau|total|semaine|week|date|name|nom|email|e-mail|mail|present|absent|attendance|note|remarque|fee|tarif|places?)\b/i;

/** Normalizes a class id: lowercase, drop internal spaces ("8 a" → "8a", "11 & 12" → "11&12"). */
function normClassId(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '');
}

/** Extracts the class id + teacher from a header row, or null if the row isn't a header. */
function parseClassHeader(row: string[]): { classId: string; teacher: string } | null {
  for (let i = 0; i < row.length; i++) {
    const cell = row[i];
    const m = CLASS_HEADER_RE.exec(cell);
    if (!m) continue;

    const classId = normClassId(m[1]);
    let teacher = '';

    // Teacher after a "/" in the same cell: "Class 1 / Sue Smith".
    const slash = cell.indexOf('/');
    if (slash >= 0) {
      teacher = cell.slice(slash + 1).trim();
    }
    // Otherwise the next non-empty, non-level cell in the header row.
    if (!teacher) {
      for (let j = i + 1; j < row.length; j++) {
        const c = row[j].trim();
        if (c && !LEVEL_RE.test(c) && !/^\d+$/.test(c)) {
          teacher = c;
          break;
        }
      }
    }
    return { classId, teacher };
  }
  return null;
}

/** Kids age-marker in a level/description cell: "6/7 yrs", "7Yrs", "7 ans". */
export const KIDS_LEVEL_RE = /\b\d+\s*(?:\/\s*\d+\s*)?(?:yrs?|years?|ans)\b/i;

/**
 * Captures the class's level/description cell. Adult tabs put it beside the time
 * ("U Intermediate (B2+)"); the kids layout puts it a couple rows below the
 * header ("6/7 yrs - Good English"). Scans a small window after the header for
 * the first cell that reads as a level (CEFR/named) or a kids age line, stopping
 * once the student rows (which carry emails) begin. Returns the whole cell.
 */
function detectLevel(grid: string[][], headerRow: number): string {
  for (let r = headerRow; r < Math.min(headerRow + 6, grid.length); r++) {
    const row = grid[r];
    if (r > headerRow && row.some((c) => c.includes('@'))) break; // student rows started
    for (const cell of row) {
      const t = cell.trim();
      if (LEVEL_RE.test(t) || KIDS_LEVEL_RE.test(t)) return t;
    }
  }
  return '';
}

/**
 * Parses the Register **Summary** tab's professor list for the teachers marked
 * "Children" (vs "Adult"), returning their first names (lowercased). Used to
 * recognize the Story Time / children's classes. E.g. a row
 * `[…, "Rebecca Grossberg", "Children", "2"]` → adds "rebecca".
 */
export function parseChildrenTeachers(grid: string[][]): Set<string> {
  const out = new Set<string>();
  for (const row of grid) {
    for (let i = 0; i < row.length; i++) {
      if (!/^children$/i.test((row[i] || '').trim())) continue;
      // The teacher name is the nearest non-empty cell to the left.
      for (let j = i - 1; j >= 0; j--) {
        const name = (row[j] || '').trim();
        if (name) {
          const first = name.toLowerCase().split(/\s+/)[0];
          if (first) out.add(first);
          break;
        }
      }
    }
  }
  return out;
}

/** True if a cell plausibly holds a person's name (letters + comma or two words), not a mark/header. */
function looksLikeName(cell: string): boolean {
  const s = cell.trim();
  if (s.length < 2 || NON_NAME_RE.test(s)) return false;
  if (EMAIL_RE.test(s)) return false;
  // Annotation/comment cells that mention a class ("From Class 4") aren't people.
  if (/\bclass\b/i.test(s)) return false;
  if (!/[a-zA-Z]{2,}/.test(s)) return false; // needs a real word, not "X"/"1"/a date
  // A "Surname, First" has a comma; a "First Last" has a space between two words.
  return /,/.test(s) || /[a-zA-Z]{2,}\s+[a-zA-Z]/.test(s);
}

/** Pulls the (name, email) out of a data row, or null if there's no usable name. */
function extractPerson(row: string[]): { name: string; email: string } | null {
  let email = '';
  let emailIdx = -1;
  for (let i = 0; i < row.length; i++) {
    const m = EMAIL_RE.exec(row[i]);
    if (m) {
      email = m[0];
      emailIdx = i;
      break;
    }
  }

  let name = '';
  for (let i = 0; i < row.length; i++) {
    if (i === emailIdx) continue;
    if (looksLikeName(row[i])) {
      name = row[i].trim();
      break;
    }
  }

  if (!name) return null;
  return { name, email };
}

/**
 * Parses one Register tab's string grid into RegisterRows. Rows before the first
 * class header (title/legend rows) are skipped, since we can't attribute a class.
 */
export function parseRegisterGrid(grid: string[][]): RegisterRow[] {
  const out: RegisterRow[] = [];
  let ctx: { classId: string; teacher: string; level: string } | null = null;

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];

    const header = parseClassHeader(row);
    if (header) {
      ctx = { ...header, level: detectLevel(grid, r) };
      continue;
    }

    if (!ctx) continue; // still in a preamble before any class block

    const person = extractPerson(row);
    if (!person) continue;

    out.push({
      rawName: person.name,
      email: person.email,
      classId: ctx.classId,
      teacher: ctx.teacher,
      level: ctx.level,
    });
  }

  return out;
}

/** Parses many tabs (one grid each) and concatenates — the whole Register workbook. */
export function parseRegisterTabs(grids: string[][][]): RegisterRow[] {
  return grids.flatMap((g) => parseRegisterGrid(g));
}
