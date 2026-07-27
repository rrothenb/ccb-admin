/**
 * Cross-source spelling vote (pure core).
 *
 * When the SAME person is spelled differently across the Master, Register, and
 * app — a real typo, not a formatting/annotation difference — this weighs all the
 * pertinent evidence to SUGGEST which spelling is right and which source to fix:
 *   1. source agreement — if 2 of 3 sources agree, the odd one out is the likely typo;
 *   2. email evidence   — if an email's local part is literally spelled like one of
 *                         the candidate spellings, that spelling gains support (this
 *                         is the heuristic the admin used by hand reading emails).
 *
 * It NEVER decides on its own and NEVER edits anything — the email itself can be
 * the misspelling, and a source "majority" can be two copies of the same typo. So
 * the output is always advisory: a suggestion plus the reasoning, for a human to
 * confirm. The genuinely fuzzy calls (xstine → Christine, nicknames) are left to
 * the deferred `'ai'` engine; this stays conservative and deterministic.
 */

import { coreName, tightKey, stripAccents, levenshtein } from './normalize';

/** One source's take on a person's name (email optional — feeds the evidence). */
export interface SpellingEntry {
  /** Human label of the source: 'Master' | 'App' | 'Register'. */
  source: string;
  /** The name exactly as it appears in that source. */
  name: string;
  /** An email that source carries for the person, if any (App is truth; Register has households). */
  email?: string;
}

/** One distinct spelling and who uses it. */
export interface SpellingVariant {
  /** Comparison key (annotation-stripped, letter-preserving). */
  key: string;
  /** A representative raw spelling to show the admin. */
  display: string;
  /** Distinct source labels using this spelling. */
  sources: string[];
}

export interface SpellingVote {
  variants: SpellingVariant[];
  /** The spelling we think is correct, or null when nothing breaks the tie. */
  likely: string | null;
  /** The comparison key of `likely`, or null. */
  likelyKey: string | null;
  /** The (source, spelling) pairs that differ from `likely` — the ones to fix. */
  outliers: { source: string; display: string }[];
  /** Plain-English rationale for the suggestion. */
  reason: string;
  /** True when the email evidence points the OPPOSITE way to the source-count majority. */
  conflicted: boolean;
}

/** Letter-preserving key that ignores accents, case, punctuation, order, AND admin annotations. */
export function spellingKey(raw: string): string {
  return tightKey(coreName(raw));
}

/** Sorted comparison tokens (>= 2 letters) of a name — annotations removed, accents stripped. */
function clusterTokens(raw: string): string[] {
  return stripAccents(coreName(raw))
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .sort();
}

/**
 * True when `b` reads as a TYPO of `a` (same person), not a different name. The
 * two must have the same token count and align token-for-token with each pair
 * either identical or off by a single edit — so "brogniart"→"brongniart" clusters
 * but two siblings "June"/"Jade" (a 2-edit, genuinely different given name) do
 * NOT. This is what lets the vote pull a misspelled Register row into a cluster
 * that an exact key can't (the typo itself changes the key).
 */
export function looksLikeTypo(a: string, b: string): boolean {
  const ta = clusterTokens(a);
  const tb = clusterTokens(b);
  if (ta.length === 0 || ta.length !== tb.length) return false;
  let diffs = 0;
  for (let i = 0; i < ta.length; i++) {
    if (ta[i] === tb[i]) continue;
    if (levenshtein(ta[i], tb[i]) > 1) return false; // a genuinely different word
    diffs++;
  }
  return diffs > 0;
}

/** Comparable word tokens (>= 4 letters) of a name, accent-stripped, annotations removed. */
function nameTokens(raw: string): string[] {
  return stripAccents(coreName(raw))
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4);
}

/** Comparable tokens (>= 4 letters) from an email's local part: "laurent.juilien@…" → [laurent, juilien]. */
function emailTokens(email: string): string[] {
  const local = (email.split('@')[0] || '');
  return stripAccents(local)
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4);
}

/**
 * Which variant, if any, the emails unambiguously back. Compares only the tokens
 * that DISTINGUISH the variants (dropping the shared given name, so "Laurent"
 * can't credit both "JUILIEN" and "JULIEN") and requires an exact token match for
 * exactly one variant — a deliberately strict bar, since the email can be wrong.
 */
function emailSupported(variants: SpellingVariant[], emails: string[]): SpellingVariant | null {
  const et = [...new Set(emails.flatMap(emailTokens))];
  if (et.length === 0) return null;

  const tokenSets = variants.map((v) => new Set(nameTokens(v.display)));
  const common = [...tokenSets[0]].filter((t) => tokenSets.every((s) => s.has(t)));
  const commonSet = new Set(common);

  const fits = variants.map((v, i) => {
    const distinguishing = [...tokenSets[i]].filter((t) => !commonSet.has(t));
    if (distinguishing.length === 0) return Infinity;
    let best = Infinity;
    for (const dt of distinguishing) for (const e of et) best = Math.min(best, levenshtein(dt, e));
    return best;
  });

  // Exactly one variant's distinguishing token appears verbatim in an email.
  const zeros = fits.map((f, i) => (f === 0 ? i : -1)).filter((i) => i >= 0);
  if (zeros.length !== 1) return null;
  const winner = zeros[0];
  if (fits.some((f, i) => i !== winner && f === 0)) return null;
  return variants[winner];
}

/**
 * Tallies the spellings a cluster's sources use and, if they disagree, suggests
 * the likely-correct one. Returns null when there's no real disagreement (< 2
 * distinct spellings after stripping formatting/annotations).
 */
export function voteSpelling(entries: SpellingEntry[]): SpellingVote | null {
  const byKey = new Map<string, SpellingVariant>();
  for (const e of entries) {
    const key = spellingKey(e.name);
    if (!key) continue;
    const v = byKey.get(key);
    if (v) {
      if (!v.sources.includes(e.source)) v.sources.push(e.source);
    } else {
      byKey.set(key, { key, display: e.name, sources: [e.source] });
    }
  }
  const variants = [...byKey.values()];
  if (variants.length < 2) return null;

  const totalSources = new Set(entries.map((e) => e.source)).size;
  const maxCount = Math.max(...variants.map((v) => v.sources.length));
  const topVariants = variants.filter((v) => v.sources.length === maxCount);
  const majority = topVariants.length === 1 ? topVariants[0] : null;

  const emails = entries.map((e) => e.email).filter((x): x is string => !!x && x.includes('@'));
  const supported = emailSupported(variants, emails);

  let likelyKey: string | null = null;
  let reason = '';
  let conflicted = false;

  if (supported) {
    likelyKey = supported.key;
    if (majority && majority.key !== supported.key) {
      conflicted = true;
      reason =
        `the email is spelled like "${supported.display}", but ${maxCount} of ${totalSources} sources spell it ` +
        `"${majority.display}" — one of them is a typo, so check which before changing anything`;
    } else {
      reason =
        `the email is spelled like "${supported.display}"` +
        (majority ? ` and ${maxCount} of ${totalSources} sources agree` : '');
    }
  } else if (majority) {
    likelyKey = majority.key;
    reason = `${maxCount} of ${totalSources} sources spell it "${majority.display}"`;
  } else {
    reason = `the sources are split evenly and no email settles it`;
  }

  const likely = likelyKey ? (variants.find((v) => v.key === likelyKey) as SpellingVariant).display : null;
  const outliers = likelyKey
    ? entries
        .filter((e) => spellingKey(e.name) && spellingKey(e.name) !== likelyKey)
        .map((e) => ({ source: e.source, display: e.name }))
    : [];

  return { variants, likely, likelyKey, outliers, reason, conflicted };
}
