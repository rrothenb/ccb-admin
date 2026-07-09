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
import { isEmailShaped, emailKey, nameKey } from '../detector/normalize';

/** The umbrella label every managed contact belongs to — the primary safety scope. */
export const UMBRELLA_LABEL = 'CCB Members';

// Per-member labels drop the "CCB " prefix (the umbrella already namespaces us) —
// they read cleaner in Gmail's To: field ("Class 1" not "CCB Class 1").
export const classLabel = (n: string): string => `Class ${n.trim()}`;
export const teacherLabel = (t: string): string => `Teacher ${t.trim()}`;
export const levelLabel = (l: string): string => `Level ${l.trim()}`;

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
  /** Every class number this app record is enrolled in (siblings can span classes). */
  classNumbers: string[];
}

/** The desired end-state for one contact. */
export interface DesiredContact {
  email: string;
  family: string;
  given: string;
  labels: string[];
}

/** A contact currently in the managed umbrella (read from Contacts). */
export interface ExistingContact {
  email: string;
  resourceName: string;
  etag: string;
  displayName: string;
  /** Only its `CCB `-namespaced labels. */
  labels: string[];
}

export interface ContactCreate {
  email: string;
  family: string;
  given: string;
  labels: string[];
}
export interface ContactUpdate {
  email: string;
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
  email: string;
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
  const byApp = new Map<string, { appId: string; name: string; email: string; classes: Set<string> }>();
  for (const link of ctx.links) {
    if (!link.app) continue;
    const entry =
      byApp.get(link.app.id) ||
      byApp.set(link.app.id, { appId: link.app.id, name: link.app.rawName, email: link.app.email, classes: new Set() }).get(link.app.id)!;
    const cls = (link.master.classNumber || '').trim();
    if (cls) entry.classes.add(cls);
  }
  return [...byApp.values()]
    .filter((m) => isEmailShaped(m.email))
    .map((m) => ({ appId: m.appId, name: m.name, email: m.email, classNumbers: [...m.classes] }));
}

/** Builds the desired contact end-state, deriving teacher/level labels from class info. */
export function buildDesiredContacts(
  members: MemberForContact[],
  classInfo: Map<string, { teacher: string; level: string }>
): DesiredContact[] {
  const normClass = (c: string) => c.toLowerCase().replace(/\s+/g, '');
  return members.map((m) => {
    const labels = new Set<string>([UMBRELLA_LABEL]);
    for (const cls of m.classNumbers) {
      labels.add(classLabel(cls));
      const info = classInfo.get(normClass(cls));
      if (info && info.teacher) labels.add(teacherLabel(info.teacher));
      if (info && info.level) labels.add(levelLabel(info.level));
    }
    const { family, given } = splitName(m.name);
    return { email: emailKey(m.email), family, given, labels: [...labels].sort() };
  });
}

/** Diffs desired vs existing (keyed by email) into a scoped create/update/remove plan. */
export function diffContacts(desired: DesiredContact[], existing: ExistingContact[]): ContactPlan {
  const desiredByEmail = new Map(desired.map((d) => [emailKey(d.email), d]));
  const existingByEmail = new Map(existing.map((e) => [emailKey(e.email), e]));

  const toCreate: ContactCreate[] = [];
  const toUpdate: ContactUpdate[] = [];
  const toRemove: ContactRemove[] = [];
  let unchangedCount = 0;

  for (const [email, d] of desiredByEmail) {
    const cur = existingByEmail.get(email);
    if (!cur) {
      toCreate.push({ email, family: d.family, given: d.given, labels: d.labels });
      continue;
    }
    const want = new Set(d.labels);
    const have = new Set(cur.labels);
    const labelsToAdd = [...want].filter((l) => !have.has(l)).sort();
    const labelsToRemove = [...have].filter((l) => !want.has(l)).sort();
    const nameChanged = nameKey(cur.displayName) !== nameKey(`${d.family} ${d.given}`);
    if (labelsToAdd.length || labelsToRemove.length || nameChanged) {
      toUpdate.push({
        email,
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

  for (const [email, e] of existingByEmail) {
    if (!desiredByEmail.has(email)) {
      toRemove.push({ email, resourceName: e.resourceName, displayName: e.displayName });
    }
  }

  return { toCreate, toUpdate, toRemove, unchangedCount };
}
