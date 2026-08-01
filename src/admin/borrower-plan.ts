/**
 * Borrowers write plan (pure) — the reverse spoke of the sync: projecting the
 * current-year cohort back INTO the app's own Borrowers sheet. Two operations:
 *
 *   1. ADD a missing member  — a Master person with NO app record, using the
 *      household email the Register carries (name + email + expiry).
 *   2. UPDATE an expiry       — a Master person already in Borrowers, whose
 *      stored expiry differs from this year's uniform expiry. Only the expiry
 *      field is touched; name/email/etc. are left exactly as they are.
 *
 * The governing rule is SAFETY: we only ever write a name we are certain about.
 * An expiry update goes to an unambiguous EXACT name match, or to the household
 * record a Master row bridges to by shared email (that IS the record the org
 * keeps that person under — see SiblingGroup — and the write only ever moves the
 * expiry). An add needs a Master row with no name match at all plus a usable,
 * unshared contact detail. A fuzzy/near name, a colliding name, or a missing/
 * shared/taken contact detail is NOT written — but never silently dropped: it
 * goes into `skipped` with a reason so the admin can see and fix it.
 *
 * Every remaining skip reason has a matching 🛑 block-tier detector finding
 * (fuzzy-name-match, name-collision, master-no-email, shared-new-contact,
 * new-email-in-app), which gives the whole tool its central invariant:
 *
 *     a detection run with no blocking findings ⇒ this plan has NO skips.
 *
 * So "detect is clean" and "the Borrowers write can proceed" mean the same thing;
 * the advisory ⚠️/ℹ️ findings never silently withhold a write.
 *
 * Because `reconcile` only returns an `exact` link when the app name is UNIQUE
 * (and a Master row that resembles an existing app name comes back `fuzzy`, not
 * `none`), these guarantees fall out structurally: an exact update can't hit the
 * wrong record, and an add can't shadow a name the app already knows.
 *
 * Pure module — no GAS. The GAS spoke (borrower-sync.ts) turns this into writes.
 */

import { ReconContext, resolveNewMembers } from './detector';
import { AppMember, MasterRow } from './detector/types';
import { MemberContactHit } from './detector/match';
import { nameKey, emailKey, isEmailShaped } from './detector/normalize';
import { toISODate } from './plan';

/** An existing Borrower whose stored expiry would be moved to the target. */
export interface BorrowerExpiryUpdate {
  id: string;
  /** The app record's name (what actually gets kept — only the expiry changes). */
  name: string;
  /** Current app expiry, verbatim ('(none)' if blank). */
  fromRaw: string;
  /** The uniform expiry it would be set to (ISO). */
  toISO: string;
  /** How the Master row(s) reached this record — an exact name, or a household email bridge. */
  via: 'exact' | 'household-email';
  /** The Master name(s) behind it — several for a household/sibling record. */
  fromMaster: string[];
}

/** A Master person not yet in Borrowers who would be added. */
export interface BorrowerAddition {
  /** The Master name, used verbatim as the new Borrower's name. */
  name: string;
  /** Email for the new record ('' when only a phone was found). */
  email: string;
  /** Phone for the new record ('' when an email was found). */
  phone: string;
  /** Provenance of that contact detail, shown in the preview so the admin can judge it. */
  contactVia: string;
  /** True when the detail is a same-surname household guess rather than a by-name match. */
  contactIsGuess: boolean;
  /** The uniform expiry (ISO) the new record gets. */
  expiryISO: string;
  /** 1-based Master row, so the admin can trace it back. */
  masterRow: number;
}

/** Why a Master person / current member was deliberately NOT written. */
export type SkipReason =
  | 'ambiguous-match'    // reached only via a fuzzy/near name — could be the wrong person
  | 'name-collision'     // the name isn't unique in the Master — can't tell the rows apart
  | 'no-email'           // not in the app and no email or phone anywhere to add them with
  | 'shared-email'       // several new people would share one contact detail — needs a manual household call
  | 'email-in-app';      // that email already belongs to an app record under a different name

export interface BorrowerSkip {
  /** Human-facing subject — the Master name, plus the app name when a match was involved. */
  name: string;
  reason: SkipReason;
  /** One-line explanation for the admin. */
  detail: string;
}

/** The full preview of Borrowers-sheet writes. */
export interface BorrowerWritePlan {
  targetExpiryISO: string;
  /** Existing members whose expiry differs from the target and would be updated. */
  toUpdate: BorrowerExpiryUpdate[];
  /** Master people with no app record who would be added (name + email + expiry). */
  toAdd: BorrowerAddition[];
  /** Existing members already at the target expiry — no write needed. */
  alreadyCurrentCount: number;
  /** Everything we could have written but didn't, each with a reason (never silent). */
  skipped: BorrowerSkip[];
}

/** Month names for ISO → the app's "Month d, yyyy" display/write format. */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Formats an ISO 'yyyy-MM-dd' as the app's "September 1, 2027"; passes non-ISO through. */
export function isoToHuman(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || '').trim());
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

/**
 * Builds the Borrowers write preview from a reconciliation context + the uniform
 * target expiry. Deterministic and side-effect free; the spoke applies it.
 */
export function planBorrowerWrites(ctx: ReconContext, targetExpiryISO: string): BorrowerWritePlan {
  // Names that appear more than once in the Master can't be told apart — treat
  // every occurrence as ambiguous (mirrors the block-tier name-collision rule).
  const masterCountByKey = new Map<string, number>();
  for (const m of ctx.input.master) {
    const k = nameKey(m.rawName);
    if (k) masterCountByKey.set(k, (masterCountByKey.get(k) || 0) + 1);
  }
  const masterAmbiguous = (m: MasterRow) => (masterCountByKey.get(nameKey(m.rawName)) || 0) > 1;

  const skipped: BorrowerSkip[] = [];

  // --- Expiry updates: exact matches AND household-email bridges, per app record ---
  // A bridge link resolves to the record the org actually keeps that person under
  // (the parent/household Borrower), and the only field touched is the expiry —
  // so it is written, and labelled as such in the preview. Several Master rows can
  // land on one record (siblings): they collapse into a single update.
  const updateByAppId = new Map<
    string,
    { app: AppMember; via: 'exact' | 'household-email'; fromMaster: string[] }
  >();

  for (const link of ctx.links) {
    if (link.app && (link.kind === 'exact' || link.kind === 'email-bridge')) {
      // A colliding Master name is the one thing that spoils an otherwise-safe link.
      if (masterAmbiguous(link.master)) {
        skipped.push({
          name: link.master.rawName,
          reason: 'name-collision',
          detail: `"${link.master.rawName}" is not unique in the Master, so its expiry can't be safely written. Make the names distinct, then re-run.`,
        });
        continue;
      }
      const entry = updateByAppId.get(link.app.id);
      if (entry) {
        entry.fromMaster.push(link.master.rawName);
        // An exact name match is the stronger provenance — it wins the label.
        if (link.kind === 'exact') entry.via = 'exact';
      } else {
        updateByAppId.set(link.app.id, {
          app: link.app,
          via: link.kind === 'exact' ? 'exact' : 'household-email',
          fromMaster: [link.master.rawName],
        });
      }
    } else if (link.app && link.kind === 'fuzzy') {
      skipped.push({
        name: `${link.master.rawName} ↔ ${link.app.rawName}`,
        reason: 'ambiguous-match',
        detail: `"${link.master.rawName}" resembles app member "${link.app.rawName}" but the names differ. Not written — make the names match if they're the same person, then re-run.`,
      });
    }
  }

  const toUpdate: BorrowerExpiryUpdate[] = [];
  let alreadyCurrentCount = 0;
  for (const { app: member, via, fromMaster } of updateByAppId.values()) {
    if (toISODate(member.expiryDate) === targetExpiryISO) {
      alreadyCurrentCount++;
      continue;
    }
    toUpdate.push({
      id: member.id,
      name: member.rawName,
      fromRaw: member.expiryDate ? member.expiryDate : '(none)',
      toISO: targetExpiryISO,
      via,
      fromMaster: fromMaster.slice().sort(),
    });
  }
  toUpdate.sort((a, b) => a.name.localeCompare(b.name));

  // --- Additions: Master rows with no app record + a usable, unshared contact detail ---
  // Resolution is `resolveNewMembers` — the very same lookup the detector's rules
  // use — so a person the rules call creatable is exactly one this adds. A
  // household-guess detail is used but flagged, since the preview is where the
  // admin verifies it before anything is written.
  const withContact: { master: MasterRow; hit: MemberContactHit }[] = [];
  for (const { master, hit } of resolveNewMembers(ctx)) {
    if (masterAmbiguous(master)) {
      skipped.push({
        name: master.rawName,
        reason: 'name-collision',
        detail: `"${master.rawName}" is not unique in the Master, so it can't be safely added. Make the names distinct, then re-run.`,
      });
      continue;
    }
    if (!hit) {
      skipped.push({
        name: master.rawName,
        reason: 'no-email',
        detail: `"${master.rawName}" isn't in the app and no email or phone was found for them in the Register or Contacts. Add them by hand (with a contact detail), or put one in the Register.`,
      });
      continue;
    }
    withContact.push({ master, hit });
  }

  // Group by the contact detail so a household that would collapse to one address
  // (or phone) is surfaced, never silently duplicated into several records.
  const detailKey = (hit: MemberContactHit) =>
    hit.kind === 'email' ? `e:${emailKey(hit.value)}` : `p:${hit.value.replace(/\D/g, '')}`;
  const byDetail = new Map<string, { master: MasterRow; hit: MemberContactHit }[]>();
  for (const cand of withContact) {
    const k = detailKey(cand.hit);
    const arr = byDetail.get(k);
    if (arr) arr.push(cand);
    else byDetail.set(k, [cand]);
  }

  const toAdd: BorrowerAddition[] = [];
  for (const group of byDetail.values()) {
    if (group.length > 1) {
      const names = group.map((g) => g.master.rawName).sort();
      for (const g of group) {
        skipped.push({
          name: g.master.rawName,
          reason: 'shared-email',
          detail: `${names.length} new people (${names.join(', ')}) would share ${group[0].hit.value}. Add the household once by hand instead of creating duplicates.`,
        });
      }
      continue;
    }
    const { master, hit } = group[0];
    // Never add an email an app record already owns — that address is the Contacts
    // join key, so a duplicate would collapse two people into one contact.
    if (hit.kind === 'email' && ctx.appByEmail.has(emailKey(hit.value))) {
      skipped.push({
        name: master.rawName,
        reason: 'email-in-app',
        detail: `The email ${hit.value} already belongs to an app member under a different name. Not added — reconcile the names by hand.`,
      });
      continue;
    }
    toAdd.push({
      name: master.rawName,
      email: hit.kind === 'email' && isEmailShaped(hit.value) ? hit.value : '',
      phone: hit.kind === 'phone' ? hit.value : '',
      contactVia:
        hit.via === 'name'
          ? `${hit.kind} from the ${hit.source}, matched by name`
          : `${hit.kind} from the ${hit.source} under the same surname ("${hit.sourceName}") — a household guess`,
      contactIsGuess: hit.via === 'household',
      expiryISO: targetExpiryISO,
      masterRow: master.rowNumber,
    });
  }
  toAdd.sort((a, b) => a.name.localeCompare(b.name));

  skipped.sort((a, b) => a.reason.localeCompare(b.reason) || a.name.localeCompare(b.name));

  return { targetExpiryISO, toUpdate, toAdd, alreadyCurrentCount, skipped };
}
