/**
 * Reconciliation: link each Master row to an App (Borrowers) record, using the
 * three sources synergistically. Name is the only join key the spreadsheets
 * offer, so we try, in order of confidence:
 *   1. exact  — same canonical `nameKey` (silent; no finding);
 *   2. fuzzy  — small Levenshtein on the `tightKey` (surfaced for human confirm,
 *               NEVER auto-merged — Louise/Louisa must not silently collapse);
 *   3. bridge — the App has no name match, but the Register carries a household
 *               email for this person that DOES resolve in the App (e.g.
 *               COISNE → xavier.sion@… → Borrowers "Sion, François-Xavier").
 *
 * Siblings/children fall out for free: when several Master child-rows link to
 * the same App parent record, that App id shows up in >1 link → a SiblingGroup.
 * The org keeps dependents under one parent record, so the sync must map many
 * Master rows → one App member; we detect and preserve that here.
 *
 * Pure module — no GAS. `reconcile` builds a ReconContext the rules consume.
 */

import {
  DetectorInput,
  MasterRow,
  RegisterRow,
  AppMember,
  ContactRecord,
} from './types';
import { nameKey, coreNameKey, householdKey, tightKey, emailKey, levenshtein, isEmailShaped, isPhoneShaped } from './normalize';

/** Max edit distance (on tightKey) for a pair to be offered as a fuzzy candidate. */
export const FUZZY_THRESHOLD = 2;

export type LinkKind = 'exact' | 'fuzzy' | 'email-bridge' | 'none';

/** How one Master row links (or fails to link) to the App. */
export interface MasterLink {
  master: MasterRow;
  app: AppMember | null;
  kind: LinkKind;
  /** Present for fuzzy links: the tightKey edit distance. */
  distance?: number;
  /** Present for email-bridge links: the Register email that bridged the two. */
  bridgeEmail?: string;
}

/** Several Master rows resolving to one App record — the children-under-parent pattern. */
export interface SiblingGroup {
  app: AppMember;
  masters: MasterRow[];
}

/** Everything the rules need after reconciliation — links plus reusable indices. */
export interface ReconContext {
  input: DetectorInput;
  links: MasterLink[];
  /** Look up a Master row's link by its rawName. */
  linkByMasterRaw: Map<string, MasterLink>;
  siblingGroups: SiblingGroup[];
  /** App members never referenced by any Master link. */
  unmatchedApp: AppMember[];
  appByNameKey: Map<string, AppMember[]>;
  appByEmail: Map<string, AppMember[]>;
  registerByNameKey: Map<string, RegisterRow[]>;
  /** nameKey/coreNameKey → household email — covers the whole row, its split siblings, and annotation-stripped forms. */
  registerEmailByNameKey: Map<string, string>;
  /** Coarse surname bucket → the Register emails found under it — a last-resort, human-reviewed email source. */
  registerEmailByHousehold: Map<string, { email: string; rawName: string }[]>;
  /** The account's Gmail Contacts (read-only), plus name/email/surname indices onto them. */
  contacts: ContactRecord[];
  contactByNameKey: Map<string, ContactRecord[]>;
  contactByEmail: Map<string, ContactRecord[]>;
  contactEmailByNameKey: Map<string, string>;
  contactEmailByHousehold: Map<string, { email: string; rawName: string }[]>;
  /** Phone equivalents — a member with no email may still have a phone to create them with. */
  registerPhoneByNameKey: Map<string, string>;
  registerPhoneByHousehold: Map<string, { phone: string; rawName: string }[]>;
  contactPhoneByNameKey: Map<string, string>;
  contactPhoneByHousehold: Map<string, { phone: string; rawName: string }[]>;
}

/**
 * Every key a Register row should be indexed under: the whole name AND each
 * split sibling, each in both its plain `nameKey` and annotation-stripped
 * `coreNameKey` form. Indexing the WHOLE name (not just the split parts) is what
 * lets "CELARIER Fraudet / Alban" — where "/" separates surname from given, not
 * sibling from sibling — line up with the Master's "CELARIER-FRAUDET, Alban".
 */
function registerIndexKeys(rawName: string): string[] {
  const keys = new Set<string>();
  const add = (n: string) => {
    for (const k of [nameKey(n), coreNameKey(n)]) if (k) keys.add(k);
  };
  add(rawName);
  for (const sub of expandRegisterNames(rawName)) add(sub);
  return [...keys];
}

/** The keys a Master name can match a Register index on: its plain and annotation-stripped forms. */
export function masterLookupKeys(rawName: string): string[] {
  const a = nameKey(rawName);
  const b = coreNameKey(rawName);
  return a === b ? [a] : [a, b];
}

/** All Register rows attributable to a Master name (annotation-tolerant), deduped. */
export function findRegisterRows(ctx: ReconContext, rawName: string): RegisterRow[] {
  const seen = new Set<RegisterRow>();
  for (const k of masterLookupKeys(rawName)) {
    for (const r of ctx.registerByNameKey.get(k) || []) seen.add(r);
  }
  return [...seen];
}

/** All Contacts attributable to a name (annotation-tolerant), deduped. */
export function findContactRows(ctx: ReconContext, rawName: string): ContactRecord[] {
  const seen = new Set<ContactRecord>();
  for (const k of masterLookupKeys(rawName)) {
    for (const c of ctx.contactByNameKey.get(k) || []) seen.add(c);
  }
  return [...seen];
}

/** A contact detail (email or phone) located for a Master member, tagged with HOW/WHERE. */
export interface MemberContactHit {
  /** The email or phone number found. */
  value: string;
  /** Which kind of contact detail it is — so the caller can use the right field. */
  kind: 'email' | 'phone';
  /** 'name' = matched the person's (possibly annotated) name — confident. 'household' = same-surname guess — verify. */
  via: 'name' | 'household';
  /** Which source supplied it. */
  source: 'Register' | 'Contacts';
  /** For household hits: the source name the detail came from. */
  sourceName?: string;
}

/**
 * Finds a contact detail to create a not-yet-in-app Master member with. Prefers,
 * in order: an email by name (Register → Contacts), a phone by name (Register →
 * Contacts), then the same-surname household fallbacks (email first, then phone).
 * Email is preferred over phone because the org emails classes; a phone still
 * counts as usable contact info so a phone-only member isn't left un-creatable.
 * Household hits are tagged so the caller can flag them; Contacts/phones are
 * corroboration, never trusted as identity on their own.
 */
export function findMemberContact(ctx: ReconContext, rawName: string): MemberContactHit | null {
  const keys = masterLookupKeys(rawName);
  const hk = householdKey(rawName);

  const byName = (
    map: Map<string, string>,
    kind: 'email' | 'phone',
    source: 'Register' | 'Contacts',
    ok: (v: string) => boolean
  ): MemberContactHit | null => {
    for (const k of keys) {
      const v = map.get(k);
      if (v && ok(v)) return { value: v, kind, via: 'name', source };
    }
    return null;
  };
  const byHousehold = (
    map: Map<string, { email?: string; phone?: string; rawName: string }[]>,
    kind: 'email' | 'phone',
    source: 'Register' | 'Contacts'
  ): MemberContactHit | null => {
    const rows = hk ? map.get(hk) : undefined;
    if (!rows || !rows.length) return null;
    const v = kind === 'email' ? rows[0].email : rows[0].phone;
    return v ? { value: v, kind, via: 'household', source, sourceName: rows[0].rawName } : null;
  };

  return (
    byName(ctx.registerEmailByNameKey, 'email', 'Register', isEmailShaped) ||
    byName(ctx.contactEmailByNameKey, 'email', 'Contacts', isEmailShaped) ||
    byName(ctx.registerPhoneByNameKey, 'phone', 'Register', isPhoneShaped) ||
    byName(ctx.contactPhoneByNameKey, 'phone', 'Contacts', isPhoneShaped) ||
    byHousehold(ctx.registerEmailByHousehold, 'email', 'Register') ||
    byHousehold(ctx.contactEmailByHousehold, 'email', 'Contacts') ||
    byHousehold(ctx.registerPhoneByHousehold, 'phone', 'Register') ||
    byHousehold(ctx.contactPhoneByHousehold, 'phone', 'Contacts')
  );
}

/** Appends a value to the array stored at `key`, creating the array if absent. */
function pushHousehold<T>(map: Map<string, T[]>, key: string, value: T): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

/** Groups a list into a Map by a computed key, appending to arrays. */
function groupBy<T>(items: T[], keyOf: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

/**
 * Expands a Register name into the individual people it names. The Register
 * combines siblings on one row ("CELARIER FRAUDET, Alban / Maxence"); we split
 * the given-name part on / and & and re-attach the shared surname so each child
 * gets its own "Surname, Given" sub-name.
 */
export function expandRegisterNames(rawName: string): string[] {
  const commaIdx = rawName.indexOf(',');
  if (commaIdx < 0) {
    // No surname prefix — just split any combined tokens.
    return rawName.split(/[/&]/).map((s) => s.trim()).filter(Boolean);
  }
  const surname = rawName.slice(0, commaIdx).trim();
  const givens = rawName.slice(commaIdx + 1);
  const parts = givens.split(/[/&]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return [rawName.trim()];
  return parts.map((g) => `${surname}, ${g}`);
}

/**
 * Builds the reconciliation context: indices + one link per Master row +
 * sibling groups + unmatched App members.
 */
export function reconcile(input: DetectorInput): ReconContext {
  const appByNameKey = groupBy(input.app, (a) => nameKey(a.rawName));
  const appByEmail = groupBy(
    input.app.filter((a) => isEmailShaped(a.email)),
    (a) => emailKey(a.email)
  );
  // Index every Register row under all its lookup keys (whole name + split
  // siblings, plain + annotation-stripped) so annotated Master names still match.
  const registerByNameKey = new Map<string, RegisterRow[]>();
  for (const r of input.register) {
    for (const k of registerIndexKeys(r.rawName)) {
      const arr = registerByNameKey.get(k);
      if (arr) {
        if (!arr.includes(r)) arr.push(r);
      } else {
        registerByNameKey.set(k, [r]);
      }
    }
  }

  // name/coreName key → household email/phone, across the whole row + its split siblings.
  const registerEmailByNameKey = new Map<string, string>();
  const registerEmailByHousehold = new Map<string, { email: string; rawName: string }[]>();
  const registerPhoneByNameKey = new Map<string, string>();
  const registerPhoneByHousehold = new Map<string, { phone: string; rawName: string }[]>();
  for (const r of input.register) {
    const hk = householdKey(r.rawName);
    if (isEmailShaped(r.email)) {
      for (const k of registerIndexKeys(r.rawName)) {
        if (!registerEmailByNameKey.has(k)) registerEmailByNameKey.set(k, r.email);
      }
      if (hk) pushHousehold(registerEmailByHousehold, hk, { email: r.email, rawName: r.rawName });
    }
    if (r.phone && isPhoneShaped(r.phone)) {
      for (const k of registerIndexKeys(r.rawName)) {
        if (!registerPhoneByNameKey.has(k)) registerPhoneByNameKey.set(k, r.phone);
      }
      if (hk) pushHousehold(registerPhoneByHousehold, hk, { phone: r.phone, rawName: r.rawName });
    }
  }

  // Contacts (read-only): the same name/surname/email indices, so they can
  // corroborate a spelling, supply a creation email, or reveal email drift.
  const contacts = input.contacts ?? [];
  const contactByNameKey = new Map<string, ContactRecord[]>();
  const contactEmailByNameKey = new Map<string, string>();
  const contactEmailByHousehold = new Map<string, { email: string; rawName: string }[]>();
  const contactPhoneByNameKey = new Map<string, string>();
  const contactPhoneByHousehold = new Map<string, { phone: string; rawName: string }[]>();
  for (const c of contacts) {
    const keys = registerIndexKeys(c.rawName);
    for (const k of keys) {
      const arr = contactByNameKey.get(k);
      if (arr) {
        if (!arr.includes(c)) arr.push(c);
      } else {
        contactByNameKey.set(k, [c]);
      }
    }
    const hk = householdKey(c.rawName);
    if (isEmailShaped(c.email)) {
      for (const k of keys) if (!contactEmailByNameKey.has(k)) contactEmailByNameKey.set(k, c.email);
      if (hk) pushHousehold(contactEmailByHousehold, hk, { email: c.email, rawName: c.rawName });
    }
    if (c.phone && isPhoneShaped(c.phone)) {
      for (const k of keys) if (!contactPhoneByNameKey.has(k)) contactPhoneByNameKey.set(k, c.phone);
      if (hk) pushHousehold(contactPhoneByHousehold, hk, { phone: c.phone, rawName: c.rawName });
    }
  }
  const contactByEmail = groupBy(
    contacts.filter((c) => isEmailShaped(c.email)),
    (c) => emailKey(c.email)
  );

  const links: MasterLink[] = input.master.map((master) =>
    linkOne(master, appByNameKey, appByEmail, registerEmailByNameKey, input.app)
  );

  const linkByMasterRaw = new Map<string, MasterLink>();
  for (const l of links) linkByMasterRaw.set(l.master.rawName, l);

  // Sibling groups: App records that >1 Master row links to.
  const byAppId = groupBy(
    links.filter((l) => l.app),
    (l) => (l.app as AppMember).id
  );
  const siblingGroups: SiblingGroup[] = [];
  for (const [, group] of byAppId) {
    if (group.length > 1) {
      siblingGroups.push({ app: group[0].app as AppMember, masters: group.map((g) => g.master) });
    }
  }

  const linkedAppIds = new Set(links.filter((l) => l.app).map((l) => (l.app as AppMember).id));
  const unmatchedApp = input.app.filter((a) => !linkedAppIds.has(a.id));

  return {
    input,
    links,
    linkByMasterRaw,
    siblingGroups,
    unmatchedApp,
    appByNameKey,
    appByEmail,
    registerByNameKey,
    registerEmailByNameKey,
    registerEmailByHousehold,
    contacts,
    contactByNameKey,
    contactByEmail,
    contactEmailByNameKey,
    contactEmailByHousehold,
    registerPhoneByNameKey,
    registerPhoneByHousehold,
    contactPhoneByNameKey,
    contactPhoneByHousehold,
  };
}

/** Resolves a single Master row to its best App link, preferring exact > fuzzy > bridge. */
function linkOne(
  master: MasterRow,
  appByNameKey: Map<string, AppMember[]>,
  appByEmail: Map<string, AppMember[]>,
  registerEmailByNameKey: Map<string, string>,
  allApp: AppMember[]
): MasterLink {
  const mKey = nameKey(master.rawName);

  // 1. Exact name match — only unambiguous (single) matches link silently.
  const exact = appByNameKey.get(mKey);
  if (exact && exact.length === 1) {
    return { master, app: exact[0], kind: 'exact' };
  }

  // 2. Fuzzy candidate — best small-distance App name. Surfaced, never applied.
  // We reach here only when there was no single exact nameKey match, so a
  // tightKey distance of 0 (e.g. "LEMAHIEU" vs "Le Mahieu" — a spacing variant
  // nameKey tokenized differently) is itself a strong candidate worth confirming.
  const mTight = tightKey(master.rawName);
  let best: { app: AppMember; distance: number } | null = null;
  for (const a of allApp) {
    const d = levenshtein(mTight, tightKey(a.rawName));
    if (d <= FUZZY_THRESHOLD && (!best || d < best.distance)) {
      best = { app: a, distance: d };
    }
  }
  if (best) {
    return { master, app: best.app, kind: 'fuzzy', distance: best.distance };
  }

  // 3. Email bridge — Register household email that resolves in the App.
  const bridgeEmail = registerEmailByNameKey.get(mKey);
  if (bridgeEmail) {
    const viaEmail = appByEmail.get(emailKey(bridgeEmail));
    if (viaEmail && viaEmail.length >= 1) {
      return { master, app: viaEmail[0], kind: 'email-bridge', bridgeEmail };
    }
  }

  return { master, app: null, kind: 'none' };
}
