/**
 * Membership expiry policy (pure).
 *
 * Expiry is tied to the SCHOOL YEAR, not to when an individual enrolled or paid:
 * every member of a given year's Master gets the SAME expiry — one year after
 * that school year starts. This is deliberate — a member who paid in June
 * mustn't be penalised with an earlier expiry than one who paid in September.
 * (This replaces the old "enrol date + 1 year, block if the enrol date is
 * missing" rule; the Master's DATE ENROLED no longer drives expiry at all.)
 *
 * The school year is read from the Master tab name ("Master File (26-27)" →
 * starts 2026), which is how the org already labels the file.
 */

/** The school year is assumed to start on 1 September. Exact day isn't important. */
export const SCHOOL_YEAR_START_MONTH = 9; // 1-based
export const SCHOOL_YEAR_START_DAY = 1;

/**
 * Derives the starting calendar year of the school year from a Master tab name
 * like "Master File (26-27)" or "Master 2026-2027" → 2026. Returns null if the
 * name carries no recognizable year.
 */
export function schoolYearStartYear(tabName: string): number | null {
  // Four-digit form first: "2026-2027" / "2026/27".
  const four = /\b(20\d{2})\s*[-/]\s*\d{2,4}\b/.exec(tabName);
  if (four) return Number(four[1]);
  // Two-digit form: "(26-27)" → 2026.
  const two = /\b(\d{2})\s*[-/]\s*\d{2}\b/.exec(tabName);
  if (two) return 2000 + Number(two[1]);
  return null;
}

/** The uniform expiry (ISO yyyy-MM-dd) for a school year that starts in `startYear`: startYear+1, 1 Sept. */
export function expiryForSchoolYear(startYear: number): string {
  const mm = String(SCHOOL_YEAR_START_MONTH).padStart(2, '0');
  const dd = String(SCHOOL_YEAR_START_DAY).padStart(2, '0');
  return `${startYear + 1}-${mm}-${dd}`;
}

/**
 * Which school year this Master belongs to. Prefers the year in the tab name; if
 * that's unreadable, infers it from `now` (before September → the year started
 * last calendar year). Both the expiry and the Contacts year labels hang off
 * this, so they can never disagree about which year is being synced.
 */
export function schoolYearStart(masterTabName: string, now: Date = new Date()): number {
  const fromTab = schoolYearStartYear(masterTabName);
  if (fromTab != null) return fromTab;

  const beforeSchoolStart =
    now.getMonth() + 1 < SCHOOL_YEAR_START_MONTH ||
    (now.getMonth() + 1 === SCHOOL_YEAR_START_MONTH && now.getDate() < SCHOOL_YEAR_START_DAY);
  return beforeSchoolStart ? now.getFullYear() - 1 : now.getFullYear();
}

/**
 * The school year written the way the org writes it in their Contacts labels:
 * 2026 → "26/27". This is the org's existing convention ("26/27 Class 10 Paula"),
 * not something we invented, so it must stay byte-identical to what they type.
 */
export function schoolYearLabel(startYear: number): string {
  const two = (y: number) => String(y % 100).padStart(2, '0');
  return `${two(startYear)}/${two(startYear + 1)}`;
}

/** The uniform expiry every member in this Master should receive. */
export function membershipExpiry(masterTabName: string, now: Date = new Date()): string {
  return expiryForSchoolYear(schoolYearStart(masterTabName, now));
}
