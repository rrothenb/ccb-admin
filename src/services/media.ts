/**
 * Media service - CRUD operations for library media items
 */

import { Media, MediaType, MediaStatus, MEDIA_COLUMNS, OperationResult } from '../types';
import { BaseEntityService } from './base-service';
import {getLoanService} from "./loans";

/**
 * Service for managing media items in the library system
 */
class MediaService extends BaseEntityService<Media> {
  constructor() {
    super('Media', MEDIA_COLUMNS);
  }

  /**
   * Creates a new media item with default values
   */
  createMedia(
    title: string,
    author: string,
    type: MediaType = 'book',
    isbn: string = '',
    notes: string = ''
  ): OperationResult<Media> {
    return this.create({
      title,
      author,
      type,
      isbn,
      status: 'available' as MediaStatus,
      notes,
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
   * Updates the status of a media item
   */
  updateStatus(id: string, status: MediaStatus): OperationResult<Media> {
    return this.update(id, { status: status ?? 'Available'});
  }

  /**
   * Marks a media item as on loan
   */
  markAsOnLoan(id: string): OperationResult<Media> {
    return this.updateStatus(id, 'on-loan');
  }

  /**
   * Marks a media item as available
   */
  markAsAvailable(id: string): OperationResult<Media> {
    return this.updateStatus(id, 'available');
  }

  /**
   * Marks a media item as lost
   */
  markAsLost(id: string): OperationResult<Media> {
    return this.updateStatus(id, 'lost');
  }

  /**
   * Checks if a media item is available for checkout
   */
  isAvailable(id: string): OperationResult<boolean> {
    const result = this.getById(id);
    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }

    return { success: true, data: !result.data.status || result.data.status === 'available' };
  }

  /**
   * Gets all media items currently on loan
   */
  getOnLoanMedia(): OperationResult<Media[]> {
    const result = this.getAll();
    if (!result.success || !result.data) {
      return result;
    }

    const onLoan = result.data.filter((m) => m.status === 'on-loan');
    return { success: true, data: onLoan };
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
