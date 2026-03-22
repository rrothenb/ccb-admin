/**
 * Borrowers service - CRUD operations for library borrowers/members
 */

import { Borrower, BORROWER_COLUMNS, OperationResult } from '../types';
import { BaseEntityService } from './base-service';

/**
 * Service for managing borrowers in the library system
 */
class BorrowerService extends BaseEntityService<Borrower> {
  constructor() {
    super('Borrowers', BORROWER_COLUMNS, 'B');
  }

  /**
   * Creates a new borrower
   */
  createBorrower(
    name: string,
    email: string,
    phone: string = '',
    gender: string = '',
    address: string = '',
    postcode: string = '',
    borrowerType: string = '',
    expiryDate: string = '',
    memberSince: string = ''
  ): OperationResult<Borrower> {
    return this.create({ name, email, phone, gender, address, postcode, borrowerType, expiryDate, memberSince });
  }

  /**
   * Gets all borrowers currently in good standing (expiryDate after today)
   */
  getActiveBorrowers(): OperationResult<Borrower[]> {
    const result = this.getAll();
    if (!result.success || !result.data) {
      return result;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const activeBorrowers = result.data.filter((b) => b.expiryDate && new Date(b.expiryDate) > today);
    return { success: true, data: activeBorrowers };
  }

  /**
   * Searches borrowers in good standing by name or email
   */
  searchBorrowers(query: string): OperationResult<Borrower[]> {
    const result = this.getActiveBorrowers();
    if (!result.success || !result.data) {
      return result;
    }

    const lowerQuery = query.toLowerCase();
    const matches = result.data.filter(
      (b) =>
        b.name.toLowerCase().includes(lowerQuery) ||
        b.email.toLowerCase().includes(lowerQuery)
    );

    return { success: true, data: matches };
  }

  /**
   * Checks if a borrower is in good standing (expiryDate after today)
   */
  isInGoodStanding(id: string): OperationResult<boolean> {
    const result = this.getById(id);
    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return { success: true, data: !!result.data.expiryDate && new Date(result.data.expiryDate) > today };
  }
}

// Singleton instance
let borrowerServiceInstance: BorrowerService | null = null;

function getBorrowerService(): BorrowerService {
  if (!borrowerServiceInstance) {
    borrowerServiceInstance = new BorrowerService();
  }
  return borrowerServiceInstance;
}

// Export functions for use in Apps Script global scope
export {
  BorrowerService,
  getBorrowerService,
};
