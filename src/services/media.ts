/**
 * Media service - CRUD operations for library media items
 */

import { Media, MediaType, MEDIA_COLUMNS, OperationResult } from '../types';
import { BaseEntityService } from './base-service';
import {getLoanService} from "./loans";

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
    isbn: string = '',
    notes: string = '',
    genres: string = '',
    date: string = '',
    abstract: string = '',
    subjects: string = '',
    description: string = '',
    publisher: string = '',
    place: string = '',
    classification: string = '',
    barcodes: string = ''
  ): OperationResult<Media> {
    return this.create({
      title, author, type, isbn, notes, genres, date, abstract,
      subjects, description, publisher, place, classification, barcodes,
    });
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
        `${m.resource.place}`.toLowerCase().includes(lowerQuery) ||
        `${m.resource.abstract}`.toLowerCase().includes(lowerQuery) ||
        `${m.resource.notes}`.toLowerCase().includes(lowerQuery) ||
        `${m.resource.subjects}`.toLowerCase().includes(lowerQuery) ||
        `${m.resource.description}`.toLowerCase().includes(lowerQuery) ||
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
