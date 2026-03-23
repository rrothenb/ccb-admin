/**
 * Loans service - CRUD operations for library loans
 */

import { Loan, LOAN_COLUMNS, OperationResult } from '../types';
import { BaseEntityService } from './base-service';
import { getBorrowerService } from './borrowers';

/** Default loan period in days */
const DEFAULT_LOAN_DAYS = 21;

/**
 * Service for managing loans in the library system
 */
class LoanService extends BaseEntityService<Loan> {
  constructor() {
    super('Loans', LOAN_COLUMNS, 'L');
  }

  /**
   * Creates a new loan (checkout)
   * Validates that borrower is in good standing and media is available
   */
  checkout(
    borrowerId: string,
    barcode: string,
    resourceId: string,
    borrowerName: string,
    title: string,
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

    // Check barcode is not already on loan
    const existingLoan = this.getCurrentLoanForMedia(barcode);
    if (!existingLoan.success) {
      return { success: false, error: existingLoan.error };
    }
    if (existingLoan.data) {
      return { success: false, error: 'Media item is not available for checkout' };
    }

    // Calculate dates
    const today = new Date();
    const due = new Date(today);
    due.setDate(due.getDate() + loanDays);

    const checkout = Utilities.formatDate(today, Session.getScriptTimeZone(), 'MMMM d, yyyy');
    const dueDateStr = Utilities.formatDate(due, Session.getScriptTimeZone(), 'MMMM d, yyyy');

    return this.create({
      borrowerId,
      title,
      borrowerName,
      barcode,
      checkoutDate: checkout,
      dueDate: dueDateStr,
    });
  }

  /**
   * Processes a return
   */
  processReturn(loanId: string): OperationResult<Loan> {
    const loanResult = this.getById(loanId);
    if (!loanResult.success || !loanResult.data) {
      return { success: false, error: loanResult.error || 'Loan not found' };
    }

    const deleteResult = this.delete(loanId);
    if (!deleteResult.success) {
      return { success: false, error: deleteResult.error };
    }

    return { success: true, data: loanResult.data };
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

    // Calculate new due date
    const currentDue = new Date(loan.dueDate);
    currentDue.setDate(currentDue.getDate() + additionalDays);
    const newDueDate = Utilities.formatDate(currentDue, Session.getScriptTimeZone(), 'MMMM d, yyyy');

    return this.update(loanId, { dueDate: newDueDate });
  }

  /**
   * Gets all active loans
   */
  getActiveLoans(): OperationResult<Loan[]> {
    return this.getAll();
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

    const overdue = result.data.filter((l) => new Date(l.dueDate) < today);
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
  getCurrentLoanForMedia(barcode: string): OperationResult<Loan | null> {
    const result = this.getAll();
    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }

    const activeLoan = result.data.find(
      (l) => l.barcode === barcode && l.status === 'active'
    );

    return { success: true, data: activeLoan || null };
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
