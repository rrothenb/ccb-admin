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

/** "Class 1", "Class 8a", "Class 11 & 12" — captures the id, tolerating spacing. */
const CLASS_HEADER_RE = /class\s*([0-9]+\s*[a-z]?(?:\s*&\s*[0-9]+\s*[a-z]?)?)/i;

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

/** Finds a level token anywhere in a row, or '' — used on the header row and the row below it. */
function findLevel(row: string[]): string {
  for (const cell of row) {
    const m = LEVEL_RE.exec(cell);
    if (m) return m[0];
  }
  return '';
}

/** True if a cell plausibly holds a person's name (letters + comma or two words), not a mark/header. */
function looksLikeName(cell: string): boolean {
  const s = cell.trim();
  if (s.length < 2 || NON_NAME_RE.test(s)) return false;
  if (EMAIL_RE.test(s)) return false;
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
      // Level may be on the header row or the row directly below it.
      const level = findLevel(row) || (r + 1 < grid.length ? findLevel(grid[r + 1]) : '');
      ctx = { ...header, level };
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
