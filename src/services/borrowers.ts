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
   * Searches borrowers by name or email. Returns all matches (active and
   * expired); each result is annotated with a `status` field of 'active' or
   * 'expired' based on `expiryDate`.
   */
  searchBorrowers(query: string): OperationResult<(Borrower & { status: 'active' | 'expired' })[]> {
    const result = this.getAll();
    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lowerQuery = query.toLowerCase();
    const matches = result.data
      .filter(
        (b) =>
          b.name.toLowerCase().includes(lowerQuery) ||
          b.email.toLowerCase().includes(lowerQuery)
      )
      .map((b) => ({
        ...b,
        status: (b.expiryDate && new Date(b.expiryDate) > today)
          ? ('active' as const)
          : ('expired' as const),
      }));

    return { success: true, data: matches };
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
