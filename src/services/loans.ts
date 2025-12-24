/**
 * Loans service - CRUD operations for library loans
 */

import { Loan, LoanStatus, LOAN_COLUMNS, OperationResult } from '../types';
import { BaseEntityService } from './base-service';
import { getBorrowerService } from './borrowers';
import { getMediaService } from './media';

/** Default loan period in days */
const DEFAULT_LOAN_DAYS = 14;

/**
 * Service for managing loans in the library system
 */
class LoanService extends BaseEntityService<Loan> {
  constructor() {
    super('Loans', LOAN_COLUMNS);
  }

  /**
   * Creates a new loan (checkout)
   * Validates that borrower is in good standing and media is available
   */
  checkout(
    borrowerId: string,
    mediaId: string,
    loanDays: number = DEFAULT_LOAN_DAYS
  ): OperationResult<Loan> {
    // Validate borrower
    const borrowerService = getBorrowerService();
    const borrowerCheck = borrowerService.isInGoodStanding(borrowerId);
    if (!borrowerCheck.success) {
      return { success: false, error: borrowerCheck.error };
    }
    if (!borrowerCheck.data) {
      return { success: false, error: 'Borrower is not in good standing' };
    }

    // Validate media
    const mediaService = getMediaService();
    const mediaCheck = mediaService.isAvailable(mediaId);
    if (!mediaCheck.success) {
      return { success: false, error: mediaCheck.error };
    }
    if (!mediaCheck.data) {
      return { success: false, error: 'Media item is not available for checkout' };
    }

    // Calculate dates
    const today = new Date();
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + loanDays);

    const checkoutDate = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const dueDateStr = Utilities.formatDate(dueDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');

    // Create the loan
    const loanResult = this.create({
      borrowerId,
      mediaId,
      checkoutDate,
      dueDate: dueDateStr,
      returnDate: '',
      status: 'active' as LoanStatus,
    });

    if (!loanResult.success) {
      return loanResult;
    }

    // Update media status
    const mediaUpdate = mediaService.markAsOnLoan(mediaId);
    if (!mediaUpdate.success) {
      // Rollback loan creation
      if (loanResult.data) {
        this.delete(loanResult.data.id);
      }
      return { success: false, error: `Failed to update media status: ${mediaUpdate.error}` };
    }

    return loanResult;
  }

  /**
   * Processes a return
   */
  processReturn(loanId: string): OperationResult<Loan> {
    // Get the loan
    const loanResult = this.getById(loanId);
    if (!loanResult.success || !loanResult.data) {
      return { success: false, error: loanResult.error || 'Loan not found' };
    }

    const loan = loanResult.data;

    if (loan.status === 'returned') {
      return { success: false, error: 'This loan has already been returned' };
    }

    // Update the loan
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const updateResult = this.update(loanId, {
      returnDate: today,
      status: 'returned' as LoanStatus,
    });

    if (!updateResult.success) {
      return updateResult;
    }

    // Update media status
    const mediaService = getMediaService();
    const mediaUpdate = mediaService.markAsAvailable(loan.mediaId);
    if (!mediaUpdate.success) {
      Logger.log(`Warning: Failed to update media status: ${mediaUpdate.error}`);
    }

    return updateResult;
  }

  /**
   * Extends the due date of a loan
   */
  extendLoan(loanId: string, additionalDays: number = DEFAULT_LOAN_DAYS): OperationResult<Loan> {
    const loanResult = this.getById(loanId);
    if (!loanResult.success || !loanResult.data) {
      return { success: false, error: loanResult.error || 'Loan not found' };
    }

    const loan = loanResult.data;

    if (loan.status !== 'active') {
      return { success: false, error: 'Can only extend active loans' };
    }

    // Calculate new due date
    const currentDue = new Date(loan.dueDate);
    currentDue.setDate(currentDue.getDate() + additionalDays);
    const newDueDate = Utilities.formatDate(currentDue, Session.getScriptTimeZone(), 'yyyy-MM-dd');

    return this.update(loanId, { dueDate: newDueDate });
  }

  /**
   * Gets all active loans
   */
  getActiveLoans(): OperationResult<Loan[]> {
    const result = this.getAll();
    if (!result.success || !result.data) {
      return result;
    }

    const active = result.data.filter((l) => l.status === 'active');
    return { success: true, data: active };
  }

  /**
   * Gets all overdue loans
   */
  getOverdueLoans(): OperationResult<Loan[]> {
    const result = this.getAll();
    if (!result.success || !result.data) {
      return result;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdue = result.data.filter((l) => {
      if (l.status !== 'active') return false;
      const dueDate = new Date(l.dueDate);
      return dueDate < today;
    });

    return { success: true, data: overdue };
  }

  /**
   * Gets loans for a specific borrower
   */
  getLoansByBorrower(borrowerId: string): OperationResult<Loan[]> {
    const result = this.getAll();
    if (!result.success || !result.data) {
      return result;
    }

    const borrowerLoans = result.data.filter((l) => l.borrowerId === borrowerId);
    return { success: true, data: borrowerLoans };
  }

  /**
   * Gets active loans for a specific borrower
   */
  getActiveLoansByBorrower(borrowerId: string): OperationResult<Loan[]> {
    const result = this.getLoansByBorrower(borrowerId);
    if (!result.success || !result.data) {
      return result;
    }

    const active = result.data.filter((l) => l.status === 'active');
    return { success: true, data: active };
  }

  /**
   * Gets the current loan for a media item (if any)
   */
  getCurrentLoanForMedia(mediaId: string): OperationResult<Loan | null> {
    const result = this.getAll();
    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }

    const activeLoan = result.data.find(
      (l) => l.mediaId === mediaId && l.status === 'active'
    );

    return { success: true, data: activeLoan || null };
  }

  /**
   * Updates loan statuses (marks overdue loans)
   * Should be run periodically
   */
  updateOverdueStatuses(): OperationResult<number> {
    const result = this.getAll();
    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let updatedCount = 0;

    for (const loan of result.data) {
      if (loan.status === 'active') {
        const dueDate = new Date(loan.dueDate);
        if (dueDate < today) {
          const updateResult = this.update(loan.id, { status: 'overdue' as LoanStatus });
          if (updateResult.success) {
            updatedCount++;
          }
        }
      }
    }

    return { success: true, data: updatedCount };
  }
}

// Singleton instance
let loanServiceInstance: LoanService | null = null;

function getLoanService(): LoanService {
  if (!loanServiceInstance) {
    loanServiceInstance = new LoanService();
  }
  return loanServiceInstance;
}

// Export functions for use in Apps Script global scope
export {
  LoanService,
  getLoanService,
  DEFAULT_LOAN_DAYS,
};
