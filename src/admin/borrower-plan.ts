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
 * A write is emitted ONLY for an unambiguous EXACT name match (update) or a
 * Master row with no name match at all AND a usable, unshared email (add).
 * Anything reached via a fuzzy/near name, an email bridge, a colliding name, or
 * a missing/shared email is NOT written — but it is NEVER silently dropped: it
 * goes into `skipped` with a reason so the admin can see and fix it.
 *
 * Because `reconcile` only returns an `exact` link when the app name is UNIQUE
 * (and a Master row that resembles an existing app name comes back `fuzzy`, not
 * `none`), these guarantees fall out structurally: an exact update can't hit the
 * wrong record, and an add can't shadow a name the app already knows.
 *
 * Pure module — no GAS. The GAS spoke (borrower-sync.ts) turns this into writes.
 */

import { ReconContext } from './detector';
import { AppMember, MasterRow } from './detector/types';
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
}

/** A Master person not yet in Borrowers who would be added. */
export interface BorrowerAddition {
  /** The Master name, used verbatim as the new Borrower's name. */
  name: string;
  /** Household email recovered from the Register — the new record's email. */
  email: string;
  /** The uniform expiry (ISO) the new record gets. */
  expiryISO: string;
  /** 1-based Master row, so the admin can trace it back. */
  masterRow: number;
}

/** Why a Master person / current member was deliberately NOT written. */
export type SkipReason =
  | 'ambiguous-match'    // reached only via a fuzzy name or email bridge — could be the wrong person
  | 'name-collision'     // the name isn't unique in the Master — can't tell the rows apart
  | 'no-email'           // not in the app and the Register carries no usable email to add them with
  | 'shared-email'       // several new people would share one email — needs a manual household call
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

  // --- Expiry updates: exact-matched current members only (deduped by app id) ---
  const exactByAppId = new Map<string, AppMember>();
  const addCandidates: MasterRow[] = [];

  for (const link of ctx.links) {
    if (link.kind === 'exact' && link.app) {
      // An exact link is unique on the app side; only a colliding Master name spoils it.
      if (masterAmbiguous(link.master)) {
        skipped.push({
          name: link.master.rawName,
          reason: 'name-collision',
          detail: `"${link.master.rawName}" is not unique in the Master, so its expiry can't be safely written. Make the names distinct, then re-run.`,
        });
        continue;
      }
      // Last exact link wins the id slot; siblings can't reach here (they bridge, not exact).
      exactByAppId.set(link.app.id, link.app);
    } else if (link.app && (link.kind === 'fuzzy' || link.kind === 'email-bridge')) {
      const how =
        link.kind === 'fuzzy'
          ? `resembles app member "${link.app.rawName}" but the names differ`
          : `was matched to app member "${link.app.rawName}" only via a shared Register email`;
      skipped.push({
        name: `${link.master.rawName} ↔ ${link.app.rawName}`,
        reason: 'ambiguous-match',
        detail: `"${link.master.rawName}" ${how}. Not written — confirm they're the same person (make the names match to update, or ignore).`,
      });
    } else if (link.kind === 'none') {
      addCandidates.push(link.master);
    }
  }

  const toUpdate: BorrowerExpiryUpdate[] = [];
  let alreadyCurrentCount = 0;
  for (const member of exactByAppId.values()) {
    if (toISODate(member.expiryDate) === targetExpiryISO) {
      alreadyCurrentCount++;
      continue;
    }
    toUpdate.push({
      id: member.id,
      name: member.rawName,
      fromRaw: member.expiryDate ? member.expiryDate : '(none)',
      toISO: targetExpiryISO,
    });
  }
  toUpdate.sort((a, b) => a.name.localeCompare(b.name));

  // --- Additions: Master rows with no app record + a usable, unshared email ---
  // First resolve each candidate's email (or skip it), then guard shared emails.
  const withEmail: { master: MasterRow; email: string }[] = [];
  for (const master of addCandidates) {
    if (masterAmbiguous(master)) {
      skipped.push({
        name: master.rawName,
        reason: 'name-collision',
        detail: `"${master.rawName}" is not unique in the Master, so it can't be safely added. Make the names distinct, then re-run.`,
      });
      continue;
    }
    const email = ctx.registerEmailByNameKey.get(nameKey(master.rawName)) || '';
    if (!isEmailShaped(email)) {
      skipped.push({
        name: master.rawName,
        reason: 'no-email',
        detail: `"${master.rawName}" isn't in the app and the Register has no usable email for them. Add them by hand (with an email), or fix the Register.`,
      });
      continue;
    }
    withEmail.push({ master, email });
  }

  // Group by email so a household that would collapse to one address is surfaced,
  // never silently duplicated into several same-email records.
  const byEmail = new Map<string, { master: MasterRow; email: string }[]>();
  for (const cand of withEmail) {
    const k = emailKey(cand.email);
    const arr = byEmail.get(k);
    if (arr) arr.push(cand);
    else byEmail.set(k, [cand]);
  }

  const toAdd: BorrowerAddition[] = [];
  for (const [k, group] of byEmail) {
    if (group.length > 1) {
      const names = group.map((g) => g.master.rawName).sort();
      for (const g of group) {
        skipped.push({
          name: g.master.rawName,
          reason: 'shared-email',
          detail: `${names.length} new people (${names.join(', ')}) would share the email ${group[0].email}. Add the household once by hand instead of creating duplicates.`,
        });
      }
      continue;
    }
    // Belt-and-braces: never add an email an app record already owns (a 'none'
    // link shouldn't carry an in-app email, but guard the write regardless).
    if (ctx.appByEmail.has(k)) {
      skipped.push({
        name: group[0].master.rawName,
        reason: 'email-in-app',
        detail: `The email ${group[0].email} already belongs to an app member under a different name. Not added — reconcile the names by hand.`,
      });
      continue;
    }
    const { master, email } = group[0];
    toAdd.push({ name: master.rawName, email, expiryISO: targetExpiryISO, masterRow: master.rowNumber });
  }
  toAdd.sort((a, b) => a.name.localeCompare(b.name));

  skipped.sort((a, b) => a.reason.localeCompare(b.reason) || a.name.localeCompare(b.name));

  return { targetExpiryISO, toUpdate, toAdd, alreadyCurrentCount, skipped };
}
