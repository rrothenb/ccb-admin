/**
 * Website class-schedule builder (pure).
 *
 * Everything is derived from the uploaded spreadsheets ONLY (the website is never
 * a data source):
 *   - teacher, level      ← Register ("Class N / Teacher" + level cell)
 *   - day/time, enrolled  ← Master (DAY/TIME column; count of CLASS NUMBER)
 * The roster config supplies the static facts NOT present in any spreadsheet
 * (capacity / fee / term); those stay null/'' until the org provides them, and
 * render as "—" — they are NOT taken from the website.
 *
 * Places Available = capacity − enrolled (only when capacity is known); Weeks
 * Left is calendar math from the term dates. Pure module (no GAS).
 */

import { MasterRow, RegisterRow } from '../detector/types';
import { RosterClass } from './roster';

/** One row of the rendered schedule. Fee/term-derived values may be unknown (''/null). */
export interface ScheduleRow {
  id: string;
  dayTime: string;
  teacher: string;
  level: string;
  enrolled: number;
  capacity: number;
  placesAvailable: number;
  fee: string;
  totalWeeks: number | null;
  weeksLeft: number | null;
}

/** Capacities supplied at generation time (defaults calibrated from enrolment + observed places). */
export interface Capacities {
  general: number;
  story: number;
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Normalizes a class id for keying/matching ("8 A" → "8a", "11 & 12" → "11&12"). */
function normClassId(c: string): string {
  return c.toLowerCase().replace(/\s+/g, '');
}

/** Returns the most frequent non-empty value in a list, or '' if none. */
function modal(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) {
    const t = (v || '').trim();
    if (!t) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/** Live (data-derived) facts about one class. */
interface ClassInfo {
  teacher: string;
  level: string;
  dayTime: string;
  enrolled: number;
}

/** Derives per-class teacher/level (Register) + enrolled/dayTime (Master), keyed by normalized id. */
export function deriveClassInfo(master: MasterRow[], register: RegisterRow[]): Map<string, ClassInfo> {
  const groupByClass = <T>(items: T[], keyOf: (t: T) => string): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const it of items) {
      const k = normClassId(keyOf(it));
      if (!k) continue;
      const arr = m.get(k);
      if (arr) arr.push(it);
      else m.set(k, [it]);
    }
    return m;
  };

  const regByClass = groupByClass(register, (r) => r.classId);
  const masterByClass = groupByClass(master, (m) => m.classNumber);

  const info = new Map<string, ClassInfo>();
  const ids = new Set<string>([...regByClass.keys(), ...masterByClass.keys()]);
  for (const id of ids) {
    const regs = regByClass.get(id) || [];
    const masters = masterByClass.get(id) || [];
    info.set(id, {
      teacher: modal(regs.map((r) => r.teacher)),
      level: modal(regs.map((r) => r.level)),
      dayTime: modal(masters.map((m) => m.dayTime)),
      enrolled: masters.length,
    });
  }
  return info;
}

/** Whole weeks remaining in a term, or null when the term dates are unknown. */
export function weeksLeft(termStart: string, totalWeeks: number | null, now: Date): number | null {
  if (!termStart || totalWeeks == null) return null;
  const start = new Date(termStart);
  if (isNaN(start.getTime())) return null;
  const end = start.getTime() + totalWeeks * MS_PER_WEEK;
  if (now.getTime() >= end) return 0;
  if (now.getTime() <= start.getTime()) return totalWeeks;
  return Math.ceil((end - now.getTime()) / MS_PER_WEEK);
}

/** Sorts class ids by their leading number, then lexically ("1","2","8a","8b","11","11&12","12"). */
function byClassOrder(a: ScheduleRow, b: ScheduleRow): number {
  const na = parseInt(a.id, 10);
  const nb = parseInt(b.id, 10);
  if (na !== nb) {
    if (isNaN(na)) return 1;
    if (isNaN(nb)) return -1;
    return na - nb;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Builds the schedule rows. Classes are the union of the roster and any class
 * seen in the live data (so a class present in the data but missing from the
 * roster still appears, just without capacity/fee/term).
 */
export function buildSchedule(
  roster: RosterClass[],
  master: MasterRow[],
  register: RegisterRow[],
  capacities: Capacities,
  now: Date = new Date()
): ScheduleRow[] {
  const info = deriveClassInfo(master, register);
  const rosterById = new Map(roster.map((r) => [normClassId(r.id), r]));

  const ids = new Set<string>([...rosterById.keys(), ...info.keys()]);
  const rows: ScheduleRow[] = [];
  for (const id of ids) {
    const r = rosterById.get(id);
    const live = info.get(id) || { teacher: '', level: '', dayTime: '', enrolled: 0 };
    // Story Time classes use the smaller capacity; everything else the general one.
    const capacity = r && r.storyTime ? capacities.story : capacities.general;
    const placesAvailable = Math.max(0, capacity - live.enrolled);
    rows.push({
      id,
      dayTime: (r && r.dayTimeOverride) || live.dayTime,
      teacher: live.teacher,
      level: live.level,
      enrolled: live.enrolled,
      capacity,
      placesAvailable,
      fee: r ? r.fee : '',
      totalWeeks: r ? r.totalWeeks : null,
      weeksLeft: r ? weeksLeft(r.termStart, r.totalWeeks, now) : null,
    });
  }

  return rows.sort(byClassOrder);
}
