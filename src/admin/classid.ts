/**
 * Class-id helpers shared by the detector, contacts projection, and schedule.
 *
 * A Master CLASS NUMBER can name MORE THAN ONE class: "11 & 12" means the member
 * is enrolled in BOTH class 11 and class 12 (two separate classes, two time
 * slots), NOT a single combined "11&12" class. `splitClassIds` expands that into
 * the individual class ids so every consumer counts/labels/checks per class.
 */

/** Normalizes a class id: lowercase, strip whitespace ("8 A" → "8a", "11 & 12" → "11&12"). */
export function normClassId(c: string): string {
  return (c || '').toLowerCase().replace(/\s+/g, '');
}

/**
 * Splits a class-number cell into its individual normalized class ids.
 *   "11 & 12" → ["11", "12"]     (enrolled in two classes)
 *   "8a"      → ["8a"]
 *   "11, 12"  → ["11", "12"]
 *   ""        → []
 */
export function splitClassIds(classNumber: string): string[] {
  return normClassId(classNumber)
    .split(/[&,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
