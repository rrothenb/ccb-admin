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
} from './types';
import { nameKey, tightKey, emailKey, levenshtein, isEmailShaped } from './normalize';

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
  /** nameKey → household email, expanded to cover combined "First1 / First2" register rows. */
  registerEmailByNameKey: Map<string, string>;
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
  const registerByNameKey = groupBy(input.register, (r) => nameKey(r.rawName));

  // nameKey → household email, expanded across combined sibling rows.
  const registerEmailByNameKey = new Map<string, string>();
  for (const r of input.register) {
    if (!isEmailShaped(r.email)) continue;
    for (const sub of expandRegisterNames(r.rawName)) {
      const k = nameKey(sub);
      if (!registerEmailByNameKey.has(k)) registerEmailByNameKey.set(k, r.email);
    }
  }

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
