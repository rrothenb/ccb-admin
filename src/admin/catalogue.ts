/**
 * Library catalogue generator (admin-only).
 *
 * Reads the Media sheet, groups resources into an ordered set of sections, and
 * renders them into a single canonical Google Doc. The Doc is shared "anyone
 * with the link (view)", so its PDF-export URL
 *   https://docs.google.com/document/d/<id>/export?format=pdf
 * is a STABLE, always-current link the website can point at — regenerating just
 * rewrites the Doc body in place, so the URL never changes. This is the one-way
 * "project from truth" pattern: the Doc is authoritative for nothing and is
 * fully rebuilt from the Media sheet on every run.
 *
 * The canonical Doc's id is stored in this project's script properties so reruns
 * reuse the same Doc (and therefore the same URL).
 */

import { getMediaService, classificationMatches } from '../services/media';
import { Media } from '../types';

const CATALOGUE_DOC_ID_PROPERTY = 'CATALOGUE_DOC_ID';
const CATALOGUE_DOC_NAME = 'CCB Library Catalogue';

/**
 * An ordered section of the catalogue. A resource is placed in the FIRST section
 * whose `classifications` match its classification (same case-insensitive
 * exact/prefix rules the Resources tab uses), so sections never double-count.
 * Anything matching no section falls into a final "Other / Uncategorised"
 * section, so nothing is silently dropped.
 */
interface CatalogueSection {
  title: string;
  classifications: string[];
}

const EASY_READERS = [
  'Easy Reader Starter Level',
  'Easy Reader Level 1',
  'Easy Reader Level 2',
  'Easy Reader Level 3',
  'Easy Reader Level 4',
  'Easy Reader Level 5',
  'Easy Reader Level 6',
];

const ELT = [
  'English Course',
  'ELT Magazine',
  'ELT Magazine CD',
  'ELT Resource CD',
  'ELT Resource Folder',
  'ELT Resource Magazine',
  'Magazine',
];

const CATALOGUE_SECTIONS: CatalogueSection[] = [
  { title: 'Fiction — General', classifications: ['GEN'] },
  { title: 'Fiction — Detective', classifications: ['DET'] },
  { title: 'Fiction — Romantic', classifications: ['RF'] },
  { title: 'Fiction — Fantasy', classifications: ['FAN'] },
  { title: 'Fiction — Historical', classifications: ['HF'] },
  { title: 'Fiction — Humour', classifications: ['HUM'] },
  { title: 'Fiction — Short Stories', classifications: ['FSS'] },
  { title: 'Classic Fiction', classifications: ['CF'] },
  { title: 'Junior Fiction', classifications: ['JF'] },
  { title: 'Kids', classifications: ['Kids'] },
  { title: 'Biography', classifications: ['BIOG'] },
  { title: 'Literature', classifications: ['Literature'] },
  { title: 'Bilingual', classifications: ['Bilingual'] },
  { title: 'Easy Readers', classifications: EASY_READERS },
  { title: 'DVDs — Film', classifications: ['DVD F'] },
  { title: 'DVDs — TV', classifications: ['DVD TV'] },
  { title: 'DVDs — Classics', classifications: ['DVD C'] },
  { title: 'DVDs — Documentaries', classifications: ['DVD D'] },
  { title: 'DVDs — Kids', classifications: ['DVD K'] },
  { title: 'DVDs — Shakespeare', classifications: ['DVD S'] },
  { title: 'English Courses & ELT Resources', classifications: ELT },
  { title: 'CDs', classifications: ['CD'] },
];

const OTHER_SECTION_TITLE = 'Other / Uncategorised';

/** Result of a catalogue generation, returned to the client. */
export interface CatalogueResult {
  success: boolean;
  error?: string;
  docUrl?: string;
  pdfUrl?: string;
  totalCount?: number;
  generatedAt?: string;
  sections?: { title: string; count: number }[];
}

/** Picks the index of the first section a resource belongs to, or -1 for none. */
function sectionIndexFor(item: Media): number {
  const cls = `${item.classification ?? ''}`;
  for (let i = 0; i < CATALOGUE_SECTIONS.length; i++) {
    if (CATALOGUE_SECTIONS[i].classifications.some((code) => classificationMatches(cls, code))) {
      return i;
    }
  }
  return -1;
}

/** Case-insensitive sort by author, then title; blanks sort last. */
function byAuthorThenTitle(a: Media, b: Media): number {
  const aa = `${a.author ?? ''}`.trim().toLowerCase();
  const ba = `${b.author ?? ''}`.trim().toLowerCase();
  if (aa !== ba) {
    if (!aa) return 1;
    if (!ba) return -1;
    return aa < ba ? -1 : 1;
  }
  const at = `${a.title ?? ''}`.trim().toLowerCase();
  const bt = `${b.title ?? ''}`.trim().toLowerCase();
  return at < bt ? -1 : at > bt ? 1 : 0;
}

/** Gets (or creates) the canonical catalogue Doc, returning an open Document. */
function openOrCreateCatalogueDoc(): GoogleAppsScript.Document.Document {
  const props = PropertiesService.getScriptProperties();
  const storedId = props.getProperty(CATALOGUE_DOC_ID_PROPERTY);
  if (storedId) {
    try {
      return DocumentApp.openById(storedId);
    } catch (e) {
      // Stored Doc was deleted/inaccessible — fall through and make a new one.
      Logger.log(`Catalogue Doc ${storedId} not accessible (${e}); creating a fresh one.`);
    }
  }
  const doc = DocumentApp.create(CATALOGUE_DOC_NAME);
  props.setProperty(CATALOGUE_DOC_ID_PROPERTY, doc.getId());
  return doc;
}

/**
 * Regenerates the library catalogue Doc from the Media sheet. Idempotent: rewrites
 * the same canonical Doc in place so the shareable PDF-export URL stays stable.
 */
function generateCatalogue(): CatalogueResult {
  const mediaResult = getMediaService().getAll();
  if (!mediaResult.success || !mediaResult.data) {
    return { success: false, error: mediaResult.error || 'Could not read the Media sheet.' };
  }

  // Only catalogue real resources (must have a title); drop blank rows.
  const items = mediaResult.data.filter((m) => `${m.title ?? ''}`.trim());

  // Bucket into sections (+ an "Other" bucket for unmatched classifications).
  const buckets: Media[][] = CATALOGUE_SECTIONS.map(() => []);
  const other: Media[] = [];
  for (const item of items) {
    const idx = sectionIndexFor(item);
    if (idx >= 0) buckets[idx].push(item);
    else other.push(item);
  }

  const doc = openOrCreateCatalogueDoc();
  const body = doc.getBody();
  body.clear();

  const generatedAt = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'd MMM yyyy, HH:mm'
  );

  body.appendParagraph('CCB Library Catalogue').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body
    .appendParagraph(`Updated ${generatedAt} · ${items.length} titles`)
    .setHeading(DocumentApp.ParagraphHeading.SUBTITLE);

  const sections: { title: string; count: number }[] = [];

  const renderSection = (title: string, rows: Media[]) => {
    if (rows.length === 0) return;
    sections.push({ title, count: rows.length });
    body.appendParagraph(`${title} (${rows.length})`).setHeading(DocumentApp.ParagraphHeading.HEADING1);
    const sorted = rows.slice().sort(byAuthorThenTitle);
    const tableRows: string[][] = [['Title', 'Author']];
    for (const r of sorted) {
      tableRows.push([`${r.title ?? ''}`.trim(), `${r.author ?? ''}`.trim()]);
    }
    const table = body.appendTable(tableRows);
    // Best-effort bold header row; never let styling break generation.
    try {
      const headerRow = table.getRow(0);
      for (let c = 0; c < headerRow.getNumCells(); c++) {
        headerRow.getCell(c).editAsText().setBold(true);
      }
    } catch (e) {
      Logger.log(`Header styling skipped: ${e}`);
    }
  };

  CATALOGUE_SECTIONS.forEach((section, i) => renderSection(section.title, buckets[i]));
  renderSection(OTHER_SECTION_TITLE, other);

  doc.saveAndClose();

  // Publish: anyone with the link can view, so the PDF-export URL works anonymously.
  const file = DriveApp.getFileById(doc.getId());
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const pdfUrl = `https://docs.google.com/document/d/${doc.getId()}/export?format=pdf`;

  return {
    success: true,
    docUrl: doc.getUrl(),
    pdfUrl,
    totalCount: items.length,
    generatedAt,
    sections,
  };
}

export { generateCatalogue };
