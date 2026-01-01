/**
 * Borrowers service - CRUD operations for library borrowers/members
 */

import { Borrower, BorrowerStatus, BORROWER_COLUMNS, OperationResult } from '../types';
import { BaseEntityService } from './base-service';

/**
 * Service for managing borrowers in the library system
 */
class BorrowerService extends BaseEntityService<Borrower> {
  constructor() {
    super('Borrowers', BORROWER_COLUMNS);
  }

  /**
   * Creates a new borrower with default values
   */
  createBorrower(
    name: string,
    email: string,
    phone: string = '',
    notes: string = ''
  ): OperationResult<Borrower> {
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    return this.create({
      name,
      email,
      phone,
      status: 'active' as BorrowerStatus,
      joinDate: today,
      notes,
    });
  }

  /**
   * Gets all active borrowers
   */
  getActiveBorrowers(): OperationResult<Borrower[]> {
    const result = this.getAll();
    if (!result.success || !result.data) {
      console.log(`Boo!  I got ${result.error}!`)
      return result;
    }
    console.log(`Woohoo!  I found ${result.data.length} borrowers!`)
    return { success: true, data: result.data };
  }

  /**
   * Searches borrowers by name or email
   */
  searchBorrowers(query: string): OperationResult<Borrower[]> {
    const result = this.getAll();
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
   * Suspends a borrower
   */
  suspendBorrower(id: string, reason: string = ''): OperationResult<Borrower> {
    const notes = reason ? `Suspended: ${reason}` : 'Suspended';
    return this.update(id, {
      status: 'suspended' as BorrowerStatus,
      notes,
    });
  }

  /**
   * Reactivates a suspended borrower
   */
  reactivateBorrower(id: string): OperationResult<Borrower> {
    return this.update(id, {
      status: 'active' as BorrowerStatus,
    });
  }

  /**
   * Checks if a borrower is in good standing (active status)
   */
  isInGoodStanding(id: string): OperationResult<boolean> {
    const result = this.getById(id);
    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }

    return { success: true, data: result.data.status === 'active' };
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
