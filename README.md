# CCB Library Admin

A minimal library management system built on Google Sheets + Apps Script, designed for non-technical volunteers.

## Overview

This system uses a **four-spreadsheet architecture**:

| Spreadsheet | Purpose | Apps Script |
|-------------|---------|-------------|
| **Borrowers** | Master data for library members | No (passive) |
| **Media** | Master data for books, DVDs, etc. | No (passive) |
| **Loans** | Master data for loan records | No (passive) |
| **Hub** | Volunteer interface with linked views | Yes |

The Hub spreadsheet uses `IMPORTRANGE` to display data from the three master spreadsheets, and a context-aware sidebar with Apps Script to write changes back to the masters.

## Features

- **Context-aware sidebar**: Automatically shows relevant actions based on the active sheet tab
- **Auto-discovery**: Finds master spreadsheets by name (no manual ID configuration)
- **Borrower management**: Add, edit, search, suspend borrowers
- **Media management**: Add, edit, search, track availability
- **Loan management**: Checkout, return, extend loans with validation
- **Autocomplete**: Quick borrower/media lookup during checkout

## Quick Start

```bash
# Install dependencies
npm install

# Login to Google Apps Script
npx clasp login

# Build and deploy
npm run push
```

See [SETUP.md](./SETUP.md) for detailed setup instructions.

## Development

```bash
# Run tests
npm test

# Watch mode for TypeScript
npm run watch

# Lint
npm run lint
```

## Data Model

### Borrower
| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier (UUID) |
| name | string | Full name |
| email | string | Email address |
| phone | string | Phone number |
| status | enum | active, suspended, inactive |
| joinDate | string | Date joined (yyyy-MM-dd) |
| notes | string | Additional notes |

### Media
| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier (UUID) |
| title | string | Title |
| author | string | Author, creator, or director |
| type | enum | book, dvd, magazine, audiobook, other |
| isbn | string | ISBN or barcode |
| status | enum | available, on-loan, lost, damaged, retired |
| notes | string | Additional notes |

### Loan
| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier (UUID) |
| borrowerId | string | Reference to borrower |
| mediaId | string | Reference to media item |
| checkoutDate | string | Checkout date (yyyy-MM-dd) |
| dueDate | string | Due date (yyyy-MM-dd) |
| returnDate | string | Return date (yyyy-MM-dd), empty if active |
| status | enum | active, returned, overdue, lost |

## Tech Stack

- **Runtime**: Google Apps Script (V8)
- **Language**: TypeScript
- **Build**: TypeScript compiler + clasp
- **Testing**: Jest with GAS mocks
- **UI**: HTML/CSS/JS in GAS dialogs and sidebar

## License

MIT
