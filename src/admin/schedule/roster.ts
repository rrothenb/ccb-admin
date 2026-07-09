/**
 * Class roster config — the static per-class facts not derivable from the
 * Master/Register enrolment data (and never taken from the website).
 *
 * Capacity is now supplied at generation time (two fields: general + Story Time),
 * so it's NOT stored here; this file only marks which classes are the children's
 * Story Time classes (they get the smaller capacity) and holds fee/term, which
 * remain unknown ('' / null → "—") until the org supplies them.
 */

export interface RosterClass {
  /** Canonical class id, normalized ("1", "8a"). Matches the Master CLASS NUMBER. */
  id: string;
  /** True for the children's Story Time classes — they use the Story Time capacity. */
  storyTime?: boolean;
  /** Term fee as a display string; '' until supplied. */
  fee: string;
  /** Number of weeks in the term; null until supplied → Weeks Left shows "—". */
  totalWeeks: number | null;
  /** Term start date (ISO yyyy-MM-dd); '' until supplied → Weeks Left shows "—". */
  termStart: string;
  /** Optional day/time override; when '' the schedule uses the Master's DAY/TIME. */
  dayTimeOverride?: string;
}

/** Class ids seen in the Register parse; 8a/8b flagged as Story Time (kids' classes). */
export const CLASS_ROSTER: RosterClass[] = [
  { id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' },
  { id: '8a', storyTime: true }, { id: '8b', storyTime: true },
  { id: '9' }, { id: '10' }, { id: '11' }, { id: '12' }, { id: '11&12' }, { id: '13' }, { id: '14' },
].map((c) => ({ fee: '', totalWeeks: null, termStart: '', ...c }));
