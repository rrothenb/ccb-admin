/**
 * Validation utilities for library entities
 *
 * These are pure functions that can be unit tested without GAS dependencies.
 */

import { Borrower, Media, Loan, BorrowerStatus, MediaStatus, LoanStatus } from '../types';

/** Valid borrower statuses */
const VALID_BORROWER_STATUSES: BorrowerStatus[] = ['active', 'suspended', 'inactive'];

/** Valid media statuses */
const VALID_MEDIA_STATUSES: MediaStatus[] = ['available', 'on-loan', 'lost', 'damaged', 'retired'];

/** Valid loan statuses */
const VALID_LOAN_STATUSES: LoanStatus[] = ['active', 'returned', 'overdue', 'lost'];

/** Email validation regex */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Date string validation regex (yyyy-MM-dd) */
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validation result
 */
interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a borrower object
 */
function validateBorrower(borrower: Partial<Borrower>): ValidationResult {
  const errors: string[] = [];

  if (!borrower.name || borrower.name.trim().length === 0) {
    errors.push('Name is required');
  }

  if (!borrower.email || borrower.email.trim().length === 0) {
    errors.push('Email is required');
  } else if (!EMAIL_REGEX.test(borrower.email)) {
    errors.push('Email format is invalid');
  }

  if (borrower.status && !VALID_BORROWER_STATUSES.includes(borrower.status)) {
    errors.push(`Invalid status: ${borrower.status}`);
  }

  if (borrower.joinDate && !DATE_REGEX.test(borrower.joinDate)) {
    errors.push('Join date must be in yyyy-MM-dd format');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates a media object
 */
function validateMedia(media: Partial<Media>): ValidationResult {
  const errors: string[] = [];

  if (!media.title || media.title.trim().length === 0) {
    errors.push('Title is required');
  }

  if (!media.author || media.author.trim().length === 0) {
    errors.push('Author is required');
  }

  if (media.status && !VALID_MEDIA_STATUSES.includes(media.status)) {
    errors.push(`Invalid status: ${media.status}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates a loan object
 */
function validateLoan(loan: Partial<Loan>): ValidationResult {
  const errors: string[] = [];

  if (!loan.borrowerId || loan.borrowerId.trim().length === 0) {
    errors.push('Borrower ID is required');
  }

  if (!loan.mediaId || loan.mediaId.trim().length === 0) {
    errors.push('Media ID is required');
  }

  if (loan.checkoutDate && !DATE_REGEX.test(loan.checkoutDate)) {
    errors.push('Checkout date must be in yyyy-MM-dd format');
  }

  if (loan.dueDate && !DATE_REGEX.test(loan.dueDate)) {
    errors.push('Due date must be in yyyy-MM-dd format');
  }

  if (loan.returnDate && loan.returnDate.length > 0 && !DATE_REGEX.test(loan.returnDate)) {
    errors.push('Return date must be in yyyy-MM-dd format');
  }

  if (loan.status && !VALID_LOAN_STATUSES.includes(loan.status)) {
    errors.push(`Invalid status: ${loan.status}`);
  }

  // Business rule: due date must be after checkout date
  if (loan.checkoutDate && loan.dueDate) {
    const checkout = new Date(loan.checkoutDate);
    const due = new Date(loan.dueDate);
    if (due <= checkout) {
      errors.push('Due date must be after checkout date');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Checks if a loan is overdue based on current date
 */
function isLoanOverdue(loan: Loan, currentDate: Date = new Date()): boolean {
  if (loan.status !== 'active') {
    return false;
  }

  const dueDate = new Date(loan.dueDate);
  dueDate.setHours(23, 59, 59, 999); // End of due day

  return currentDate > dueDate;
}

/**
 * Calculates the number of days a loan is overdue
 */
function getDaysOverdue(loan: Loan, currentDate: Date = new Date()): number {
  if (!isLoanOverdue(loan, currentDate)) {
    return 0;
  }

  const dueDate = new Date(loan.dueDate);
  const diffTime = currentDate.getTime() - dueDate.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDays);
}

/**
 * Formats a date as yyyy-MM-dd string
 */
function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculates a due date given a checkout date and loan period
 */
function calculateDueDate(checkoutDate: Date, loanDays: number): Date {
  const dueDate = new Date(checkoutDate);
  dueDate.setDate(dueDate.getDate() + loanDays);
  return dueDate;
}

export {
  validateBorrower,
  validateMedia,
  validateLoan,
  isLoanOverdue,
  getDaysOverdue,
  formatDateString,
  calculateDueDate,
  ValidationResult,
  VALID_BORROWER_STATUSES,
  VALID_MEDIA_STATUSES,
  VALID_LOAN_STATUSES,
};
