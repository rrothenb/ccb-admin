/**
 * Gmail Contacts projection (GAS side).
 *
 * Projects current members into the master account's Contacts, under the
 * `CCB Members` umbrella label, tagged by class/teacher/level. Reuses the pure
 * planner (plan.ts) for the diff and the People API calls proven by the spike.
 *
 * Two entry points, mirroring the sync's preview-first rhythm:
 *   - previewContactProjection(...)  READ-ONLY: returns the create/update/remove plan.
 *   - applyContactProjection(...)    WRITES: executes the plan, guarded against
 *                                    empty/oversized diffs, scoped to `CCB ` labels.
 *
 * Only contacts inside the umbrella and only `CCB `-namespaced labels are ever
 * read or modified — personal contacts are untouched.
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
import { logAdmin } from '../log';
import {
  membersForContact,
  buildDesiredContacts,
  diffContacts,
  isManagedLabel,
  UMBRELLA_LABEL,
  ContactPlan,
  DesiredContact,
  ExistingContact,
} from './plan';

export interface ContactProjectionResult {
  success: boolean;
  error?: string;
  plan?: ContactPlan;
  stats?: { desired: number; existingManaged: number; applied?: { created: number; updated: number; removed: number } };
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

/** Reads the contacts in the umbrella label, each with its `CCB `-namespaced labels. */
function readManagedContacts(umbrellaResource: string, byResource: Map<string, string>): ExistingContact[] {
  const group = People.ContactGroups.get(umbrellaResource, { maxMembers: 2000 });
  const memberResourceNames: string[] = (group && group.memberResourceNames) || [];
  const out: ExistingContact[] = [];
  for (let i = 0; i < memberResourceNames.length; i += 200) {
    const chunk = memberResourceNames.slice(i, i + 200);
    const batch = People.People.getBatchGet({ resourceNames: chunk, personFields: 'names,emailAddresses,phoneNumbers,memberships' });
    for (const resp of batch.responses || []) {
      const person = resp.person;
      if (!person) continue;
      const email = ((person.emailAddresses && person.emailAddresses[0] && person.emailAddresses[0].value) || '').toLowerCase();
      const phone = (person.phoneNumbers && person.phoneNumbers[0] && person.phoneNumbers[0].value) || '';
      if (!email && !phone) continue; // a managed contact keyed by neither can't be diffed
      const displayName = (person.names && person.names[0] && person.names[0].displayName) || '(no name)';
      const labels: string[] = [];
      for (const mem of person.memberships || []) {
        const rn = mem.contactGroupMembership && mem.contactGroupMembership.contactGroupResourceName;
        const labelName = rn && byResource.get(rn);
        if (labelName && isManagedLabel(labelName)) labels.push(labelName);
      }
      out.push({ email, phone, resourceName: person.resourceName, etag: person.etag, displayName, labels: labels.sort() });
    }
  }
  return out;
}

/** Parses uploads + Borrowers into the desired contact end-state and the current managed contacts. */
function computeProjection(
  masterB64: string,
  masterName: string,
  registerB64: string,
  registerName: string
): { plan: ContactPlan; desired: DesiredContact[]; existing: ExistingContact[]; labels: ReturnType<typeof listLabels>; umbrella: string } {
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
    const classIds = Array.from(new Set(register.map((r) => r.classId).filter(Boolean)));
    const input: DetectorInput = { master: masterParse.members, register, app, roster: { validClassIds: classIds } };
    const ctx = reconcile(input);

    // Teacher/level per class are derived from the Register (spreadsheet only).
    const classInfo = deriveClassInfo(masterParse.members, register);
    const desired = buildDesiredContacts(membersForContact(ctx), classInfo);

    const labels = listLabels();
    const umbrella = ensureLabel(UMBRELLA_LABEL, labels.byName, labels.byResource);
    const existing = readManagedContacts(umbrella, labels.byResource);

    return { plan: diffContacts(desired, existing), desired, existing, labels, umbrella };
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
    const { plan, desired, existing } = computeProjection(masterB64, masterName, registerB64, registerName);
    logAdmin(
      `Previewed contacts projection: ${desired.length} current members · ` +
        `${plan.toCreate.length} create / ${plan.toUpdate.length} update / ${plan.toRemove.length} remove`
    );
    return { success: true, plan, stats: { desired: desired.length, existingManaged: existing.length } };
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
    const { plan, desired, existing, labels } = computeProjection(masterB64, masterName, registerB64, registerName);

    // Safety guards — refuse to write on a diff that looks like a bad upload.
    if (desired.length === 0) {
      return { success: false, error: 'No current members resolved from the uploads — refusing to modify Contacts.' };
    }
    if (existing.length >= 5 && plan.toRemove.length > existing.length * 0.5) {
      return {
        success: false,
        error: `Refusing to apply: the plan would remove ${plan.toRemove.length} of ${existing.length} managed contacts (over half). Re-check the uploaded files, then retry.`,
      };
    }

    const labelRes = (name: string) => ensureLabel(name, labels.byName, labels.byResource);
    let created = 0;
    let updated = 0;
    let removed = 0;

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

    for (const u of plan.toUpdate) {
      if (u.nameChanged) {
        People.People.updateContact(
          { etag: u.etag, names: [{ givenName: u.toGiven, familyName: u.toFamily }] },
          u.resourceName,
          { updatePersonFields: 'names' }
        );
      }
      for (const label of u.labelsToAdd) {
        People.ContactGroups.Members.modify({ resourceNamesToAdd: [u.resourceName] }, labelRes(label));
      }
      for (const label of u.labelsToRemove) {
        People.ContactGroups.Members.modify({ resourceNamesToRemove: [u.resourceName] }, labelRes(label));
      }
      updated++;
    }

    for (const r of plan.toRemove) {
      People.People.deleteContact(r.resourceName);
      removed++;
    }

    logAdmin(
      `Contacts projection applied: +${created} created, ~${updated} updated, -${removed} removed (${desired.length} current members)`
    );

    return { success: true, plan, stats: { desired: desired.length, existingManaged: existing.length, applied: { created, updated, removed } } };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export { previewContactProjection, applyContactProjection };
