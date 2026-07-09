/**
 * Change plan (pure) — a PREVIEW of what the write phase would do to the app's
 * Borrowers sheet, computed during detection but never executed. Borrowers is
 * production data, so nothing is written yet; this just shows the admin what a
 * future "apply" would change.
 *
 * The only app write the sync ever makes is the membership EXPIRY. So the plan
 * is: for each current member (an app record matched to a Master row this year),
 * would their stored expiry change to the uniform school-year expiry? Non-current
 * app records (the bulk of the 1000+ historical borrowers) are never touched and
 * never appear here.
 */

import { ReconContext } from './detector';
import { AppMember } from './detector/types';

/** One member whose stored expiry would change. */
export interface ExpiryChange {
  id: string;
  name: string;
  /** The member's current app expiry, verbatim ('(none)' if blank). */
  fromRaw: string;
  /** The uniform expiry it would be set to (ISO). */
  toISO: string;
}

/** The full preview of app-member changes. */
export interface ChangePlan {
  targetExpiryISO: string;
  /** Current members whose expiry differs from the target and would be written. */
  toUpdate: ExpiryChange[];
  /** Current members already at the target expiry — no write needed. */
  alreadyCurrentCount: number;
  /** Master members with no app record — can't be written until added by hand. */
  cannotWriteYet: string[];
  /** Distinct app records that are current members this year. */
  currentMemberCount: number;
  /** Of `toUpdate`, how many are reached ONLY via an unconfirmed fuzzy/email match. */
  viaUnconfirmedMatch: number;
}

/** Parses a stored date ('September 1, 2027' or ISO) to 'yyyy-MM-dd', or '' if unparseable. */
export function toISODate(s: string): string {
  const t = (s || '').trim();
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Builds the expiry-write preview from a reconciliation context + the uniform target expiry. */
export function planExpiryWrites(ctx: ReconContext, targetExpiryISO: string): ChangePlan {
  // Collect distinct current app members, tracking how they were matched.
  const current = new Map<string, { member: AppMember; kinds: Set<string> }>();
  const cannotWriteYet: string[] = [];
  for (const link of ctx.links) {
    if (link.app) {
      const e = current.get(link.app.id) || { member: link.app, kinds: new Set<string>() };
      e.kinds.add(link.kind);
      current.set(link.app.id, e);
    } else if (link.kind === 'none') {
      cannotWriteYet.push(link.master.rawName);
    }
  }

  const toUpdate: ExpiryChange[] = [];
  let alreadyCurrentCount = 0;
  let viaUnconfirmedMatch = 0;
  for (const { member, kinds } of current.values()) {
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
    // "certain" only if at least one link to this member was an exact name match.
    if (!kinds.has('exact')) viaUnconfirmedMatch++;
  }

  toUpdate.sort((a, b) => a.name.localeCompare(b.name));
  cannotWriteYet.sort();

  return {
    targetExpiryISO,
    toUpdate,
    alreadyCurrentCount,
    cannotWriteYet,
    currentMemberCount: current.size,
    viaUnconfirmedMatch,
  };
}
