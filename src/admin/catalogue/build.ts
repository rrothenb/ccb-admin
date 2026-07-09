/**
 * Library catalogue builder (pure).
 *
 * Reproduces the partitioning + formatting of the live catalogue PDFs at
 * ccb-lille.com/en/library: items grouped under a section header, split into
 * initial-letter groups (a left "A / B / C…" divider column), with the column
 * layout the live PDFs use:
 *   - books        → Author | Title   (sorted by author surname)
 *   - DVDs         → Title  | Ref      (sorted by title; ref = "DVD F 805")
 *   - easy readers → Title  | Author   (one section per level)
 *   - authors idx  → Author | Category (one row per author, categories joined)
 *
 * Pure module (no GAS / no Media service) so the sort/group logic is
 * unit-testable; the GAS layer reads the Media sheet, buckets items by
 * classification, and renders these section models into Google Docs.
 */

/** A catalogue item, already reduced to display fields by the GAS layer. */
export interface CatItem {
  title: string;
  author: string;
  /** Reference shown for DVDs/resources, e.g. "DVD F 805" (classification + box/barcode). */
  ref: string;
  /** Human category label for the authors index, e.g. "Detective". */
  category: string;
}

/** A rendered initial-letter group (its rows share a first letter). */
export interface RenderGroup {
  initial: string;
  rows: string[][];
}

/** A rendered section: a header, column names, and the grouped rows. */
export interface RenderSection {
  header: string;
  columns: string[];
  groups: RenderGroup[];
  count: number;
}

/** First letter (uppercased) of a sort key; digits/symbols collapse to "#". */
export function initialOf(s: string): string {
  const t = (s || '').trim();
  if (!t) return '#';
  const c = t[0].toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}

const norm = (s: string): string => (s || '').trim().toLowerCase();

/** Groups already-sorted items into consecutive initial-letter runs. */
function groupByInitial(
  items: CatItem[],
  keyOf: (i: CatItem) => string,
  cellsOf: (i: CatItem) => string[]
): RenderGroup[] {
  const groups: RenderGroup[] = [];
  let current: RenderGroup | null = null;
  for (const it of items) {
    const ini = initialOf(keyOf(it));
    if (!current || current.initial !== ini) {
      current = { initial: ini, rows: [] };
      groups.push(current);
    }
    current.rows.push(cellsOf(it));
  }
  return groups;
}

/** Books: sorted by author (then title), Author | Title columns, grouped by author initial. */
export function authorTitleSection(header: string, items: CatItem[]): RenderSection {
  const sorted = items
    .slice()
    .sort((a, b) => norm(a.author).localeCompare(norm(b.author)) || norm(a.title).localeCompare(norm(b.title)));
  return {
    header,
    columns: ['Author', 'Title'],
    groups: groupByInitial(sorted, (i) => i.author, (i) => [i.author.trim(), i.title.trim()]),
    count: items.length,
  };
}

/** DVDs/resources: sorted by title, Title | Ref columns, grouped by title initial. */
export function titleRefSection(header: string, items: CatItem[]): RenderSection {
  const sorted = items.slice().sort((a, b) => norm(a.title).localeCompare(norm(b.title)));
  return {
    header,
    columns: ['Title', 'Reference'],
    groups: groupByInitial(sorted, (i) => i.title, (i) => [i.title.trim(), i.ref.trim()]),
    count: items.length,
  };
}

/** Easy readers: sorted by title, Title | Author columns, grouped by title initial. */
export function titleAuthorSection(header: string, items: CatItem[]): RenderSection {
  const sorted = items.slice().sort((a, b) => norm(a.title).localeCompare(norm(b.title)));
  return {
    header,
    columns: ['Title', 'Author'],
    groups: groupByInitial(sorted, (i) => i.title, (i) => [i.title.trim(), i.author.trim()]),
    count: items.length,
  };
}

/**
 * Authors index: one row per distinct author with their categories joined,
 * Author | Category columns, grouped by author initial. Sorted by author.
 */
export function authorsIndexSection(header: string, items: CatItem[]): RenderSection {
  const byAuthor = new Map<string, Set<string>>();
  for (const it of items) {
    const author = it.author.trim();
    if (!author) continue;
    const set = byAuthor.get(author) || new Set<string>();
    if (it.category.trim()) set.add(it.category.trim());
    byAuthor.set(author, set);
  }
  const rows: CatItem[] = [...byAuthor.entries()]
    .map(([author, cats]) => ({ author, title: '', ref: '', category: [...cats].sort().join(', ') }))
    .sort((a, b) => norm(a.author).localeCompare(norm(b.author)));
  return {
    header,
    columns: ['Author', 'Category'],
    groups: groupByInitial(rows, (i) => i.author, (i) => [i.author.trim(), i.category.trim()]),
    count: rows.length,
  };
}
