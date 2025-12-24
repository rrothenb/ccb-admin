/**
 * Tests for entity types and constants
 */

import {
  BORROWER_COLUMNS,
  MEDIA_COLUMNS,
  LOAN_COLUMNS,
  SHEET_TO_MASTER_PREFIX,
} from './entities';

describe('Entity Column Definitions', () => {
  describe('BORROWER_COLUMNS', () => {
    it('should have the correct columns in order', () => {
      expect(BORROWER_COLUMNS).toEqual([
        'id',
        'name',
        'email',
        'phone',
        'status',
        'joinDate',
        'notes',
      ]);
    });

    it('should have id as the first column', () => {
      expect(BORROWER_COLUMNS[0]).toBe('id');
    });
  });

  describe('MEDIA_COLUMNS', () => {
    it('should have the correct columns in order', () => {
      expect(MEDIA_COLUMNS).toEqual([
        'id',
        'title',
        'author',
        'type',
        'isbn',
        'status',
        'notes',
      ]);
    });

    it('should have id as the first column', () => {
      expect(MEDIA_COLUMNS[0]).toBe('id');
    });
  });

  describe('LOAN_COLUMNS', () => {
    it('should have the correct columns in order', () => {
      expect(LOAN_COLUMNS).toEqual([
        'id',
        'borrowerId',
        'mediaId',
        'checkoutDate',
        'dueDate',
        'returnDate',
        'status',
      ]);
    });

    it('should have id as the first column', () => {
      expect(LOAN_COLUMNS[0]).toBe('id');
    });
  });

  describe('SHEET_TO_MASTER_PREFIX', () => {
    it('should map sheet names to master spreadsheet prefixes', () => {
      expect(SHEET_TO_MASTER_PREFIX).toEqual({
        Borrowers: 'Borrowers',
        Media: 'Media',
        Loans: 'Loans',
      });
    });
  });
});
