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

import { ReconContext } from '../detector';
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

/** A current member reduced to what a contact needs (one per app record; siblings already merged). */
export interface MemberForContact {
  appId: string;
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
 * Reduces the reconciliation context to the current members that should be
 * contacts: one per app record (siblings collapse), carrying every class number
 * their Master rows list. Members with no usable email are dropped (a contact
 * needs an email; the detector flags those separately).
 */
export function membersForContact(ctx: ReconContext): MemberForContact[] {
  const byApp = new Map<string, { appId: string; name: string; email: string; phone: string; classes: Set<string> }>();
  for (const link of ctx.links) {
    if (!link.app) continue;
    const entry =
      byApp.get(link.app.id) ||
      byApp
        .set(link.app.id, { appId: link.app.id, name: link.app.rawName, email: link.app.email, phone: link.app.phone || '', classes: new Set() })
        .get(link.app.id)!;
    const cls = (link.master.classNumber || '').trim();
    if (cls) entry.classes.add(cls);
  }
  // A contact needs SOME reachable detail — an email or a phone. Members with
  // neither are dropped (the detector flags them separately).
  return [...byApp.values()]
    .filter((m) => isEmailShaped(m.email) || isPhoneShaped(m.phone))
    .map((m) => ({ appId: m.appId, name: m.name, email: m.email, phone: m.phone, classNumbers: [...m.classes] }));
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
