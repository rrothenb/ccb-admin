/**
 * Media service - CRUD operations for library media items
 */

import { Media, MediaType, MediaStatus, MEDIA_COLUMNS, OperationResult } from '../types';
import { BaseEntityService } from './base-service';

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

    const available = result.data.filter((m) => m.status === 'available');
    return { success: true, data: available };
  }

  /**
   * Searches media by title, author, or ISBN
   */
  searchMedia(query: string): OperationResult<Media[]> {
    const result = this.getAll();
    if (!result.success || !result.data) {
      return result;
    }

    const lowerQuery = query.toLowerCase();
    const matches = result.data.filter(
      (m) =>
        m.title.toLowerCase().includes(lowerQuery) ||
        m.author.toLowerCase().includes(lowerQuery) ||
        m.isbn.toLowerCase().includes(lowerQuery)
    );

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
    return this.update(id, { status });
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

    return { success: true, data: result.data.status === 'available' };
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
