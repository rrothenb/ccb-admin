/**
 * Media service - CRUD operations for library media items
 */

import { Media, MediaType, MEDIA_COLUMNS, OperationResult } from '../types';
import { BaseEntityService } from './base-service';
import {getLoanService} from "./loans";

/**
 * A classification offered in the Resources tab dropdown.
 * `value` is matched against the sheet's `classification` field; `label` is what
 * the user sees (defaults to `value`). When `prefix` is true the value is matched
 * as a prefix (e.g. "DVD F" matches "DVD F 060", "DVD F 100", …) rather than exactly.
 */
export interface ClassificationOption {
  value: string;
  label: string;
  prefix?: boolean;
}

/**
 * Curated list of classifications exposed in the Resources tab dropdown.
 * Matching is case-insensitive. Edit this list to add or rename a classification.
 */
export const CLASSIFICATIONS: ClassificationOption[] = [
  { value: 'Bilingual', label: 'Bilingual' },
  { value: 'BIOG', label: 'BIOG' },
  { value: 'CD', label: 'CD' },
  { value: 'CF', label: 'CF' },
  { value: 'DET', label: 'DET' },
  { value: 'DVD C', label: 'DVD – Classics', prefix: true },
  { value: 'DVD D', label: 'DVD – Documentaries', prefix: true },
  { value: 'DVD F', label: 'DVD – Film', prefix: true },
  { value: 'DVD K', label: 'DVD – Kids', prefix: true },
  { value: 'DVD S', label: 'DVD – Shakespeare', prefix: true },
  { value: 'DVD TV', label: 'DVD – TV', prefix: true },
  { value: 'Easy Reader Level 1', label: 'Easy Reader Level 1' },
  { value: 'Easy Reader Level 2', label: 'Easy Reader Level 2' },
  { value: 'Easy Reader Level 3', label: 'Easy Reader Level 3' },
  { value: 'Easy Reader Level 4', label: 'Easy Reader Level 4' },
  { value: 'Easy Reader Level 5', label: 'Easy Reader Level 5' },
  { value: 'Easy Reader Level 6', label: 'Easy Reader Level 6' },
  { value: 'Easy Reader Starter Level', label: 'Easy Reader Starter Level' },
  { value: 'ELT Magazine', label: 'ELT Magazine' },
  { value: 'ELT Magazine CD', label: 'ELT Magazine CD' },
  { value: 'ELT Resource CD', label: 'ELT Resource CD' },
  { value: 'ELT Resource Folder', label: 'ELT Resource Folder' },
  { value: 'ELT Resource Magazine', label: 'ELT Resource Magazine' },
  { value: 'English Course', label: 'English Course', prefix: true },
  { value: 'FAN', label: 'FAN' },
  { value: 'FSS', label: 'FSS' },
  { value: 'GEN', label: 'GEN' },
  { value: 'HF', label: 'HF' },
  { value: 'HUM', label: 'HUM' },
  { value: 'JF', label: 'JF' },
  { value: 'Kids', label: 'Kids' },
  { value: 'Literature', label: 'Literature' },
  { value: 'Magazine', label: 'Magazine' },
  { value: 'RF', label: 'RF' },
];

/**
 * Sentinel browse values used by the Resources search dropdown.
 * - NONE_VALUE: classification is literally blank.
 * - UNCLASSIFIED_VALUE: classification is non-blank but matches none of the
 *   curated entries (shelf codes, typos, removed entries).
 * Neither is an assignable classification.
 */
export const NONE_VALUE = '__NONE__';
export const UNCLASSIFIED_VALUE = '__UNCLASSIFIED__';

/**
 * Tests whether an item's classification value matches a selected dropdown value.
 * Prefix-flagged classifications match by prefix; the rest are case-insensitive exact matches.
 */
export function classificationMatches(itemClassification: string, selected: string): boolean {
  const item = (itemClassification || '').trim().toLowerCase();
  const sel = (selected || '').trim().toLowerCase();
  if (!sel) return true;
  const option = CLASSIFICATIONS.find((c) => c.value.toLowerCase() === sel);
  if (option && option.prefix) return item.startsWith(sel);
  return item === sel;
}

/**
 * Whether an item's classification matches any curated classification (exact or prefix).
 */
export function matchesAnyClassification(itemClassification: string): boolean {
  return CLASSIFICATIONS.some((c) => classificationMatches(itemClassification, c.value));
}

/**
 * Service for managing media items in the library system
 */
class MediaService extends BaseEntityService<Media> {
  constructor() {
    super('Media', MEDIA_COLUMNS, 'M');
  }

  /**
   * Creates a new media item with default values
   */
  createMedia(
    title: string,
    author: string = '',
    type: string = '',
    classification: string = '',
    barcodes: string = '',
    resourceBox: string = ''
  ): OperationResult<Media> {
    return this.create({
      title, author, type, classification, barcodes, resourceBox,
    });
  }

  /**
   * Gets a flat list of every barcode across all media items
   */
  getAllBarcodes(): OperationResult<string[]> {
    const result = this.getAll();
    if (!result.success || !result.data) {
      return { ...result, data: [] };
    }
    const barcodes: string[] = [];
    for (const resource of result.data) {
      for (const barcode of `${resource.barcodes ?? ''}`.split('|')) {
        const trimmed = barcode.trim();
        if (trimmed) barcodes.push(trimmed);
      }
    }
    return { success: true, data: barcodes };
  }

  /**
   * Gets all available media items
   */
  getAvailableMedia(): OperationResult<Media[]> {
    const result = this.getAll();
    if (!result.success || !result.data) {
      return result;
    }

    return { success: true, data: result.data };
  }

  /**
   * Searches media by title, author, or ISBN
   */
  searchMedia(query: string): OperationResult<{barcode: string, title: string}[]> {
    const result = this.getAll();
    if (!result.success || !result.data) {
      return {...result, data: []};
    }
    const loanService = getLoanService();
    const loanResult = loanService.getAll();
    const loans = loanResult.success && loanResult.data ? loanResult.data : [];
    const loanedBarcodes = loans.map(loan => loan.barcode);

    const availableResourcesByBarcode =[]
    for (const resource of result.data) {
      console.log(resource)
      console.log(typeof resource.barcodes)
      for (const barcode of `${resource.barcodes}`.split('|') ?? []) {
        if (!loanedBarcodes.includes(barcode)) {
          availableResourcesByBarcode.push({
            barcode,
            resource
          })
        }
      }
    }
    const lowerQuery = query.toLowerCase();
    const matches = availableResourcesByBarcode.filter(
      (m) =>
        `${m.resource.title}`.toLowerCase().includes(lowerQuery) ||
        `${m.resource.author}`.toLowerCase().includes(lowerQuery) ||
        `${m.resource.type}`.toLowerCase().includes(lowerQuery) ||
        `${m.resource.classification}`.toLowerCase().includes(lowerQuery) ||
        `${m.resource.resourceBox}`.toLowerCase().includes(lowerQuery) ||
        `${m.barcode}`.toLowerCase().includes(lowerQuery)
    ).map(m => ({
      id: m.resource.id,
      barcode: m.barcode,
      title: m.resource.title
    }));

    return { success: true, data: matches };
  }

  /**
   * Gets media items by type
   */
  getByType(type: MediaType): OperationResult<Media[]> {
    const result = this.getAll();
    if (!result.success || !result.data) {
      return result;
    }

    const filtered = result.data.filter((m) => m.type === type);
    return { success: true, data: filtered };
  }

  /**
   * One-shot migration: inserts an `id` column as column A (if missing)
   * and generates IDs for each existing data row.
   */
  backfillIds(): OperationResult<{ rowsUpdated: number }> {
    const sheet = this.getMasterSheet();
    if (!sheet) {
      return { success: false, error: 'Could not access Media master spreadsheet. Run Setup first.' };
    }

    const data = sheet.getDataRange().getValues();
    if (data.length === 0) {
      return { success: false, error: 'Sheet is empty — add headers first.' };
    }

    const firstHeader = String(data[0][0] ?? '').trim();
    if (firstHeader === 'id') {
      return { success: true, data: { rowsUpdated: 0 } };
    }

    sheet.insertColumnBefore(1);
    sheet.getRange(1, 1).setValue('id');

    const dataRowCount = data.length - 1;
    if (dataRowCount > 0) {
      const ids = Array.from({ length: dataRowCount }, () => [this.generateId()]);
      sheet.getRange(2, 1, dataRowCount, 1).setValues(ids);
    }

    return { success: true, data: { rowsUpdated: dataRowCount } };
  }
}

// Singleton instance
let mediaServiceInstance: MediaService | null = null;

function getMediaService(): MediaService {
  if (!mediaServiceInstance) {
    mediaServiceInstance = new MediaService();
  }
  return mediaServiceInstance;
}

// Export functions for use in Apps Script global scope
export {
  MediaService,
  getMediaService,
};
