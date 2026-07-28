/**
 * The backbone rule set (R/F engines). Each rule reads the ReconContext and
 * emits advisory findings — it never mutates. Tiers:
 *   🛑 block   — halts the sync until fixed (fatal data problems);
 *   ⚠️ confirm — a human must OK it (uncertain matches, contradictions);
 *   ℹ️ fyi     — informational (expected-but-worth-noting).
 *
 * Deliberately deterministic and conservative (over-flag rather than miss) — the
 * fuzzy AI same-person / resurrection judgements are a later spiral. Every
 * finding carries a stable `key` so a resolution can be remembered across runs
 * (the #1 failure mode is false-positive fatigue training rubber-stamping).
 */

import { Finding, FindingCode, Tier, Engine } from './types';
import { ReconContext, MasterLink, findMemberContact, findRegisterRows, findContactRows } from './match';
import { ContactRecord } from './types';
import { nameKey, emailKey, isEmailShaped, isPhoneShaped } from './normalize';
import { voteSpelling, looksLikeTypo, SpellingVote, SpellingEntry } from './spelling';
import { splitClassIds } from '../classid';

/** Statuses that mean "this person is leaving / has left". */
const DROPOUT_STATUS = /drop|non.?renew|resign|left|quit|cancel|withdraw/i;

/**
 * Heuristic for a child/dependent Master row: parent/age annotations embedded in
 * the name ("- mother Ola", "Zélie 5 ans"), or a combined-sibling "/" given
 * name. Dependents legitimately have TOTAL PAID = 0 (covered under a parent), so
 * they must not be flagged unpaid.
 */
function isLikelyDependent(rawName: string): boolean {
  return /\bmother\b|\bfather\b|\bparent\b|m[eè]re|p[eè]re|maman|\d+\s*ans\b|\//i.test(rawName);
}


/** Builds a finding with a stable, resolution-friendly key from its subjects. */
function make(
  code: FindingCode,
  tier: Tier,
  engine: Engine,
  message: string,
  subjects: string[],
  location?: string
): Finding {
  const norm = subjects
    .map((s) => (s.includes('@') ? emailKey(s) : nameKey(s)))
    .filter(Boolean)
    .sort();
  return { code, tier, engine, message, subjects, key: `${code}::${norm.join('|')}`, location };
}

/** True when an app member's stored expiry is in the future relative to `now`. */
function isActive(expiryDate: string, now: Date): boolean {
  if (!expiryDate) return false;
  const d = new Date(expiryDate);
  return !isNaN(d.getTime()) && d > now;
}

/**
 * Runs every backbone rule and returns the flat findings list.
 * `now` is injectable for deterministic tests.
 */
export function runRules(ctx: ReconContext, now: Date = new Date()): Finding[] {
  const out: Finding[] = [];
  out.push(...nameCollisions(ctx));
  out.push(...crossPresence(ctx, now));
  out.push(...linkQuality(ctx));
  out.push(...statusContradictions(ctx));
  out.push(...classChecks(ctx));
  out.push(...emailChecks(ctx));
  out.push(...emailDrift(ctx));
  out.push(...childrenAggregated(ctx));
  out.push(...spellingDisagreements(ctx));
  return out;
}

/**
 * ⚠️ A current member whose app email differs from the email Contacts holds for
 * them. The app is what the sync projects TO Contacts, so a mismatch means one is
 * stale — and since the org actually emails via Contacts, the Contacts address is
 * often the live one. Advisory: confirm which is current and fix the app.
 */
function emailDrift(ctx: ReconContext): Finding[] {
  const out: Finding[] = [];
  for (const link of ctx.links) {
    if (!link.app || !isEmailShaped(link.app.email)) continue;
    const appKey = emailKey(link.app.email);
    for (const c of findContactRows(ctx, link.app.rawName)) {
      if (!isEmailShaped(c.email) || emailKey(c.email) === appKey) continue;
      out.push(
        make(
          'email-drift',
          'confirm',
          'rule',
          `"${link.app.rawName}" has email ${link.app.email} in the app but ${c.email} in Contacts (contact "${c.rawName}"). The app is the source the sync projects to Contacts — confirm which address is current and fix the app if needed.`,
          [link.app.rawName, link.app.email, c.email]
        )
      );
    }
  }
  return out;
}

/**
 * Gathers how each source spells one person, anchored on the Master row. Only the
 * PRECISE Register matches (name/annotation, never the coarse household bridge)
 * and a confident app link count as the same person, so the vote never compares
 * two genuinely different names. The app name is included only when we're sure
 * it's them (exact/fuzzy) — a bridge link is a different household name.
 */
function spellingCluster(ctx: ReconContext, link: MasterLink): SpellingEntry[] {
  const entries: SpellingEntry[] = [{ source: 'Master', name: link.master.rawName }];
  if (link.app && (link.kind === 'exact' || link.kind === 'fuzzy')) {
    entries.push({ source: 'App', name: link.app.rawName, email: link.app.email });
  }
  // Exact-key matches AND per-token near-miss typos (which an exact key can't
  // catch — the typo itself changes the key), deduped. `looksLikeTypo` keeps
  // different given names (siblings "June"/"Jade") out of the cluster.
  const regRows = new Set([
    ...findRegisterRows(ctx, link.master.rawName),
    ...ctx.input.register.filter((r) => looksLikeTypo(link.master.rawName, r.rawName)),
  ]);
  for (const r of regRows) {
    entries.push({ source: 'Register', name: r.rawName, email: r.email });
  }

  // Contacts are the same person by precise name, a typo of it, OR the linked app
  // record's email — the email join lets a differently-spelled contact still vote.
  const contactRows = new Set<ContactRecord>([
    ...findContactRows(ctx, link.master.rawName),
    ...ctx.contacts.filter((c) => looksLikeTypo(link.master.rawName, c.rawName)),
  ]);
  if (link.app && (link.kind === 'exact' || link.kind === 'fuzzy') && isEmailShaped(link.app.email)) {
    for (const c of ctx.contactByEmail.get(emailKey(link.app.email)) || []) contactRows.add(c);
  }
  for (const c of contactRows) {
    entries.push({ source: 'Contacts', name: c.rawName, email: c.email });
  }
  return entries;
}

/** Turns a spelling vote into an advisory suffix — the suggestion + why + which source to fix. */
function suggestionText(vote: SpellingVote | null): string {
  if (!vote || !vote.likely) return '';
  const fixes = [...new Set(vote.outliers.map((o) => `the ${o.source} ("${o.display}")`))];
  const lead = vote.conflicted ? 'Possibly correct' : 'Likely correct';
  const action = vote.conflicted
    ? `check ${fixes.join(' and ')} before changing anything`
    : `the likely fix is ${fixes.join(' and ')}`;
  return ` ${lead}: "${vote.likely}" — ${vote.reason}; ${action}.`;
}

/** 🛑 Same name on two distinct records within a source breaks the unique-name join key. */
function nameCollisions(ctx: ReconContext): Finding[] {
  const out: Finding[] = [];
  const scan = (records: { rawName: string }[], source: string) => {
    const byKey = new Map<string, string[]>();
    for (const r of records) {
      const k = nameKey(r.rawName);
      if (!k) continue;
      const arr = byKey.get(k);
      if (arr) arr.push(r.rawName);
      else byKey.set(k, [r.rawName]);
    }
    for (const [, names] of byKey) {
      if (names.length > 1) {
        out.push(
          make(
            'name-collision',
            'block',
            'rule',
            `The name "${names[0]}" appears ${names.length} times in the ${source}. Names must be unique — make them distinct (in both the app and the spreadsheet) before syncing.`,
            [names[0]],
            source
          )
        );
      }
    }
  };
  scan(ctx.input.app, 'app members');
  scan(ctx.input.master, 'Master');
  return out;
}

/** ⚠️/ℹ️ Presence mismatches between Master and the app. */
function crossPresence(ctx: ReconContext, now: Date): Finding[] {
  const out: Finding[] = [];

  // Master members with no app record. This is NOT a discrepancy in itself — it's
  // exactly what the "Update the Borrowers sheet" and Contacts tools exist to
  // create. Split by how confidently we can find an email to create them WITH:
  //   - a Register email matched by name       → ℹ️ fyi   (the tools can add them);
  //   - only a same-surname household email     → ⚠️ confirm (a guess — verify first);
  //   - no email anywhere                       → 🛑 block  (they can't be created at all).
  const creatable: string[] = [];
  const household: { name: string; value: string; kind: string; from: string; source: string }[] = [];
  const uncreatable: string[] = [];
  for (const link of ctx.links) {
    if (link.kind !== 'none') continue;
    const hit = findMemberContact(ctx, link.master.rawName);
    if (!hit) uncreatable.push(link.master.rawName);
    else if (hit.via === 'name') creatable.push(link.master.rawName);
    else household.push({ name: link.master.rawName, value: hit.value, kind: hit.kind, from: hit.sourceName || '', source: hit.source });
  }
  if (creatable.length > 0) {
    const names = creatable.sort();
    out.push(
      make(
        'master-not-in-app',
        'fyi',
        'rule',
        `${names.length} Master member(s) aren't in the app yet — the "Update the Borrowers sheet" and Contacts tools can add them (an email or phone was found by name in the Register or Contacts): ${names.join(', ')}.`,
        names
      )
    );
  }
  if (household.length > 0) {
    const names = household.map((h) => h.name).sort();
    const detail = household
      .map((h) => `${h.name} → ${h.value} (${h.kind}, from ${h.source} "${h.from}")`)
      .sort()
      .join('; ');
    out.push(
      make(
        'master-household-email',
        'confirm',
        'rule',
        `${household.length} Master member(s) aren't in the app and have no exact name match, but the Register or Contacts has an email or phone under the same surname (a household guess — verify each is the right person before creating them): ${detail}.`,
        names
      )
    );
  }
  if (uncreatable.length > 0) {
    const names = uncreatable.sort();
    out.push(
      make(
        'master-no-email',
        'block',
        'rule',
        `${names.length} Master member(s) aren't in the app and have no contact detail anywhere (no email or phone in the app, the Register, or Contacts under their name or surname), so they can't be created. Add them by hand with an email or phone, or put one in the Register, then re-run: ${names.join(', ')}.`,
        names
      )
    );
  }

  // App members still active but absent from this year's Master. This is the
  // normal year-end state — people who haven't re-enrolled yet, whose prior
  // membership hasn't lapsed. Flagging each one individually is false-positive
  // noise, so it's ONE informational rollup (self-heals as expiries lapse).
  const stillActive = ctx.unmatchedApp.filter((a) => isActive(a.expiryDate, now));
  if (stillActive.length > 0) {
    const names = stillActive.map((a) => a.rawName).sort();
    out.push(
      make(
        'app-active-not-in-master',
        'fyi',
        'rule',
        `${names.length} app member(s) are still active but aren't in this year's Master — most likely they simply haven't re-enrolled yet and will expire naturally. Review only if you expected them to renew: ${names.join(', ')}.`,
        names
      )
    );
  }
  return out;
}

/** ⚠️ Uncertain links (fuzzy name / email bridge) — always human-confirmed, never auto-applied. */
function linkQuality(ctx: ReconContext): Finding[] {
  const out: Finding[] = [];
  for (const link of ctx.links) {
    if (!link.app) continue;
    if (link.kind === 'fuzzy') {
      const suggestion = suggestionText(voteSpelling(spellingCluster(ctx, link)));
      // With a suggestion, the vote carries the "same person or not?" nuance; without
      // one, add a short caution that references THIS pair (not a canned example).
      const tail = suggestion || ' They could be one misspelled name or two different people — confirm before making them match.';
      out.push(
        make(
          'fuzzy-name-match',
          'block',
          'fuzzy',
          `Master "${link.master.rawName}" looks like app member "${link.app.rawName}" (edit distance ${link.distance}), but the names aren't identical. Names must match exactly to sync — fix the name in the app or the Master so they agree.${tail}`,
          [link.master.rawName, link.app.rawName],
          `Master row ${link.master.rowNumber}`
        )
      );
    } else if (link.kind === 'email-bridge') {
      out.push(
        make(
          'email-bridge-match',
          'confirm',
          'fuzzy',
          `Master "${link.master.rawName}" was matched to app member "${link.app.rawName}" only via a shared Register email (${link.bridgeEmail}) — their names differ. Confirm this is the right person/household.`,
          [link.master.rawName, link.app.rawName, link.bridgeEmail || ''],
          `Master row ${link.master.rowNumber}`
        )
      );
    }
  }
  return out;
}

/** ⚠️/ℹ️ Status contradictions read across sources. */
function statusContradictions(ctx: ReconContext): Finding[] {
  const out: Finding[] = [];

  // Master rows that fold under a parent record — dependents, exempt from unpaid.
  const siblingKeys = new Set<string>();
  for (const g of ctx.siblingGroups) for (const m of g.masters) siblingKeys.add(nameKey(m.rawName));

  const unpaidAdults: string[] = [];
  for (const m of ctx.input.master) {
    const leaving = DROPOUT_STATUS.test(m.status);

    // Dropout/non-renewal in the Master yet still attending a class in the Register.
    if (leaving && findRegisterRows(ctx, m.rawName).length > 0) {
      out.push(
        make(
          'dropout-contradiction',
          'confirm',
          'rule',
          `"${m.rawName}" is marked "${m.status}" in the Master but still appears in the Register (attending a class). Resolve which is correct.`,
          [m.rawName],
          `Master row ${m.rowNumber}`
        )
      );
    }

    // Active but no payment — excluding dependents (children pay 0 under a parent).
    if (!leaving && m.paid === false && !isLikelyDependent(m.rawName) && !siblingKeys.has(nameKey(m.rawName))) {
      unpaidAdults.push(m.rawName);
    }
  }

  // One informational rollup — advisory, and the sync writes expiry regardless.
  if (unpaidAdults.length > 0) {
    const names = unpaidAdults.sort();
    out.push(
      make(
        'unpaid-but-active',
        'fyi',
        'rule',
        `${names.length} active member(s) show no payment in the Master (dependents/children excluded). Informational — the sync still writes their expiry: ${names.join(', ')}.`,
        names
      )
    );
  }
  return out;
}

/** ⚠️ Class-assignment problems: nonexistent class, or Master vs Register disagreement. */
function classChecks(ctx: ReconContext): Finding[] {
  const out: Finding[] = [];
  // A roster class id may itself be combined; expand so "11" and "12" are valid.
  const valid = new Set(ctx.input.roster.validClassIds.flatMap(splitClassIds));

  for (const m of ctx.input.master) {
    // A Master class number can name multiple classes ("11 & 12" = both 11 and 12).
    const mClasses = splitClassIds(m.classNumber);
    if (mClasses.length === 0) continue;

    const unknown = mClasses.filter((c) => !valid.has(c));
    if (valid.size > 0 && unknown.length > 0) {
      out.push(
        make(
          'nonexistent-class',
          'confirm',
          'rule',
          `"${m.rawName}" is assigned to class "${m.classNumber}", which isn't in the canonical class roster (unknown: ${unknown.join(', ')}). Fix the class or update the roster.`,
          [m.rawName],
          `Master row ${m.rowNumber}`
        )
      );
    }

    // Disagreement only when NONE of the person's Register classes is one of
    // their Master classes — so someone in "11 & 12" whom the Register shows in
    // class 11 agrees (they're genuinely in two classes; an extra Register class
    // isn't a conflict). A totally different class ("9" vs "4") is a real conflict.
    const regClasses = [...new Set(findRegisterRows(ctx, m.rawName).flatMap((r) => splitClassIds(r.classId)))];
    if (regClasses.length > 0 && !regClasses.some((rc) => mClasses.includes(rc))) {
      out.push(
        make(
          'class-disagreement',
          'confirm',
          'rule',
          `"${m.rawName}" is class "${m.classNumber}" in the Master but the Register has them in "${regClasses.join(', ')}". Class assignment is authoritative from the Master — confirm and fix the Register if needed.`,
          [m.rawName],
          `Master row ${m.rowNumber}`
        )
      );
    }
  }
  return out;
}

/** ⚠️/ℹ️ Email problems on current members (the app records the sync will project to Contacts). */
function emailChecks(ctx: ReconContext): Finding[] {
  const out: Finding[] = [];

  // Only current members (an app record linked to a Master row this year) matter here.
  const current = new Map<string, { rawName: string; email: string; phone?: string }>();
  for (const link of ctx.links) {
    if (link.app) current.set(link.app.id, link.app);
  }

  const byEmail = new Map<string, string[]>();
  for (const a of current.values()) {
    if (!a.email || !a.email.trim()) {
      // A phone-only member is still a valid contact (reachable by phone, projected
      // to the Contacts phone field) — only a member with NEITHER blocks the sync.
      if (a.phone && isPhoneShaped(a.phone)) continue;
      out.push(
        make(
          'missing-email',
          'block',
          'rule',
          `Current member "${a.rawName}" has no email or phone in the app, so they can't be added to Gmail Contacts. Add one before syncing.`,
          [a.rawName]
        )
      );
      continue;
    }
    if (!isEmailShaped(a.email)) {
      out.push(
        make(
          'malformed-email',
          'block',
          'rule',
          `Current member "${a.rawName}" has a malformed email ("${a.email}"). Fix it in the app before syncing.`,
          [a.rawName]
        )
      );
      continue;
    }
    const k = emailKey(a.email);
    const arr = byEmail.get(k);
    if (arr) arr.push(a.rawName);
    else byEmail.set(k, [a.rawName]);
  }

  for (const [email, names] of byEmail) {
    if (names.length > 1) {
      out.push(
        make(
          'duplicate-email',
          'confirm',
          'rule',
          `Email ${email} is shared by ${names.length} distinct current members (${names.join(', ')}). If they're one household this may be fine, but confirm they aren't a duplicate record.`,
          [email, ...names]
        )
      );
    }
  }
  return out;
}

/**
 * ⚠️ The same person spelled differently across sources — a likely typo. Fuzzy
 * Master↔App name mismatches are already surfaced (and blocked) by
 * `fuzzy-name-match`, so this covers the rest: mainly a Master vs Register letter
 * difference the pairwise class check would miss unless the class also differed.
 * Advisory only — it suggests the fix but changes nothing.
 */
function spellingDisagreements(ctx: ReconContext): Finding[] {
  const out: Finding[] = [];
  for (const link of ctx.links) {
    if (link.kind === 'fuzzy') continue; // covered by the fuzzy-name-match block
    const vote = voteSpelling(spellingCluster(ctx, link));
    if (!vote) continue;
    const list = vote.variants.map((v) => `${v.sources.join('+')} "${v.display}"`).join('; ');
    out.push(
      make(
        'spelling-disagreement',
        'confirm',
        'fuzzy',
        `"${link.master.rawName}" is spelled inconsistently across sources: ${list}.${suggestionText(vote)} Nothing is changed automatically — correct whichever source is wrong, then re-run.`,
        vote.variants.map((v) => v.display),
        `Master row ${link.master.rowNumber}`
      )
    );
  }
  return out;
}

/** ℹ️ Document the children-under-one-parent aggregation so the admin sees it's intentional. */
function childrenAggregated(ctx: ReconContext): Finding[] {
  return ctx.siblingGroups.map((g) =>
    make(
      'children-aggregated',
      'fyi',
      'rule',
      `${g.masters.length} Master rows (${g.masters
        .map((m) => m.rawName)
        .join(', ')}) map to the single app record "${g.app.rawName}" — the org keeps dependents under one parent. Their expiries/labels all apply to that record.`,
      [g.app.rawName, ...g.masters.map((m) => m.rawName)]
    )
  );
}
