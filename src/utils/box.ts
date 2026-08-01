/**
 * Box-set membership (pure).
 *
 * A "box" is a relationship, not a field: a child resource's `resourceBox`
 * holds a JSON map of `{ childBarcode: boxBarcode }`, and a resource is a box
 * when some other row points at one of its own barcodes. A copy assigned to a
 * box is never individually borrowable — only the box itself circulates — so
 * both the checkout paths and the catalogue need to agree on which copies are
 * boxed. That shared answer lives here.
 *
 * Note that membership is per-copy: a title can have one copy loose on the
 * shelf and another inside a box set, in which case the loose copy is still
 * borrowable and the title still belongs in the catalogue.
 */

/** The two Media fields box membership is derived from (values may be numbers). */
export interface BoxFields {
  barcodes?: unknown;
  resourceBox?: unknown;
}

/** A Media row as seen when naming the box a copy belongs to. */
export interface BoxItem extends BoxFields {
  title?: unknown;
}

/** Splits a `barcodes` cell ("a|b|c") into trimmed, non-empty barcodes. */
export function splitBarcodes(raw: unknown): string[] {
  return `${raw ?? ''}`.split('|').map((b) => b.trim()).filter(Boolean);
}

/**
 * Parses a `resourceBox` cell into `{ childBarcode: boxBarcode }`.
 * Anything unparseable, non-object, or holding a blank/non-string box barcode
 * is treated as "not boxed" rather than an error — the sheet is hand-edited.
 */
export function parseBoxMap(raw: unknown): Record<string, string> {
  const text = `${raw ?? ''}`.trim();
  if (!text) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const map: Record<string, string> = {};
  for (const [child, box] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof box === 'string' && box.trim()) map[child] = box.trim();
  }
  return map;
}

/** The box barcode this copy sits in, or null when it is standalone. */
export function boxBarcodeFor(media: BoxFields, barcode: string): string | null {
  return parseBoxMap(media.resourceBox)[barcode] || null;
}

/** This resource's copies that are not inside a box (i.e. individually borrowable). */
export function unboxedBarcodes(media: BoxFields): string[] {
  const map = parseBoxMap(media.resourceBox);
  return splitBarcodes(media.barcodes).filter((b) => !map[b]);
}

/**
 * True when the resource has copies and every one of them is inside a box, so
 * no copy can ever be checked out on its own.
 */
export function isFullyBoxed(media: BoxFields): boolean {
  const barcodes = splitBarcodes(media.barcodes);
  return barcodes.length > 0 && unboxedBarcodes(media).length === 0;
}

/** Names a box for a human: the owning resource's title, else the bare barcode. */
export function boxLabel(boxBarcode: string, allMedia: BoxItem[]): string {
  const owner = allMedia.find((m) => splitBarcodes(m.barcodes).includes(boxBarcode));
  return `${owner?.title ?? ''}`.trim() || boxBarcode;
}

/** The box a given copy sits in, named for display, or null when standalone. */
export function containingBoxOf(
  media: BoxFields,
  barcode: string,
  allMedia: BoxItem[]
): { boxBarcode: string; boxTitle: string } | null {
  const boxBarcode = boxBarcodeFor(media, barcode);
  if (!boxBarcode) return null;
  return { boxBarcode, boxTitle: boxLabel(boxBarcode, allMedia) };
}

/**
 * The box a fully-boxed resource lives in, for explaining why it can't be
 * borrowed on its own. Returns null when any copy is standalone.
 */
export function soleContainingBoxOf(media: BoxFields, allMedia: BoxItem[]): { boxBarcode: string; boxTitle: string } | null {
  if (!isFullyBoxed(media)) return null;
  const first = splitBarcodes(media.barcodes)[0];
  return containingBoxOf(media, first, allMedia);
}
