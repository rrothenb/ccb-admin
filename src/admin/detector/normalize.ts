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
 * Strips the admin annotations the Master/Register wrap around a name, so the
 * person's real name survives for matching. Removes:
 *  - parentheticals: "(Mother Elena)", "(4Yrs)", "(2nd group)";
 *  - a trailing dependent clause: "- mother Ola Alhaj Hasan", "– père Marc";
 *  - age markers: "5 ans", "7 Yrs".
 * Deliberately conservative — it only drops clauses that clearly aren't part of a
 * name, never a real given/surname. So "CORDONNIER - Bernard-Philippe" keeps its
 * "Bernard-Philippe" (the dash isn't followed by a parent/age word).
 */
export function coreName(raw: string): string {
  return raw
    .replace(/\([^)]*\)/g, ' ') // (Mother Elena), (4Yrs), (2nd group)
    .replace(/[-–—]\s*(mother|father|parent|m[eè]re|p[eè]re|maman|papa)\b.*$/i, ' ') // - mother Ola …
    .replace(/\b\d+\s*(?:ans|yrs?|years?)\b/gi, ' ') // 5 ans, 7 Yrs
    .replace(/\s+/g, ' ')
    .trim();
}

/** `nameKey` of the annotation-stripped `coreName` — the key to match noisy Master/Register names on. */
export function coreNameKey(raw: string): string {
  return nameKey(coreName(raw));
}

/**
 * Coarse household bucket: the primary surname token. Both the Master
 * ("Surname, Given") and this Register write the surname FIRST, so we take the
 * first real token (len >= 2, skipping an initial like "M-") of the portion
 * before any comma. Used ONLY as a last-resort email source for creating a
 * not-yet-in-app member (parents/siblings share one household email), and every
 * such hit is surfaced for human review — never trusted as a name match. Rough
 * by design; two unrelated families with the same surname would collide.
 */
export function householdKey(raw: string): string {
  const stripped = stripAccents(raw);
  const beforeComma = stripped.includes(',') ? stripped.slice(0, stripped.indexOf(',')) : stripped;
  const tokens = beforeComma
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  return tokens[0] || '';
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

/**
 * True for a bare phone number: digits + phone punctuation only (no letters/@),
 * 9–13 digits — so it catches "06 48 41 34 70" / "+33 6 …" but not a name, a
 * year ("2026"), a time ("14.00-15.00"), or an email.
 */
export function isPhoneShaped(value: string): boolean {
  const t = (value || '').trim();
  if (!t || /[a-zA-Z@]/.test(t)) return false;
  const digits = t.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 13;
}

/** Digits-only phone key (French `+33 6…` → `06…`) for comparison/dedup. */
export function phoneKey(value: string): string {
  let d = (value || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('33')) d = '0' + d.slice(2);
  return d;
}
