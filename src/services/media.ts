/**
 * Media service - CRUD operations for library media items
 */

import { Media, MediaType, MEDIA_COLUMNS, OperationResult } from '../types';
import { BaseEntityService } from './base-service';
import {getLoanService} from "./loans";

/**
 * Curated list of classifications exposed in the Resources tab dropdown.
 * Case-insensitive match against the sheet's `classification` field, except
 * "English Course" which matches any value that begins with "English Course".
 * Edit this list to add or rename a classification.
 */
export const CLASSIFICATIONS: string[] = [
  'Bilingual',
  'BIOG',
  'CD',
  'CF',
  'DET',
  'Easy Reader Level 1',
  'Easy Reader Level 2',
  'Easy Reader Level 3',
  'Easy Reader Level 4',
  'Easy Reader Level 5',
  'Easy Reader Level 6',
  'Easy Reader Starter Level',
  'ELT Magazine',
  'ELT Magazine CD',
  'ELT Resource CD',
  'ELT Resource Folder',
  'ELT Resource Magazine',
  'English Course',
  'FAN',
  'Fiction Short stories',
  'FSS',
  'GEN',
  'HF',
  'HUM',
  'JF',
  'Kids',
  'Literature',
  'Magazine',
  'RF',
];

/**
 * Tests whether an item's classification value matches a selected dropdown entry.
 * "English Course" is a prefix match; everything else is case-insensitive exact match.
 */
export function classificationMatches(itemClassification: string, selected: string): boolean {
  const item = (itemClassification || '').trim().toLowerCase();
  const sel = (selected || '').trim().toLowerCase();
  if (!sel) return true;
  if (sel === 'english course') return item.startsWith('english course');
  return item === sel;
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
