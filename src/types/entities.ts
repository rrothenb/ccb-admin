/**
 * Entity types for the library management system
 */

/** Status of a borrower in the system */
export type BorrowerStatus = 'active' | 'suspended' | 'inactive';

/** A library borrower/member */
export interface Borrower {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: BorrowerStatus;
  joinDate: string; // ISO date string (yyyy-MM-dd)
  notes: string;
  gender: string;
  address: string;
  postcode: string;
  borrowerType: string;
  expiryDate: string;
  memberSince: string;
}

/** Type of media item */
export type MediaType = 'book' | 'dvd' | 'magazine' | 'audiobook' | 'other';

/** Status of a media item */
export type MediaStatus = 'available' | 'on-loan' | 'lost' | 'damaged' | 'retired';

/** A media item in the library */
export interface Media {
  id: string;
  title: string;
  author: string;
  type: string;
  isbn: string;
  notes: string;
  genres: string;
  date: string;
  abstract: string;
  subjects: string;
  description: string;
  publisher: string;
  place: string;
  classification: string;
  barcodes: string;
}

/** Status of a loan */
export type LoanStatus = 'active' | 'returned' | 'overdue' | 'lost';

/** A loan record */
export interface Loan {
  id: string;
  barcode: string;
  title: string
  checkoutDate: string;
  dueDate: string;
  borrowerName: string;
  borrowerId: string
  status: LoanStatus;
}

/** Sheet names used in the system (historically from Hub, now webapp tabs) */
export type SheetName = 'Borrowers' | 'Media' | 'Loans';

/** Column headers for each entity type */
export const BORROWER_COLUMNS: (keyof Borrower)[] = [
  'id', 'name', 'email', 'phone', 'gender', 'address', 'postcode', 'borrowerType', 'expiryDate', 'memberSince', 'status'
];
export const MEDIA_COLUMNS: (keyof Media)[] = [
  'id', 'title', 'author', 'type', 'isbn', 'notes', 'genres', 'date', 'abstract',	'subjects', 'description', 'publisher', 'place', 'classification', 'barcodes'
];

export const LOAN_COLUMNS: (keyof Loan)[] = [
  'id', 'barcode', 'title', 'checkoutDate', 'dueDate', 'borrowerName', 'borrowerId', 'status'
];

/** Map of sheet names to their expected master spreadsheet name prefix */
export const SHEET_TO_MASTER_PREFIX: Record<SheetName, string> = {
  'Borrowers': 'Borrowers',
  'Media': 'Media',
  'Loans': 'Loans',
};
