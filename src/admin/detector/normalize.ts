/**
 * Name normalization + string distance for the reconciler.
 *
 * Names are the ONLY join key between the spreadsheets and the app (the
 * spreadsheets have no email column), so matching lives or dies on how we
 * canonicalize them. Principles baked in here:
 *  - normalize-before-match, but NEVER silently merge (that's the caller's job);
 *  - strip accents (French names — `Zélie`, `François-Xavier`);
 *  - order-insensitive tokens so "SURNAME, First" ⇄ "First Surname" line up;
 *  - keep a separate space-free "tight" form so `LEMAHIEU` ⇄ `Le Mahieu`
 *    collapse to a tiny edit distance under Levenshtein.
 */

/** Strips combining diacritical marks after NFD decomposition. `Zélie` → `Zelie`. */
export function stripAccents(s: string): string {
  // U+0300–U+036F is the Unicode "combining diacritical marks" block.
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Order-insensitive canonical key: accents stripped, lowercased, punctuation
 * dropped, tokens sorted and single-spaced. Two names with the same key are an
 * exact match regardless of "Surname, First" vs "First Surname" ordering.
 *
 * "Sion, François-Xavier"  → "francois sion xavier"
 * "François-Xavier Sion"   → "francois sion xavier"
 */
export function nameKey(raw: string): string {
  const tokens = stripAccents(raw)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // hyphens, commas, apostrophes → spaces
    .split(/\s+/)
    .filter(Boolean)
    .sort();
  return tokens.join(' ');
}

/**
 * Space-free form for fuzzy comparison. Same token-sorting as `nameKey` (so
 * name order can't inflate the distance) but joined WITHOUT spaces, which
 * preserves each token's internal letter order — the thing Levenshtein needs to
 * see a typo as a 1-edit change:
 *   `Le Mahieu` / `LEMAHIEU`   → "lemahieu"          (distance 0)
 *   `Julien` / `Juilien`       → "julien"/"juilien"  (distance 1)
 *   `Frances` / `Francis`      → "frances"/"francis" (distance 1, a real trap)
 */
export function tightKey(raw: string): string {
  return stripAccents(raw)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join('');
}

/** Classic iterative Levenshtein edit distance (insert/delete/substitute = 1). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Basic email shape check — deliberately permissive (catches empties/typos, not RFC edge cases). */
export function isEmailShaped(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Lowercased, trimmed email for use as a comparison/bridge key. */
export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}
