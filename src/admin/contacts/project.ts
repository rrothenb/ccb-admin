/**
 * Gmail Contacts projection (GAS side).
 *
 * Projects current members into the master account's Contacts, labelled the way
 * the org already labels them: "26/27" and "26/27 Class 10 Paula" for this school
 * year and "26/27 Teacher Paula" for her current students, plus cross-year
 * "Level …" / "Teacher …". Reuses the pure planner (plan.ts)
 * for the diff and the People API calls proven by the spike.
 *
 * Who "current members" are is decided by the same reconciliation as every other
 * tool — the uploaded Master + Register, the Borrowers sheet, and the account's
 * Contacts — so a member enrolled in the Master but not yet in Borrowers is
 * projected too, and this tool doesn't depend on the Borrowers write having run.
 *
 * Two entry points, mirroring the sync's preview-first rhythm:
 *   - previewContactProjection(...)  READ-ONLY: returns the create/label plan.
 *   - applyContactProjection(...)    WRITES: creates missing contacts and adds
 *                                    missing labels. Nothing else.
 *
 * The projection is additive: no contact is ever deleted, no label ever removed,
 * and an existing contact's name/fields are never rewritten. Past years' labels
 * are the org's alumni lists, so they're immutable history as far as this is
 * concerned. The cost is that a wrong label has to be removed by hand in Gmail —
 * the preview lists any it can spot (`staleYearLabels`).
 */

// The People advanced service global is provided by GAS at runtime once enabled.
declare const People: any;

import { reconcile, DetectorInput } from '../detector';
import { AppMember } from '../detector/types';
import { parseMasterGrid } from '../ingest/master';
import { parseRegisterTabs } from '../ingest/register';
import { uploadedXlsxToSheetId, trashSheet, sheetToStringGrid } from '../ingest/xlsx';
import { deriveClassInfo } from '../schedule/build';
import { getBorrowerService } from '../../services/borrowers';
import { readAllContacts } from './read';
import { logAdmin } from '../log';
import { schoolYearStart, schoolYearLabel } from '../expiry';
import {
  membersForContact,
  buildDesiredContacts,
  diffContacts,
  ContactPlan,
  DesiredContact,
  ExistingContact,
} from './plan';

export interface ContactProjectionResult {
  success: boolean;
  error?: string;
  plan?: ContactPlan;
  stats?: {
    desired: number;
    /** How many contacts the account holds in total (the pool a member is matched against). */
    existingContacts: number;
    /** The school year these labels are scoped by, e.g. "26/27". */
    year?: string;
    applied?: { created: number; updated: number };
  };
}

/** Picks the current-year Master tab (same tolerant selection as the sync). */
function pickMasterTab(ss: GoogleAppsScript.Spreadsheet.Spreadsheet): GoogleAppsScript.Spreadsheet.Sheet {
  const sheets = ss.getSheets();
  const byName = (re: RegExp) => sheets.find((s) => re.test(s.getName()));
  return byName(/master file.*2[67]\s*[-/]?\s*2[67]/i) || byName(/master file/i) || sheets[0];
}

/** Loads the app's members (Borrowers) as detector AppMembers. */
function loadAppMembers(): AppMember[] {
  const res = getBorrowerService().getAll();
  if (!res.success || !res.data) throw new Error(`Could not read app members: ${res.error || 'unknown error'}`);
  return res.data.map((b) => ({ id: String(b.id), rawName: b.name, email: b.email || '', phone: b.phone || '', expiryDate: b.expiryDate || '' }));
}

/** All contact groups (labels), mapped both ways. */
function listLabels(): { byName: Map<string, string>; byResource: Map<string, string> } {
  const list = People.ContactGroups.list({ pageSize: 200 });
  const groups = (list && list.contactGroups) || [];
  const byName = new Map<string, string>();
  const byResource = new Map<string, string>();
  for (const g of groups) {
    byName.set(g.name, g.resourceName);
    byResource.set(g.resourceName, g.name);
  }
  return { byName, byResource };
}

/** Finds a label by name or creates it; returns its resourceName. Updates the caches. */
function ensureLabel(name: string, byName: Map<string, string>, byResource: Map<string, string>): string {
  const existing = byName.get(name);
  if (existing) return existing;
  const created = People.ContactGroups.create({ contactGroup: { name } });
  byName.set(name, created.resourceName);
  byResource.set(created.resourceName, name);
  return created.resourceName;
}

/**
 * Reads EVERY contact in the account, each with the labels it carries.
 *
 * Not just "our" contacts: a member the admin already has in their address book
 * must gain this year's labels rather than be created a second time, and that
 * only works if we can find them by email/phone anywhere. Labels are read
 * unfiltered because the projection only ever ADDS — we need to know what's
 * already there so we don't re-add it, and we never remove any of it.
 */
function readAllContactsWithLabels(byResource: Map<string, string>): ExistingContact[] {
  const out: ExistingContact[] = [];
  let pageToken: string | undefined;
  do {
    const resp = People.People.Connections.list('people/me', {
      personFields: 'names,emailAddresses,phoneNumbers,memberships',
      pageSize: 1000,
      pageToken,
    });
    for (const person of resp.connections || []) {
      const email = ((person.emailAddresses && person.emailAddresses[0] && person.emailAddresses[0].value) || '').toLowerCase();
      const phone = (person.phoneNumbers && person.phoneNumbers[0] && person.phoneNumbers[0].value) || '';
      if (!email && !phone) continue; // keyed by neither — can't be matched to a member
      const displayName = (person.names && person.names[0] && person.names[0].displayName) || '(no name)';
      const labels: string[] = [];
      for (const mem of person.memberships || []) {
        const rn = mem.contactGroupMembership && mem.contactGroupMembership.contactGroupResourceName;
        const labelName = rn && byResource.get(rn);
        if (labelName) labels.push(labelName);
      }
      out.push({ email, phone, resourceName: person.resourceName, etag: person.etag, displayName, labels: labels.sort() });
    }
    pageToken = resp.nextPageToken;
  } while (pageToken);
  return out;
}

/** Parses uploads + Borrowers into this year's desired labels and the account's existing contacts. */
function computeProjection(
  masterB64: string,
  masterName: string,
  registerB64: string,
  registerName: string
): { plan: ContactPlan; desired: DesiredContact[]; existing: ExistingContact[]; labels: ReturnType<typeof listLabels>; year: string } {
  let masterSheetId = '';
  let registerSheetId = '';
  try {
    masterSheetId = uploadedXlsxToSheetId(masterB64, masterName, 'contacts-master');
    const masterTab = pickMasterTab(SpreadsheetApp.openById(masterSheetId));
    const masterParse = parseMasterGrid(sheetToStringGrid(masterTab));
    if (masterParse.error) throw new Error(`Master file: ${masterParse.error}`);

    registerSheetId = uploadedXlsxToSheetId(registerB64, registerName, 'contacts-register');
    const register = parseRegisterTabs(SpreadsheetApp.openById(registerSheetId).getSheets().map((s) => sheetToStringGrid(s)));

    const app = loadAppMembers();

    // The account's Contacts, read as a source (not just as the umbrella to diff
    // against): they're one of the places a not-yet-in-app member's email comes
    // from, so without them this projection could resolve fewer people than the
    // detection run did. Never fatal.
    let contacts: ReturnType<typeof readAllContacts> = [];
    try {
      contacts = readAllContacts();
    } catch (e) {
      logAdmin(`Contacts read skipped while planning the projection (continuing without): ${e}`);
    }

    const classIds = Array.from(new Set(register.map((r) => r.classId).filter(Boolean)));
    const input: DetectorInput = { master: masterParse.members, register, app, roster: { validClassIds: classIds }, contacts };
    const ctx = reconcile(input);

    // Teacher/level per class are derived from the Register (spreadsheet only).
    const classInfo = deriveClassInfo(masterParse.members, register);
    // The school year the labels are scoped by — same source as the expiry, so a
    // run can't write "26/27" labels alongside a 2026 expiry, or vice versa.
    const year = schoolYearLabel(schoolYearStart(masterTab.getName()));
    const desired = buildDesiredContacts(membersForContact(ctx), classInfo, year);

    const labels = listLabels();
    const existing = readAllContactsWithLabels(labels.byResource);

    return { plan: diffContacts(desired, existing, year), desired, existing, labels, year };
  } finally {
    if (masterSheetId) trashSheet(masterSheetId);
    if (registerSheetId) trashSheet(registerSheetId);
  }
}

/** READ-ONLY: returns the projection plan without touching Contacts. */
function previewContactProjection(
  masterB64: string,
  masterName: string,
  registerB64: string,
  registerName: string
): ContactProjectionResult {
  try {
    if (!masterB64 || !registerB64) return { success: false, error: 'Both the Master file and the Register file are required.' };
    const { plan, desired, existing, year } = computeProjection(masterB64, masterName, registerB64, registerName);
    logAdmin(
      `Previewed contacts projection for ${year}: ${desired.length} current members · ` +
        `${plan.toCreate.length} create / ${plan.toUpdate.length} label / ${plan.unchangedCount} already labelled`
    );
    return { success: true, plan, stats: { desired: desired.length, existingContacts: existing.length, year } };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * WRITES: executes the projection plan. Guards against an empty desired set or an
 * oversized removal (either signals a bad upload), and only ever touches contacts
 * in the umbrella + `CCB `-namespaced labels.
 */
function applyContactProjection(
  masterB64: string,
  masterName: string,
  registerB64: string,
  registerName: string
): ContactProjectionResult {
  try {
    if (!masterB64 || !registerB64) return { success: false, error: 'Both the Master file and the Register file are required.' };
    const { plan, desired, existing, labels, year } = computeProjection(masterB64, masterName, registerB64, registerName);

    // The one guard still worth having: an upload that resolved to nobody would
    // otherwise be a silent no-op. Nothing here can delete, so there's no
    // oversized-removal case left to defend against.
    if (desired.length === 0) {
      return { success: false, error: 'No current members resolved from the uploads — refusing to modify Contacts.' };
    }

    const labelRes = (name: string) => ensureLabel(name, labels.byName, labels.byResource);
    let created = 0;
    let updated = 0;

    for (const c of plan.toCreate) {
      // Route the detail to the right People field: email vs phone.
      const body: { names: object[]; emailAddresses?: object[]; phoneNumbers?: object[] } = {
        names: [{ givenName: c.given, familyName: c.family }],
      };
      if (c.email) body.emailAddresses = [{ value: c.email }];
      if (c.phone) body.phoneNumbers = [{ value: c.phone }];
      const person = People.People.createContact(body);
      for (const label of c.labels) {
        People.ContactGroups.Members.modify({ resourceNamesToAdd: [person.resourceName] }, labelRes(label));
      }
      created++;
    }

    // Labels only — the contact's name and every other field are left as the
    // admin has them, and no label is ever taken away.
    for (const u of plan.toUpdate) {
      for (const label of u.labelsToAdd) {
        People.ContactGroups.Members.modify({ resourceNamesToAdd: [u.resourceName] }, labelRes(label));
      }
      updated++;
    }

    logAdmin(
      `Contacts projection applied for ${year}: +${created} created, ~${updated} labelled ` +
        `(${desired.length} current members, ${plan.staleYearLabels.length} stale ${year} label(s) left for the admin)`
    );

    return { success: true, plan, stats: { desired: desired.length, existingContacts: existing.length, year, applied: { created, updated } } };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export { previewContactProjection, applyContactProjection };
