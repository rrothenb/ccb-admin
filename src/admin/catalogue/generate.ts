/**
 * Library catalogue generator (GAS side).
 *
 * Reproduces the live ccb-lille.com/en/library structure: several partitioned
 * catalogue documents, each a set of sections rendered as initial-letter grouped
 * tables (see build.ts for the pure formatting). Each document is its own
 * canonical Google Doc with a stable PDF-export URL, so the website's existing
 * six links (plus the extra whole-collection docs) can point straight at them.
 *
 * One-way projection: authoritative for nothing, fully rebuilt from the Media
 * sheet each run. Each doc's id is stored in a per-key script property so reruns
 * reuse the same Doc (stable URL).
 */

import { getMediaService, classificationMatches } from '../../services/media';
import { Media } from '../../types';
import { logAdmin } from '../log';
import {
  authorTitleSection,
  titleRefSection,
  titleAuthorSection,
  authorsIndexSection,
  RenderSection,
  CatItem,
} from './build';

type Layout = 'author-title' | 'title-ref' | 'title-author' | 'authors-index';
interface SectionSpec {
  header: string;
  /** Classification codes (exact/prefix per the Media rules) whose items belong here. */
  match: string[];
  layout: Layout;
}
interface DocSpec {
  key: string;
  title: string;
  sections: SectionSpec[];
}

/** Fiction classification → human category label (used by the authors index). */
const FICTION_CATEGORIES: Record<string, string> = {
  DET: 'Detective',
  GEN: 'General Fiction',
  RF: 'Romantic Fiction',
  FAN: 'Fantasy Fiction',
  HF: 'Historical Fiction',
  HUM: 'Humour',
  FSS: 'Short Stories',
};
const FICTION_CODES = Object.keys(FICTION_CATEGORIES);

/** The partitioned documents — the six live-site sections plus whole-collection extras. */
const CATALOGUE_DOCS: DocSpec[] = [
  { key: 'fiction-1', title: 'CCB Library — Detective & General Fiction', sections: [
    { header: 'BOOKS: DETECTIVE', match: ['DET'], layout: 'author-title' },
    { header: 'GENERAL FICTION', match: ['GEN'], layout: 'author-title' },
  ] },
  { key: 'fiction-2', title: 'CCB Library — Romantic, Fantasy, Historical, Humour & Short Stories', sections: [
    { header: 'ROMANTIC FICTION', match: ['RF'], layout: 'author-title' },
    { header: 'FANTASY FICTION', match: ['FAN'], layout: 'author-title' },
    { header: 'HISTORICAL FICTION', match: ['HF'], layout: 'author-title' },
    { header: 'HUMOUR', match: ['HUM'], layout: 'author-title' },
    { header: 'SHORT STORIES', match: ['FSS'], layout: 'author-title' },
  ] },
  { key: 'dvd-films', title: 'CCB Library — DVD Films (Subtitled in English)', sections: [
    { header: 'DVD / FILM', match: ['DVD F'], layout: 'title-ref' },
  ] },
  { key: 'dvd-tv', title: 'CCB Library — DVD TV Series (Subtitled in English)', sections: [
    { header: 'DVD / TV', match: ['DVD TV'], layout: 'title-ref' },
  ] },
  { key: 'easy-readers', title: 'CCB Library — Easy Readers', sections: [
    { header: 'Starter Level', match: ['Easy Reader Starter Level'], layout: 'title-author' },
    { header: 'Level 1', match: ['Easy Reader Level 1'], layout: 'title-author' },
    { header: 'Level 2', match: ['Easy Reader Level 2'], layout: 'title-author' },
    { header: 'Level 3', match: ['Easy Reader Level 3'], layout: 'title-author' },
    { header: 'Level 4', match: ['Easy Reader Level 4'], layout: 'title-author' },
    { header: 'Level 5', match: ['Easy Reader Level 5'], layout: 'title-author' },
    { header: 'Level 6', match: ['Easy Reader Level 6'], layout: 'title-author' },
  ] },
  { key: 'authors', title: 'CCB Library — Authors Index', sections: [
    { header: 'AUTHORS', match: FICTION_CODES, layout: 'authors-index' },
  ] },
  { key: 'kids', title: 'CCB Library — Kids Books & DVDs', sections: [
    { header: 'KIDS BOOKS', match: ['Kids', 'JF'], layout: 'author-title' },
    { header: 'KIDS DVDs', match: ['DVD K'], layout: 'title-ref' },
  ] },
  { key: 'classic-cultural', title: 'CCB Library — Classic Books & Cultural DVDs', sections: [
    { header: 'CLASSIC FICTION', match: ['CF'], layout: 'author-title' },
    { header: 'BIOGRAPHY', match: ['BIOG'], layout: 'author-title' },
    { header: 'LITERATURE', match: ['Literature'], layout: 'author-title' },
    { header: 'BILINGUAL', match: ['Bilingual'], layout: 'author-title' },
    { header: 'DVD CLASSICS', match: ['DVD C'], layout: 'title-ref' },
    { header: 'DVD DOCUMENTARIES', match: ['DVD D'], layout: 'title-ref' },
    { header: 'DVD SHAKESPEARE', match: ['DVD S'], layout: 'title-ref' },
  ] },
  { key: 'elt', title: 'CCB Library — English Courses, ELT Resources & CDs', sections: [
    { header: 'ENGLISH COURSES & ELT RESOURCES', match: ['English Course', 'ELT Magazine', 'ELT Magazine CD', 'ELT Resource CD', 'ELT Resource Folder', 'ELT Resource Magazine', 'Magazine'], layout: 'title-ref' },
    { header: 'CDs', match: ['CD'], layout: 'title-ref' },
  ] },
];

const DOC_ID_PROPERTY_PREFIX = 'CATALOGUE_DOC_ID__';

// Colours matched to the live catalogue PDFs.
const BRICK = '#a0410e';       // section header text + column-header bar
const BADGE_BLUE = '#3a6ea5';  // initial-letter badge
const WHITE = '#ffffff';

export interface CatalogueDocResult {
  key: string;
  title: string;
  total: number;
  docUrl: string;
  pdfUrl: string;
  sections: { header: string; count: number }[];
}
export interface CatalogueResult {
  success: boolean;
  error?: string;
  generatedAt?: string;
  docs?: CatalogueDocResult[];
}

/** Converts a Media row to the builder's display item (ref = classification + box/barcode). */
function toCatItem(m: Media): CatItem {
  const cls = `${m.classification ?? ''}`.trim();
  const box = `${m.resourceBox ?? ''}`.trim();
  const firstBarcode = `${m.barcodes ?? ''}`.trim().split(/[\s,]+/)[0] || '';
  const ref = [cls, box || firstBarcode].filter(Boolean).join(' ');
  const category = FICTION_CATEGORIES[cls] || FICTION_CATEGORIES[cls.toUpperCase()] || '';
  return { title: `${m.title ?? ''}`.trim(), author: `${m.author ?? ''}`.trim(), ref, category };
}

/** Builds a section model for the given layout. */
function buildSection(spec: SectionSpec, items: CatItem[]): RenderSection {
  switch (spec.layout) {
    case 'author-title': return authorTitleSection(spec.header, items);
    case 'title-ref': return titleRefSection(spec.header, items);
    case 'title-author': return titleAuthorSection(spec.header, items);
    case 'authors-index': return authorsIndexSection(spec.header, items);
  }
}

/** Gets (or creates) the canonical Doc for a partition key, so its URL is stable. */
function openOrCreateDoc(key: string, title: string): GoogleAppsScript.Document.Document {
  const props = PropertiesService.getScriptProperties();
  const prop = DOC_ID_PROPERTY_PREFIX + key;
  const storedId = props.getProperty(prop);
  if (storedId) {
    try {
      return DocumentApp.openById(storedId);
    } catch (e) {
      Logger.log(`Catalogue Doc ${storedId} (${key}) not accessible (${e}); creating a fresh one.`);
    }
  }
  const doc = DocumentApp.create(title);
  props.setProperty(prop, doc.getId());
  return doc;
}

/**
 * Renders one section into the Doc to match the live PDFs: a brick-red section
 * heading, a brick column-header bar (white bold), and blue initial-letter
 * badges in a narrow left column (shown once per letter group).
 */
function renderSection(body: GoogleAppsScript.Document.Body, section: RenderSection): void {
  const heading = body.appendParagraph(section.header);
  heading.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  heading.editAsText().setForegroundColor(BRICK).setBold(true);

  const tableRows: string[][] = [['', ...section.columns]];
  for (const group of section.groups) {
    group.rows.forEach((r, idx) => tableRows.push([idx === 0 ? group.initial : '', r[0], r[1]]));
  }
  const table = body.appendTable(tableRows);
  try {
    // Table cells otherwise inherit the heading style — force plain black body text.
    table.editAsText().setForegroundColor('#000000').setBold(false);
    table.setColumnWidth(0, 34); // narrow badge column
    // Column-header bar (brick bg, white bold) — leave the badge column blank.
    const headerRow = table.getRow(0);
    for (let c = 1; c < headerRow.getNumCells(); c++) {
      const cell = headerRow.getCell(c);
      cell.setBackgroundColor(BRICK);
      cell.editAsText().setForegroundColor(WHITE).setBold(true);
    }
    // Blue letter badges on the first row of each group.
    for (let r = 1; r < table.getNumRows(); r++) {
      const badge = table.getRow(r).getCell(0);
      if (badge.getText().trim()) {
        badge.setBackgroundColor(BADGE_BLUE);
        badge.editAsText().setForegroundColor(WHITE).setBold(true);
      }
    }
  } catch (e) {
    Logger.log(`Section styling skipped: ${e}`);
  }
}

/** Builds one partition document; returns its links + per-section counts. */
function generateDoc(spec: DocSpec, media: Media[], matched: Set<Media>): CatalogueDocResult {
  const doc = openOrCreateDoc(spec.key, spec.title);
  const body = doc.getBody();
  body.clear();

  const built: RenderSection[] = [];
  let total = 0;
  for (const spc of spec.sections) {
    const rows = media.filter((m) => spc.match.some((code) => classificationMatches(`${m.classification ?? ''}`, code)));
    rows.forEach((m) => matched.add(m));
    const section = buildSection(spc, rows.map(toCatItem));
    if (section.count > 0) {
      built.push(section);
      total += section.count;
    }
  }

  for (const section of built) renderSection(body, section);
  doc.saveAndClose();

  DriveApp.getFileById(doc.getId()).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return {
    key: spec.key,
    title: spec.title,
    total,
    docUrl: doc.getUrl(),
    pdfUrl: `https://docs.google.com/document/d/${doc.getId()}/export?format=pdf`,
    sections: built.map((s) => ({ header: s.header, count: s.count })),
  };
}

/**
 * Regenerates every partitioned catalogue document from the Media sheet.
 * Idempotent — rewrites each canonical Doc in place so their PDF URLs stay stable.
 */
function generateCatalogue(): CatalogueResult {
  const mediaResult = getMediaService().getAll();
  if (!mediaResult.success || !mediaResult.data) {
    return { success: false, error: mediaResult.error || 'Could not read the Media sheet.' };
  }
  const media = mediaResult.data.filter((m) => `${m.title ?? ''}`.trim());
  const generatedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMM yyyy, HH:mm');

  const matched = new Set<Media>();
  const specs = CATALOGUE_DOCS.slice();

  // Nothing dropped: anything matching no partition goes into a final "Other" doc.
  const unmatched = media.filter((m) => !CATALOGUE_DOCS.some((d) => d.sections.some((s) => s.match.some((code) => classificationMatches(`${m.classification ?? ''}`, code)))));
  if (unmatched.length > 0) {
    specs.push({ key: 'other', title: 'CCB Library — Other / Uncategorised', sections: [{ header: 'OTHER', match: ['__none__'], layout: 'author-title' }] });
  }

  const docs: CatalogueDocResult[] = [];
  for (const spec of specs) {
    if (spec.key === 'other') {
      // Render the leftovers directly (they match no code, so filter by identity).
      const doc = openOrCreateDoc(spec.key, spec.title);
      const body = doc.getBody();
      body.clear();
      renderSection(body, authorTitleSection('OTHER', unmatched.map(toCatItem)));
      doc.saveAndClose();
      DriveApp.getFileById(doc.getId()).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      docs.push({ key: spec.key, title: spec.title, total: unmatched.length, docUrl: doc.getUrl(), pdfUrl: `https://docs.google.com/document/d/${doc.getId()}/export?format=pdf`, sections: [{ header: 'OTHER', count: unmatched.length }] });
      continue;
    }
    docs.push(generateDoc(spec, media, matched));
  }

  const total = docs.reduce((n, d) => n + d.total, 0);
  logAdmin(`Generated library catalogue: ${docs.length} documents, ${total} entries`);
  return { success: true, generatedAt, docs };
}

export { generateCatalogue };
