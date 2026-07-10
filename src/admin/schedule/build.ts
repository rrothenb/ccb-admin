/**
 * Class-schedule builder (pure).
 *
 * Everything comes from the uploaded spreadsheets ONLY — nothing is hardcoded:
 *   - teacher, level      ← Register ("Class N / Teacher" + level cell)
 *   - day/time, enrolled  ← Master (DAY/TIME column; count of CLASS NUMBER)
 *   - which classes exist  ← the union of classes seen in Master + Register
 *
 * Capacity is the one thing not in the sheets, so it's supplied at generation
 * time (a general capacity + a Story Time capacity). Story Time (children's)
 * classes are recognized from the DATA via two signals, and a warning is raised
 * when they disagree:
 *   (1) the teacher is listed as "Children" in the Register Summary tab;
 *   (2) the class level cell has a kids age-marker ("6/7 yrs", "7Yrs").
 *
 * Fee and term/weeks are not in the sheets and are skipped for now.
 * Pure module (no GAS).
 */

import { MasterRow, RegisterRow } from '../detector/types';
import { splitClassIds } from '../classid';
import { KIDS_LEVEL_RE } from '../ingest/register';

/** One row of the rendered schedule. */
export interface ScheduleRow {
  id: string;
  dayTime: string;
  teacher: string;
  level: string;
  enrolled: number;
  capacity: number;
  placesAvailable: number;
  storyTime: boolean;
}

/** Capacities supplied at generation time. */
export interface Capacities {
  general: number;
  story: number;
}

/** Build output: the rows plus any advisory warnings (e.g. Story Time signal conflicts). */
export interface ScheduleBuild {
  rows: ScheduleRow[];
  warnings: string[];
}

/** First name (lowercased) of a teacher, for matching against the Summary's Children list. */
function firstName(name: string): string {
  return (name || '').trim().toLowerCase().split(/\s+/)[0] || '';
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
  // A class-number cell can name several classes ("11 & 12"); an item counts
  // toward EACH of its classes, so classes 11 and 12 both get the member.
  const groupByClass = <T>(items: T[], rawOf: (t: T) => string): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const it of items) {
      for (const k of splitClassIds(rawOf(it))) {
        const arr = m.get(k);
        if (arr) arr.push(it);
        else m.set(k, [it]);
      }
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

/** Sorts class ids by their leading number, then lexically ("1","2","8a","8b","11","12"). */
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
 * Builds the schedule from the uploaded data + the two capacities. `childrenTeachers`
 * is the set of Story Time teacher first names parsed from the Register Summary tab.
 */
export function buildSchedule(
  master: MasterRow[],
  register: RegisterRow[],
  capacities: Capacities,
  childrenTeachers: Set<string>,
  _now: Date = new Date()
): ScheduleBuild {
  const info = deriveClassInfo(master, register);
  const rows: ScheduleRow[] = [];
  const warnings: string[] = [];

  for (const [id, live] of info) {
    // Story Time signals: (1) teacher is a "Children" teacher per the Summary,
    // (2) the level cell carries a kids age-marker. Warn if they disagree.
    const byTeacher = live.teacher ? childrenTeachers.has(firstName(live.teacher)) : false;
    const byLevel = KIDS_LEVEL_RE.test(live.level);
    const storyTime = byTeacher || byLevel;
    if (byTeacher !== byLevel) {
      warnings.push(
        `Class ${id} (${live.teacher || '?'}): Story Time signals disagree — ` +
          `teacher-category says ${byTeacher ? 'yes' : 'no'}, level "${live.level || '—'}" says ${byLevel ? 'yes' : 'no'}. ` +
          `Treating as ${storyTime ? 'Story Time' : 'adult'}; please confirm.`
      );
    }

    const capacity = storyTime ? capacities.story : capacities.general;
    rows.push({
      id,
      dayTime: live.dayTime,
      teacher: live.teacher,
      level: live.level,
      enrolled: live.enrolled,
      capacity,
      placesAvailable: Math.max(0, capacity - live.enrolled),
      storyTime,
    });
  }

  rows.sort(byClassOrder);
  return { rows, warnings };
}
