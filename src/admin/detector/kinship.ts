/**
 * "Is this the same person, written two ways?" — for pairs the edit-distance
 * fuzzy matcher can't reach.
 *
 * Levenshtein is tuned for TYPOS (Julien/Juilien), so it deliberately uses a
 * threshold of 2. The commonest real-world mismatch between the Master and the
 * app isn't a typo though — it's a different CONVENTION for the same name:
 *
 *   "CALLENS, M-Christine"        vs "Callens, Marie-Christine"   (abbreviated)
 *   "LEPRETRE-SAÏLE, Marie-Pierre" vs "Leprêtre, Marie-Pierre"    (compound surname)
 *   "CORDONNIER - Bernard-Philippe" vs "CORDONNIER, Philippe"     (extra given name)
 *
 * Those are 4–8 edits apart, so they read as strangers — yet the two records
 * share an email, which is strong corroboration. This module compares the two
 * names STRUCTURALLY (token sets, surname vs given segment, abbreviations) and
 * says how likely they're one person, with a reason in plain words.
 *
 * It NEVER decides anything: it only sharpens what the admin is told, because
 * "these are probably the same person, spelled differently" and "these are two
 * people sharing an address" need opposite fixes. The distinction it can't make
 * from data — an extra given name is equally "Bernard-Philippe, informally
 * Philippe" and "Bernard and Philippe, father and son" — comes back as `weak`,
 * and the message says both readings out loud.
 *
 * Pure module — no GAS.
 */

import { stripAccents, coreName, levenshtein } from './normalize';

export interface NameKinship {
  /**
   * 'strong' — the difference is a naming convention (an abbreviation, a
   *            compound surname, a letter or two); almost certainly one person.
   * 'weak'   — one name carries a whole extra given name: could be the same
   *            person informally, could be a relative on the same address.
   */
  strength: 'strong' | 'weak';
  /** Admin-facing clause naming the actual difference, e.g. `"M-Christine" is short for "Marie-Christine"`. */
  reason: string;
}

/**
 * A name token in both forms: the normalized `key` everything is compared on, and
 * the `display` exactly as the source writes it — messages quote the latter, so
 * the admin reads "SAÏLE", the string they'll go and edit, not "saile".
 */
interface Token {
  key: string;
  display: string;
}

/** Tokenizes to comparison keys paired with their as-written form. */
function tokens(s: string): Token[] {
  return s
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // hyphens, commas, apostrophes → spaces
    .split(/\s+/)
    .filter(Boolean)
    .map((display) => ({ display, key: stripAccents(display).toLowerCase().replace(/[^a-z0-9]/g, '') }))
    .filter((t) => t.key.length > 0);
}

/**
 * Splits a name into its surname and given-name parts. Both sources write
 * "SURNAME, Given", so the comma is the reliable separator; without one we can't
 * tell which tokens are which, and say so with `structured: false`.
 */
function segments(raw: string): { surname: Token[]; given: Token[]; all: Token[]; structured: boolean } {
  const core = coreName(raw);
  const comma = core.indexOf(',');
  if (comma < 0) {
    const all = tokens(core);
    return { surname: [], given: all, all, structured: false };
  }
  const surname = tokens(core.slice(0, comma));
  const given = tokens(core.slice(comma + 1));
  return { surname, given, all: [...surname, ...given], structured: true };
}

/** True when `short` is an initial/abbreviation of `long` ("m"→"marie", "ph"→"philippe"). */
function isAbbreviationOf(short: string, long: string): boolean {
  return short.length <= 3 && long.length > short.length && long.startsWith(short);
}

/** Quotes a token list the way it reads in a message: `"Marie" and "Claire"`. */
function quoteList(list: Token[]): string {
  const q = list.map((t) => `"${t.display}"`);
  if (q.length <= 1) return q[0] || '';
  return `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`;
}

/**
 * Judges whether two names plausibly denote one person. Returns null when they
 * simply don't look related — no shared word of substance, or a difference this
 * module can't characterize (in which case the caller should stay non-committal
 * rather than guess).
 *
 * Callers should only ask when something else already ties the two records
 * together (a shared email, a shared phone). On names alone this would be far
 * too loose: half the members of one family share a surname.
 */
export function nameKinship(aRaw: string, bRaw: string): NameKinship | null {
  const A = segments(aRaw);
  const B = segments(bRaw);
  if (!A.all.length || !B.all.length) return null;

  const setA = new Set(A.all.map((t) => t.key));
  const setB = new Set(B.all.map((t) => t.key));
  const shared = [...setA].filter((k) => setB.has(k));
  // A shared initial ("m") proves nothing — require a real word in common.
  if (!shared.some((k) => k.length >= 3)) return null;

  const onlyA = A.all.filter((t) => !setB.has(t.key));
  const onlyB = B.all.filter((t) => !setA.has(t.key));

  if (!onlyA.length && !onlyB.length) {
    return { strength: 'strong', reason: 'the two names use exactly the same words' };
  }

  // Same number of leftovers on each side: pair them up. All pairs being
  // abbreviations (or near-identical spellings) means one convention, one person.
  if (onlyA.length === onlyB.length) {
    const remaining = [...onlyB];
    const abbreviations: string[] = [];
    const variants: string[] = [];
    let paired = true;

    for (const a of onlyA) {
      const abbrevIdx = remaining.findIndex((b) => isAbbreviationOf(a.key, b.key) || isAbbreviationOf(b.key, a.key));
      if (abbrevIdx >= 0) {
        const b = remaining.splice(abbrevIdx, 1)[0];
        const [short, long] = a.key.length < b.key.length ? [a, b] : [b, a];
        abbreviations.push(`"${short.display}" is short for "${long.display}"`);
        continue;
      }
      const nearIdx = remaining.findIndex(
        (b) => levenshtein(a.key, b.key) <= 2 && Math.max(a.key.length, b.key.length) >= 4
      );
      if (nearIdx >= 0) {
        const b = remaining.splice(nearIdx, 1)[0];
        variants.push(`"${a.display}" vs "${b.display}"`);
        continue;
      }
      paired = false;
      break;
    }

    if (paired) {
      const bits = [...abbreviations, ...variants];
      const how = abbreviations.length
        ? `one abbreviates the other (${bits.join('; ')})`
        : `they differ only in spelling (${bits.join('; ')})`;
      return { strength: 'strong', reason: how };
    }
  }

  // One name is the other plus extra words. What those extras ARE decides how
  // much it means: an extra surname part is a naming convention (a married or
  // double-barrelled surname); an extra GIVEN name might be a whole other person.
  const extraSide = !onlyB.length ? 'a' : !onlyA.length ? 'b' : null;
  if (extraSide) {
    const src = extraSide === 'a' ? A : B;
    const extras = extraSide === 'a' ? onlyA : onlyB;
    const surnameKeys = new Set(src.surname.map((t) => t.key));
    const fromSurname = src.structured && extras.every((t) => surnameKeys.has(t.key));
    if (fromSurname) {
      return {
        strength: 'strong',
        reason: `one writes the surname as a compound (the extra part being ${quoteList(extras)})`,
      };
    }
    return {
      strength: 'weak',
      reason: `one carries an extra given name (${quoteList(extras)}) — which is equally how one person's full name is written and how a second family member appears`,
    };
  }

  return null;
}
