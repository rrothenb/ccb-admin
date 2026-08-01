/**
 * Gmail Contacts projection planner (pure).
 *
 * Each current member becomes a contact carrying labels (Contacts "groups") that
 * follow the org's OWN convention, which is year-scoped:
 *
 *   26/27                          — everyone in this school year
 *   26/27 Class 10 Paula           — one class in this school year
 *   Level U Intermediate (B2+)     — a level, across all years
 *   Teacher Paula                  — a teacher, across all years
 *
 * The year labels are the important part: they're how the org messages alumni.
 * Last year's "25/26 Class 10 Paula" is history, and history is never rewritten.
 *
 * SAFETY — the projection is therefore ADDITIVE ONLY:
 *  - contacts are never deleted and labels are never removed, so past years stay
 *    intact and a contact that already exists simply gains the labels it lacks;
 *  - an existing contact's name and fields are left exactly as they are (we only
 *    set a name on a contact we create) — the admin's own edits win;
 *  - the email (or phone, for a phone-only member) is the join key, matched
 *    across the whole address book so a member is never duplicated.
 *
 * That means the plan can't "clean up" a wrong label — but wrong labels are rare,
 * fixable in Gmail, and vastly preferable to a projection that can silently
 * delete a contact or a year of history.
 *
 * Pure module (no People API) so the diff logic is unit-testable; the GAS layer
 * reads/writes Contacts and maps label names ↔ resourceNames.
 */

import { ReconContext, resolveNewMembers } from '../detector';
import { isEmailShaped, emailKey, isPhoneShaped, phoneKey, nameKey } from '../detector/normalize';
import { splitClassIds } from '../classid';
import { normalizeLevel } from '../level';

/**
 * Stable identity for the contact diff. A member's email is the join key when
 * they have one; a phone-only member is keyed by their (normalized) phone so they
 * project as a real contact instead of being dropped. Prefixed so an email and a
 * phone can never collide.
 */
export function contactId(email: string, phone: string): string {
  if (isEmailShaped(email)) return 'e:' + emailKey(email);
  if (phone && isPhoneShaped(phone)) return 'p:' + phoneKey(phone);
  return '';
}

/**
 * The year-scoped labels, written exactly as the org already writes them:
 * "26/27" and "26/27 Class 10 Paula". A class with no known teacher just drops
 * that part ("26/27 Class 10") rather than inventing a placeholder.
 */
export const yearLabel = (year: string): string => year.trim();
export function yearClassLabel(year: string, classNumber: string, teacher: string): string {
  const base = `${year.trim()} Class ${classNumber.trim()}`;
  return teacher.trim() ? `${base} ${teacher.trim()}` : base;
}

// Cross-year labels: a level or a teacher accumulates every member who has ever
// been taught at/by it, which is exactly what makes them useful alongside the
// year labels ("everyone who's ever been Intermediate").
export const teacherLabel = (t: string): string => `Teacher ${t.trim()}`;
export const levelLabel = (l: string): string => `Level ${normalizeLevel(l)}`;

/** True for a label this projection generates for `year` — used to spot stale year labels. */
export function isYearLabel(name: string, year: string): boolean {
  const y = year.trim();
  return name === y || name.startsWith(`${y} Class `);
}

/**
 * A current member reduced to what a contact needs — one per PERSON as the
 * reconciliation sees them: siblings merged onto their parent's record, and
 * Master members not yet in the app included in their own right.
 */
export interface MemberForContact {
  /** The app record id, or `master:<name key>` for someone the app doesn't hold yet. */
  id: string;
  name: string;
  email: string;
  /** Phone, used as the contact detail when the member has no email ('' if none). */
  phone?: string;
  /** Every class number this app record is enrolled in (siblings can span classes). */
  classNumbers: string[];
}

/** The desired end-state for one contact. */
export interface DesiredContact {
  email: string;
  /** Set only for a phone-only member — written to the Contacts phone field. */
  phone: string;
  family: string;
  given: string;
  labels: string[];
}

/**
 * A contact that already exists in the account — ANY contact, not just one we
 * created: the whole address book is searched by email/phone so a member who is
 * already in Contacts gains labels instead of being duplicated.
 */
export interface ExistingContact {
  email: string;
  phone: string;
  resourceName: string;
  etag: string;
  displayName: string;
  /** Every label it carries (ours and the admin's alike — we only ever add to this). */
  labels: string[];
}

export interface ContactCreate {
  /** The email or phone shown to the admin (whichever this contact is keyed by). */
  contact: string;
  email: string;
  phone: string;
  family: string;
  given: string;
  labels: string[];
}
/** An existing contact that will gain labels. Nothing else about it is touched. */
export interface ContactUpdate {
  contact: string;
  resourceName: string;
  /** How the contact is currently filed — shown so the admin can see who's being labelled. */
  existingName: string;
  /** What the membership data calls them; differing is fine and is NOT corrected. */
  memberName: string;
  nameDiffers: boolean;
  labelsToAdd: string[];
}
/**
 * A contact carrying THIS year's labels who isn't in this year's cohort — the one
 * thing an additive projection can't fix by itself. Reported, never acted on:
 * usually it means someone was pulled from the Master after a previous run.
 */
export interface StaleYearLabel {
  contact: string;
  displayName: string;
  /** The current-year labels they hold and (on this data) shouldn't. */
  labels: string[];
}
export interface ContactPlan {
  toCreate: ContactCreate[];
  toUpdate: ContactUpdate[];
  /** Advisory only — the admin removes these in Gmail if they're genuinely wrong. */
  staleYearLabels: StaleYearLabel[];
  unchangedCount: number;
}

/** Splits an app "Surname, First" (or "First Last") into {family, given}, best-effort. */
export function splitName(raw: string): { family: string; given: string } {
  const s = (raw || '').trim();
  const comma = s.indexOf(',');
  if (comma >= 0) return { family: s.slice(0, comma).trim(), given: s.slice(comma + 1).trim() };
  const sp = s.lastIndexOf(' ');
  if (sp >= 0) return { family: s.slice(sp + 1).trim(), given: s.slice(0, sp).trim() };
  return { family: s, given: '' };
}

/**
 * Reduces the reconciliation context to the people who should be contacts.
 *
 * The projection is built from the SAME reconciliation every other tool uses —
 * this year's Master + Register, the app's Borrowers, and the account's Contacts —
 * not from the Borrowers sheet alone. That matters because the Master is what
 * says who is a member this year: a person enrolled in the Master but not yet in
 * Borrowers is a current member, and leaving them out would silently project a
 * partial cohort whenever Contacts ran before the Borrowers write.
 *
 * So two sources of people, in one pass:
 *   - each linked app record (siblings collapse onto their parent's record), and
 *   - each Master member with no app record, contacted on the email/phone
 *     `resolveNewMembers` finds — the very detail the Borrowers tool would
 *     create them with, so running the tools in either order gives the same
 *     contact.
 *
 * Everyone carries every class number their Master rows list. Anyone with no
 * reachable detail at all is dropped (a contact needs one); the detector blocks
 * on those separately, so a clean detection has none.
 */
export function membersForContact(ctx: ReconContext): MemberForContact[] {
  const byPerson = new Map<string, { id: string; name: string; email: string; phone: string; classes: Set<string> }>();
  const upsert = (id: string, name: string, email: string, phone: string, classNumber: string) => {
    const entry =
      byPerson.get(id) || byPerson.set(id, { id, name, email, phone, classes: new Set() }).get(id)!;
    const cls = (classNumber || '').trim();
    if (cls) entry.classes.add(cls);
  };

  for (const link of ctx.links) {
    if (!link.app) continue;
    upsert(link.app.id, link.app.rawName, link.app.email, link.app.phone || '', link.master.classNumber);
  }

  // Master members the app doesn't hold yet — real members of this year's cohort.
  // A contact is keyed by its email/phone, so someone whose only detail is already
  // spoken for would overwrite the person holding it. The app record wins and the
  // newcomer is left out rather than silently replacing them; the detector blocks
  // on exactly this (shared-new-contact / new-email-in-app), so a clean detection
  // never reaches here with a clash.
  const taken = new Set([...byPerson.values()].map((p) => contactId(p.email, p.phone)).filter(Boolean));
  for (const { master, hit } of resolveNewMembers(ctx)) {
    if (!hit) continue;
    const email = hit.kind === 'email' ? hit.value : '';
    const phone = hit.kind === 'phone' ? hit.value : '';
    const key = contactId(email, phone);
    if (!key || taken.has(key)) continue;
    // An address the app already records against SOMEONE (current or lapsed) isn't
    // free to use: projecting this person onto it would rename that contact.
    if (email && ctx.appByEmail.has(emailKey(email))) continue;
    taken.add(key);
    upsert(`master:${nameKey(master.rawName)}`, master.rawName, email, phone, master.classNumber);
  }

  return [...byPerson.values()]
    .filter((m) => isEmailShaped(m.email) || isPhoneShaped(m.phone))
    .map((m) => ({ id: m.id, name: m.name, email: m.email, phone: m.phone, classNumbers: [...m.classes] }));
}

/**
 * Builds the labels each member should carry this year. `year` is the org's own
 * "26/27" form, so the labels this writes are indistinguishable from the ones
 * they've been creating by hand — the point being that this year's projection
 * lands in the same labels they'd have made themselves.
 */
export function buildDesiredContacts(
  members: MemberForContact[],
  classInfo: Map<string, { teacher: string; level: string }>,
  year: string
): DesiredContact[] {
  return members.map((m) => {
    const labels = new Set<string>();
    // Everyone in the cohort gets the bare year label — "email the whole school".
    if (year.trim()) labels.add(yearLabel(year));
    // A class number can name multiple classes ("11 & 12" → labels for both).
    for (const cls of m.classNumbers.flatMap(splitClassIds)) {
      const info = classInfo.get(cls);
      const teacher = (info && info.teacher) || '';
      if (year.trim()) labels.add(yearClassLabel(year, cls, teacher));
      if (teacher) labels.add(teacherLabel(teacher));
      if (info && info.level) labels.add(levelLabel(info.level));
    }
    const { family, given } = splitName(m.name);
    // Email is the primary contact detail; fall back to phone only when there's no email.
    const email = isEmailShaped(m.email) ? emailKey(m.email) : '';
    const phone = !email && m.phone && isPhoneShaped(m.phone) ? m.phone : '';
    return { email, phone, family, given, labels: [...labels].sort() };
  });
}

/**
 * Diffs desired against the account's existing contacts (keyed by email, or phone
 * for a phone-only member) into an ADDITIVE plan: create the people who aren't
 * there, add the labels that are missing, touch nothing else.
 *
 * `year` lets it report the one thing it deliberately won't fix — a contact still
 * carrying this year's labels who isn't in this year's cohort.
 */
export function diffContacts(desired: DesiredContact[], existing: ExistingContact[], year = ''): ContactPlan {
  const desiredById = new Map<string, DesiredContact>();
  for (const d of desired) {
    const id = contactId(d.email, d.phone);
    if (id) desiredById.set(id, d);
  }
  const existingById = new Map<string, ExistingContact>();
  for (const e of existing) {
    const id = contactId(e.email, e.phone);
    // First writer wins: with duplicates in the address book we label the one we
    // saw first rather than picking arbitrarily on each run.
    if (id && !existingById.has(id)) existingById.set(id, e);
  }

  const toCreate: ContactCreate[] = [];
  const toUpdate: ContactUpdate[] = [];
  const staleYearLabels: StaleYearLabel[] = [];
  let unchangedCount = 0;

  for (const [id, d] of desiredById) {
    const display = d.email || d.phone;
    const cur = existingById.get(id);
    if (!cur) {
      toCreate.push({ contact: display, email: d.email, phone: d.phone, family: d.family, given: d.given, labels: d.labels });
      continue;
    }
    const have = new Set(cur.labels);
    const labelsToAdd = d.labels.filter((l) => !have.has(l)).sort();
    if (!labelsToAdd.length) {
      unchangedCount++;
      continue;
    }
    // A name difference is reported, never corrected: this contact may be filed
    // the way the admin wants it, and renaming someone's address book is rude.
    const memberName = `${d.family}, ${d.given}`.replace(/, $/, '');
    toUpdate.push({
      contact: display,
      resourceName: cur.resourceName,
      existingName: cur.displayName,
      memberName,
      nameDiffers: nameKey(cur.displayName) !== nameKey(memberName),
      labelsToAdd,
    });
  }

  if (year.trim()) {
    for (const [id, e] of existingById) {
      if (desiredById.has(id)) continue;
      const stale = e.labels.filter((l) => isYearLabel(l, year)).sort();
      if (stale.length) {
        staleYearLabels.push({ contact: e.email || e.phone, displayName: e.displayName, labels: stale });
      }
    }
  }

  return { toCreate, toUpdate, staleYearLabels, unchangedCount };
}
