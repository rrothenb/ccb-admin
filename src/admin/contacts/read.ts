/**
 * Reads the master account's Gmail Contacts as a detector source (GAS side).
 *
 * READ-ONLY — this is the one place the detector touches Contacts, and it only
 * lists them (the projection spoke is the only writer). Every contact in the
 * production account is/was a member, so the whole connection list is relevant;
 * we pull just the primary name + email each carries.
 */

// The People advanced service global is provided by GAS at runtime once enabled.
declare const People: any;

import { ContactRecord } from '../detector/types';

/** Lists every contact (paginated) as `{rawName, email}`. Returns [] rather than throwing. */
export function readAllContacts(): ContactRecord[] {
  const out: ContactRecord[] = [];
  let pageToken: string | undefined;
  do {
    const resp = People.People.Connections.list('people/me', {
      personFields: 'names,emailAddresses,phoneNumbers',
      pageSize: 1000,
      pageToken,
      sortOrder: 'LAST_MODIFIED_DESCENDING',
    });
    for (const p of resp.connections || []) {
      const email = ((p.emailAddresses && p.emailAddresses[0] && p.emailAddresses[0].value) || '').trim();
      const phone = ((p.phoneNumbers && p.phoneNumbers[0] && p.phoneNumbers[0].value) || '').trim();
      const rawName = ((p.names && p.names[0] && p.names[0].displayName) || '').trim();
      if (rawName || email || phone) out.push({ rawName, email, phone });
    }
    pageToken = resp.nextPageToken;
  } while (pageToken);
  return out;
}
