/**
 * Tests for validation utilities
 */

import {
  validateBorrower,
  validateMedia,
  validateLoan,
  isLoanOverdue,
  getDaysOverdue,
  formatDateString,
  calculateDueDate,
} from './validation';
import { Loan } from '../types';

describe('Validation Utilities', () => {
  describe('validateBorrower', () => {
    it('should validate a complete borrower', () => {
      const result = validateBorrower({
        name: 'John Doe',
        email: 'john@example.com',
        phone: '555-1234',
        status: 'active',
        joinDate: '2024-01-15',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should require name', () => {
      const result = validateBorrower({
        email: 'john@example.com',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Name is required');
    });

    it('should require email', () => {
      const result = validateBorrower({
        name: 'John Doe',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Email is required');
    });

    it('should validate email format', () => {
      const result = validateBorrower({
        name: 'John Doe',
        email: 'invalid-email',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Email format is invalid');
    });

    it('should validate status values', () => {
      const result = validateBorrower({
        name: 'John Doe',
        email: 'john@example.com',
        status: 'invalid' as 'active',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid status: invalid');
    });

    it('should validate date format', () => {
      const result = validateBorrower({
        name: 'John Doe',
        email: 'john@example.com',
        joinDate: '01-15-2024', // Wrong format
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Join date must be in yyyy-MM-dd format');
    });
  });

  describe('validateMedia', () => {
    it('should validate a complete media item', () => {
      const result = validateMedia({
        title: 'The Great Book',
        author: 'Jane Author',
        type: 'book',
        isbn: '978-0-123456-78-9',
        status: 'available',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should require title', () => {
      const result = validateMedia({
        author: 'Jane Author',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Title is required');
    });

    it('should require author', () => {
      const result = validateMedia({
        title: 'The Great Book',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Author is required');
    });

    it('should validate status values', () => {
      const result = validateMedia({
        title: 'The Great Book',
        author: 'Jane Author',
        status: 'invalid' as 'available',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid status: invalid');
    });
  });

  describe('validateLoan', () => {
    it('should validate a complete loan', () => {
      const result = validateLoan({
        borrowerId: 'borrower-123',
        mediaId: 'media-456',
        checkoutDate: '2024-01-15',
        dueDate: '2024-01-29',
        status: 'active',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should require borrowerId', () => {
      const result = validateLoan({
        mediaId: 'media-456',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Borrower ID is required');
    });

    it('should require mediaId', () => {
      const result = validateLoan({
        borrowerId: 'borrower-123',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Media ID is required');
    });

    it('should validate that due date is after checkout date', () => {
      const result = validateLoan({
        borrowerId: 'borrower-123',
        mediaId: 'media-456',
        checkoutDate: '2024-01-29',
        dueDate: '2024-01-15', // Before checkout
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Due date must be after checkout date');
    });

    it('should allow empty return date', () => {
      const result = validateLoan({
        borrowerId: 'borrower-123',
        mediaId: 'media-456',
        checkoutDate: '2024-01-15',
        dueDate: '2024-01-29',
        returnDate: '',
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('isLoanOverdue', () => {
    it('should return false for active loan not yet due', () => {
      const loan: Loan = {
        id: 'loan-1',
        borrowerId: 'borrower-1',
        mediaId: 'media-1',
        checkoutDate: '2024-01-15',
        dueDate: '2024-01-29',
        returnDate: '',
        status: 'active',
      };

      const currentDate = new Date('2024-01-20');
      expect(isLoanOverdue(loan, currentDate)).toBe(false);
    });

    it('should return true for active loan past due date', () => {
      const loan: Loan = {
        id: 'loan-1',
        borrowerId: 'borrower-1',
        mediaId: 'media-1',
        checkoutDate: '2024-01-15',
        dueDate: '2024-01-29',
        returnDate: '',
        status: 'active',
      };

      const currentDate = new Date('2024-01-30');
      expect(isLoanOverdue(loan, currentDate)).toBe(true);
    });

    it('should return false for returned loans', () => {
      const loan: Loan = {
        id: 'loan-1',
        borrowerId: 'borrower-1',
        mediaId: 'media-1',
        checkoutDate: '2024-01-15',
        dueDate: '2024-01-29',
        returnDate: '2024-02-05',
        status: 'returned',
      };

      const currentDate = new Date('2024-02-10');
      expect(isLoanOverdue(loan, currentDate)).toBe(false);
    });
  });

  describe('getDaysOverdue', () => {
    it('should return 0 for non-overdue loan', () => {
      const loan: Loan = {
        id: 'loan-1',
        borrowerId: 'borrower-1',
        mediaId: 'media-1',
        checkoutDate: '2024-01-15',
        dueDate: '2024-01-29',
        returnDate: '',
        status: 'active',
      };

      const currentDate = new Date('2024-01-20');
      expect(getDaysOverdue(loan, currentDate)).toBe(0);
    });

    it('should return correct days overdue', () => {
      const loan: Loan = {
        id: 'loan-1',
        borrowerId: 'borrower-1',
        mediaId: 'media-1',
        checkoutDate: '2024-01-15',
        dueDate: '2024-01-29',
        returnDate: '',
        status: 'active',
      };

      const currentDate = new Date('2024-02-03');
      expect(getDaysOverdue(loan, currentDate)).toBe(5);
    });
  });

  describe('formatDateString', () => {
    it('should format date correctly', () => {
      const date = new Date('2024-01-15');
      expect(formatDateString(date)).toBe('2024-01-15');
    });

    it('should pad single digit months and days', () => {
      const date = new Date('2024-03-05');
      expect(formatDateString(date)).toBe('2024-03-05');
    });
  });

  describe('calculateDueDate', () => {
    it('should calculate due date correctly', () => {
      const checkout = new Date('2024-01-15');
      const dueDate = calculateDueDate(checkout, 14);

      expect(formatDateString(dueDate)).toBe('2024-01-29');
    });

    it('should handle month rollover', () => {
      const checkout = new Date('2024-01-25');
      const dueDate = calculateDueDate(checkout, 14);

      expect(formatDateString(dueDate)).toBe('2024-02-08');
    });
  });
});
