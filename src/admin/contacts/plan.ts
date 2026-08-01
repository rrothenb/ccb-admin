/**
 * Gmail Contacts projection planner (pure).
 *
 * The master account's Contacts are a one-way projection of current members:
 * each member becomes a contact tagged with labels (Contacts "groups") for their
 * class number, teacher, and level, all under an umbrella `CCB Members` label.
 * The master can then email a whole class/teacher/level straight from Gmail's To:.
 *
 * SAFETY — the same invariants the spike proved:
 *  - We only ever manage labels in the `CCB ` namespace and contacts inside the
 *    `CCB Members` umbrella; personal contacts/labels are never read or touched.
 *  - The plan is a scoped diff/upsert (create/update/relabel/remove) — never
 *    nuke-and-repave. The email is the app↔Contacts join key.
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

/** The umbrella label every managed contact belongs to — the primary safety scope. */
export const UMBRELLA_LABEL = 'CCB Members';

// Per-member labels drop the "CCB " prefix (the umbrella already namespaces us) —
// they read cleaner in Gmail's To: field ("Class 1" not "CCB Class 1").
export const classLabel = (n: string): string => `Class ${n.trim()}`;
export const teacherLabel = (t: string): string => `Teacher ${t.trim()}`;
export const levelLabel = (l: string): string => `Level ${normalizeLevel(l)}`;

/** Matches the labels this projection manages. Applied only to contacts already in the umbrella. */
const MANAGED_LABEL_RE = /^(Class|Teacher|Level) .+/;
export function isManagedLabel(name: string): boolean {
  return name === UMBRELLA_LABEL || MANAGED_LABEL_RE.test(name);
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

/** A contact currently in the managed umbrella (read from Contacts). */
export interface ExistingContact {
  email: string;
  phone: string;
  resourceName: string;
  etag: string;
  displayName: string;
  /** Only its `CCB `-namespaced labels. */
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
export interface ContactUpdate {
  contact: string;
  resourceName: string;
  etag: string;
  fromName: string;
  toFamily: string;
  toGiven: string;
  nameChanged: boolean;
  labelsToAdd: string[];
  labelsToRemove: string[];
}
export interface ContactRemove {
  contact: string;
  resourceName: string;
  displayName: string;
}
export interface ContactPlan {
  toCreate: ContactCreate[];
  toUpdate: ContactUpdate[];
  toRemove: ContactRemove[];
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

/** Builds the desired contact end-state, deriving teacher/level labels from class info. */
export function buildDesiredContacts(
  members: MemberForContact[],
  classInfo: Map<string, { teacher: string; level: string }>
): DesiredContact[] {
  return members.map((m) => {
    const labels = new Set<string>([UMBRELLA_LABEL]);
    // A class number can name multiple classes ("11 & 12" → labels for both).
    for (const cls of m.classNumbers.flatMap(splitClassIds)) {
      labels.add(classLabel(cls));
      const info = classInfo.get(cls);
      if (info && info.teacher) labels.add(teacherLabel(info.teacher));
      if (info && info.level) labels.add(levelLabel(info.level));
    }
    const { family, given } = splitName(m.name);
    // Email is the primary contact detail; fall back to phone only when there's no email.
    const email = isEmailShaped(m.email) ? emailKey(m.email) : '';
    const phone = !email && m.phone && isPhoneShaped(m.phone) ? m.phone : '';
    return { email, phone, family, given, labels: [...labels].sort() };
  });
}

/** Diffs desired vs existing (keyed by email, or phone for phone-only) into a scoped plan. */
export function diffContacts(desired: DesiredContact[], existing: ExistingContact[]): ContactPlan {
  const desiredById = new Map<string, DesiredContact>();
  for (const d of desired) {
    const id = contactId(d.email, d.phone);
    if (id) desiredById.set(id, d);
  }
  const existingById = new Map<string, ExistingContact>();
  for (const e of existing) {
    const id = contactId(e.email, e.phone);
    if (id) existingById.set(id, e);
  }

  const toCreate: ContactCreate[] = [];
  const toUpdate: ContactUpdate[] = [];
  const toRemove: ContactRemove[] = [];
  let unchangedCount = 0;

  for (const [, d] of desiredById) {
    const id = contactId(d.email, d.phone);
    const display = d.email || d.phone;
    const cur = existingById.get(id);
    if (!cur) {
      toCreate.push({ contact: display, email: d.email, phone: d.phone, family: d.family, given: d.given, labels: d.labels });
      continue;
    }
    const want = new Set(d.labels);
    const have = new Set(cur.labels);
    const labelsToAdd = [...want].filter((l) => !have.has(l)).sort();
    const labelsToRemove = [...have].filter((l) => !want.has(l)).sort();
    const nameChanged = nameKey(cur.displayName) !== nameKey(`${d.family} ${d.given}`);
    if (labelsToAdd.length || labelsToRemove.length || nameChanged) {
      toUpdate.push({
        contact: display,
        resourceName: cur.resourceName,
        etag: cur.etag,
        fromName: cur.displayName,
        toFamily: d.family,
        toGiven: d.given,
        nameChanged,
        labelsToAdd,
        labelsToRemove,
      });
    } else {
      unchangedCount++;
    }
  }

  for (const [id, e] of existingById) {
    if (!desiredById.has(id)) {
      toRemove.push({ contact: e.email || e.phone, resourceName: e.resourceName, displayName: e.displayName });
    }
  }

  return { toCreate, toUpdate, toRemove, unchangedCount };
}
