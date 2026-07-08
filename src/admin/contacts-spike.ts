/**
 * People API contacts spike (admin-only, SAFE + reversible).
 *
 * Purpose: retire the highest-remaining risk — writing Gmail Contacts via the
 * People API — by proving we can create / label / update / remove contacts
 * entirely INSIDE a dedicated label, without ever touching contacts outside it.
 *
 * Safety design:
 *  - Everything is scoped to MANAGED_LABEL ("CCB Members TEST"). The code never
 *    lists or modifies a contact that isn't a member of that label.
 *  - Test data is obviously fake (ZZ-SpikeTest / @example.com), so it can't be
 *    confused with a real member and teardown is unambiguous.
 *  - A dry-run prints the planned diff without writing.
 *  - Teardown deletes everything the spike created (contacts + its labels).
 *
 * Run order from the admin editor (read-only first). The editor's Run button
 * passes no args, so use the zero-arg wrappers rather than syncSample directly:
 *   1. contactsSpike_listManaged()   // read-only: current label contents (creates label if missing)
 *   2. contactsSpike_syncDryRun()    // DRY RUN: prints the planned diff, writes nothing
 *   3. contactsSpike_syncApply()     // applies create/update/remove
 *   4. contactsSpike_listManaged()   // verify
 *   5. contactsSpike_teardown()      // delete everything the spike made
 *
 * Requires: People advanced service enabled (manifest + editor Services +), the
 * contacts scope (already in the manifest), and the People API enabled in the
 * linked Cloud project (the editor toggle does this).
 */

// The People advanced service global is provided by GAS at runtime once enabled.
declare const People: any;

const MANAGED_LABEL = 'CCB Members TEST';

/**
 * The desired end-state (a tiny fake roster). Edit between runs to exercise the
 * diff: change a name to test update, delete an entry to test removal.
 */
interface SampleMember {
  given: string;
  family: string;
  email: string;
  classNo: string; // becomes an additional label "CCB Class <n>"
}
const SAMPLE: SampleMember[] = [
  { given: 'Alice', family: 'ZZ-SpikeTest', email: 'ccb.spike.alice@example.com', classNo: '1' },
  { given: 'Bob', family: 'ZZ-SpikeTest', email: 'ccb.spike.bob@example.com', classNo: '3' },
  { given: 'Carol', family: 'ZZ-SpikeTest', email: 'ccb.spike.carol@example.com', classNo: '1' },
];

/** Finds a contact group (label) by exact name, or creates it. Returns its resourceName. */
function ensureLabel(name: string): string {
  const list = People.ContactGroups.list({ pageSize: 200 });
  const groups = (list && list.contactGroups) || [];
  const existing = groups.find((g: any) => g.name === name);
  if (existing) return existing.resourceName;
  const created = People.ContactGroups.create({ contactGroup: { name } });
  Logger.log(`Created label "${name}" -> ${created.resourceName}`);
  return created.resourceName;
}

/**
 * Reads the contacts currently in the managed label. Read-only. Returns a map
 * keyed by lowercased email -> { resourceName, etag, displayName }.
 */
function getManagedContacts(managedResource: string): Record<string, { resourceName: string; etag: string; displayName: string }> {
  const group = People.ContactGroups.get(managedResource, { maxMembers: 500 });
  const memberResourceNames: string[] = (group && group.memberResourceNames) || [];
  const out: Record<string, { resourceName: string; etag: string; displayName: string }> = {};
  if (memberResourceNames.length === 0) return out;

  const batch = People.People.getBatchGet({
    resourceNames: memberResourceNames,
    personFields: 'names,emailAddresses,memberships',
  });
  for (const resp of (batch.responses || [])) {
    const person = resp.person;
    if (!person) continue;
    const email = ((person.emailAddresses && person.emailAddresses[0] && person.emailAddresses[0].value) || '').toLowerCase();
    const displayName = (person.names && person.names[0] && person.names[0].displayName) || '(no name)';
    if (email) out[email] = { resourceName: person.resourceName, etag: person.etag, displayName };
  }
  return out;
}

/** Read-only: prints what's currently in the managed label. */
function contactsSpike_listManaged(): void {
  const managed = ensureLabel(MANAGED_LABEL);
  const current = getManagedContacts(managed);
  const keys = Object.keys(current);
  Logger.log(`Managed label "${MANAGED_LABEL}" (${managed}) has ${keys.length} contact(s):`);
  for (const email of keys) {
    Logger.log(`  - ${current[email].displayName} <${email}>  ${current[email].resourceName}`);
  }
}

/**
 * Reconciles the managed label to match SAMPLE: creates missing, removes extra,
 * and (best-effort) updates a changed display name. Scoped entirely to the
 * managed label. Pass dryRun=true to print the plan without writing.
 */
function contactsSpike_syncSample(dryRun: boolean): void {
  const managed = ensureLabel(MANAGED_LABEL);
  const current = getManagedContacts(managed);

  const desired: Record<string, SampleMember> = {};
  for (const m of SAMPLE) desired[m.email.toLowerCase()] = m;

  const toCreate = Object.keys(desired).filter((e) => !current[e]);
  const toRemove = Object.keys(current).filter((e) => !desired[e]);
  const toUpdate = Object.keys(desired).filter((e) => {
    if (!current[e]) return false;
    const want = `${desired[e].family}, ${desired[e].given}`;
    return current[e].displayName !== want;
  });

  Logger.log(`Plan (${dryRun ? 'DRY RUN' : 'APPLY'}) for "${MANAGED_LABEL}":`);
  Logger.log(`  create: ${toCreate.length} [${toCreate.join(', ')}]`);
  Logger.log(`  update: ${toUpdate.length} [${toUpdate.join(', ')}]`);
  Logger.log(`  remove: ${toRemove.length} [${toRemove.join(', ')}]`);
  if (dryRun) return;

  // CREATE
  for (const email of toCreate) {
    const m = desired[email];
    const person = People.People.createContact({
      names: [{ givenName: m.given, familyName: m.family }],
      emailAddresses: [{ value: m.email }],
    });
    // Managed label + a per-class label — proves multi-label membership.
    // NOTE: advanced-service signature is (requestBody, resourceName) — body first.
    const classLabel = ensureLabel(`CCB Class ${m.classNo}`);
    People.ContactGroups.Members.modify({ resourceNamesToAdd: [person.resourceName] }, managed);
    People.ContactGroups.Members.modify({ resourceNamesToAdd: [person.resourceName] }, classLabel);
    Logger.log(`  created ${m.family}, ${m.given} <${email}> -> ${person.resourceName}`);
  }

  // UPDATE (display name) — People API requires the current etag.
  for (const email of toUpdate) {
    const m = desired[email];
    const cur = current[email];
    People.People.updateContact(
      { etag: cur.etag, names: [{ givenName: m.given, familyName: m.family }] },
      cur.resourceName,
      { updatePersonFields: 'names' }
    );
    Logger.log(`  updated <${email}> name -> ${m.family}, ${m.given}`);
  }

  // REMOVE — delete the contact (only ever contacts already in the managed label).
  for (const email of toRemove) {
    People.People.deleteContact(current[email].resourceName);
    Logger.log(`  removed <${email}> (${current[email].resourceName})`);
  }

  Logger.log('Sync complete.');
}

/**
 * Deletes everything the spike created: every contact in the managed label, then
 * the spike's labels (managed + any "CCB Class N"). Scoped — only touches
 * contacts in the managed label.
 */
function contactsSpike_teardown(): void {
  const managed = ensureLabel(MANAGED_LABEL);
  const current = getManagedContacts(managed);
  for (const email of Object.keys(current)) {
    People.People.deleteContact(current[email].resourceName);
    Logger.log(`  deleted contact <${email}>`);
  }
  // Safety net: also delete any fake-data orphan (e.g. a contact created before a
  // partial failure added it to the label). Strongly guarded so it can ONLY match
  // spike data (@example.com / ZZ-SpikeTest) — never a real contact.
  const orphans = deleteSpikeOrphans();
  if (orphans) Logger.log(`  swept ${orphans} orphaned spike contact(s) outside the label`);

  // Delete the spike's labels (managed + class labels created by the sample).
  const list = People.ContactGroups.list({ pageSize: 200 });
  const groups = (list && list.contactGroups) || [];
  for (const g of groups) {
    if (g.name === MANAGED_LABEL || /^CCB Class /.test(g.name || '')) {
      // Advanced services rename REST `delete` -> `remove` (reserved word).
      People.ContactGroups.remove(g.resourceName);
      Logger.log(`  deleted label "${g.name}"`);
    }
  }
  Logger.log('Teardown complete.');
}

/**
 * Deletes contacts matching the fake spike data, wherever they are (used to clean
 * up orphans left by a partial failure). Guard: only deletes when the email ends
 * in @example.com or the name contains ZZ-SpikeTest, so a real contact can never
 * be caught.
 */
function deleteSpikeOrphans(): number {
  const spikeEmails: Record<string, boolean> = {};
  for (const m of SAMPLE) spikeEmails[m.email.toLowerCase()] = true;
  let deleted = 0;
  let pageToken: string | undefined = undefined;
  do {
    const resp: any = People.People.Connections.list('people/me', {
      personFields: 'names,emailAddresses',
      pageSize: 500,
      pageToken,
    });
    for (const p of (resp.connections || [])) {
      const email = ((p.emailAddresses && p.emailAddresses[0] && p.emailAddresses[0].value) || '').toLowerCase();
      const name = (p.names && p.names[0] && p.names[0].displayName) || '';
      const isSpike = (!!email && spikeEmails[email]) || /ZZ-SpikeTest/i.test(name);
      const safe = email.endsWith('@example.com') || /ZZ-SpikeTest/i.test(name);
      if (isSpike && safe) {
        People.People.deleteContact(p.resourceName);
        Logger.log(`  [orphan] deleted ${name} <${email}>`);
        deleted++;
      }
    }
    pageToken = resp.nextPageToken;
  } while (pageToken);
  return deleted;
}

/** Zero-arg wrappers so the editor's Run button can invoke the diff safely. */
function contactsSpike_syncDryRun(): void {
  contactsSpike_syncSample(true);
}
function contactsSpike_syncApply(): void {
  contactsSpike_syncSample(false);
}

export {
  contactsSpike_listManaged,
  contactsSpike_syncDryRun,
  contactsSpike_syncApply,
  contactsSpike_teardown,
};
