/**
 * Level-text display normalization — expands the org's shorthand so both the
 * class schedule (Level column) and the Gmail Contacts label read the same.
 * The raw spreadsheet value is left intact everywhere else (e.g. the Story Time
 * kids-level detection still sees the original text).
 *
 * "U Intermediate (B2+)" → "Upper Intermediate (B2+)".
 */
export function normalizeLevel(level: string): string {
  return (level || '').trim().replace(/\bU\s+Intermediate\b/gi, 'Upper Intermediate');
}
