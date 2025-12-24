# Library Management System - Setup Guide

This guide walks you through setting up the library management system for development and deployment.

## Prerequisites

- Node.js 18+ and npm
- A Google account
- Google Apps Script CLI (`clasp`)

## Initial Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Login to Google Apps Script

```bash
npx clasp login
```

This opens a browser window to authenticate with your Google account.

### 3. Create the Spreadsheets

In your Google Drive, create the following spreadsheets:

1. **Borrowers** - Will store all borrower/member data
2. **Media** - Will store all media items (books, DVDs, etc.)
3. **Loans** - Will store all loan records
4. **Library Hub** - The main interface spreadsheet (with 3 sheets named "Borrowers", "Media", "Loans")

The system will auto-discover the first three by name.

### 4. Create a New Apps Script Project

Option A: Create standalone project and link:
```bash
npx clasp create --type standalone --title "Library Manager"
```

Option B: Create bound to the Hub spreadsheet:
```bash
npx clasp create --type sheets --title "Library Manager" --parentId YOUR_HUB_SPREADSHEET_ID
```

This creates a `.clasp.json` file with your script ID.

### 5. Deploy

```bash
npm run push
```

This compiles TypeScript and pushes to Google Apps Script.

## Development Workflow

### Local Development

```bash
# Watch mode - recompiles on changes
npm run watch

# In another terminal, push when ready
npm run push
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

### Linting

```bash
npm run lint
```

## Environment Switching (Dev vs Production)

The system uses convention over configuration - it discovers spreadsheets by name in whatever Google account you're logged into with `clasp`.

### For Development

1. Login with your dev account: `npx clasp login`
2. Create test spreadsheets named "Borrowers", "Media", "Loans" in that account
3. Push to a dev script project

### For Production

1. Login with the production account: `npx clasp login`
2. Ensure production spreadsheets exist with the same names
3. Push to the production script project

You can maintain multiple `.clasp.json` files:

```bash
# Development
cp .clasp.json .clasp.dev.json

# Production (after logging in with prod account and creating project)
cp .clasp.json .clasp.prod.json

# Switch environments
cp .clasp.dev.json .clasp.json   # for dev
cp .clasp.prod.json .clasp.json  # for prod
```

## First Run in Google Sheets

1. Open the Hub spreadsheet
2. Refresh the page - you should see "Library Manager" menu appear
3. Go to **Library Manager > Setup > Discover Master Spreadsheets**
4. The system will find your Borrowers, Media, and Loans spreadsheets
5. Go to **Library Manager > Maintenance > Initialize Headers** to set up column headers

## Hub Spreadsheet Setup

The Hub spreadsheet should have 3 sheets (tabs):

1. **Borrowers** - Use `IMPORTRANGE` to pull from the Borrowers master
2. **Media** - Use `IMPORTRANGE` to pull from the Media master
3. **Loans** - Use `IMPORTRANGE` to pull from the Loans master

Example IMPORTRANGE formula (after discovering master IDs via the Setup menu):

```
=IMPORTRANGE("BORROWERS_SPREADSHEET_ID", "Sheet1!A:G")
```

The sidebar will automatically show context-appropriate actions based on which sheet tab is active.

## Project Structure

```
ccb-admin/
├── src/
│   ├── types/           # TypeScript type definitions
│   │   ├── entities.ts  # Borrower, Media, Loan types
│   │   └── config.ts    # Configuration types
│   ├── services/        # Business logic services
│   │   ├── discovery.ts # Auto-discovery of spreadsheets
│   │   ├── borrowers.ts # Borrower CRUD operations
│   │   ├── media.ts     # Media CRUD operations
│   │   └── loans.ts     # Loan CRUD operations
│   ├── ui/              # User interface components
│   │   ├── sidebar.ts   # Sidebar logic
│   │   └── html/        # HTML templates
│   ├── utils/           # Utility functions
│   │   └── validation.ts
│   ├── test/            # Test setup and mocks
│   └── gas-entry.ts     # Apps Script entry points
├── dist/                # Compiled output (pushed to GAS)
├── package.json
├── tsconfig.json
├── jest.config.js
└── appsscript.json      # GAS manifest
```

## Troubleshooting

### "Could not access master spreadsheet" error

Run **Library Manager > Setup > Discover Master Spreadsheets** to configure the master spreadsheet IDs.

### Menu doesn't appear

1. Refresh the spreadsheet
2. Check the Apps Script logs: `npx clasp logs`
3. Ensure the script is properly bound/deployed

### Authorization errors

The first time the script runs, it will ask for permissions. Click through the authorization flow. On free Google accounts, you may see an "Unverified app" warning - click "Advanced" and "Go to Library Manager (unsafe)" to proceed.

### Changes not appearing

1. Make sure you ran `npm run push`
2. Refresh the spreadsheet
3. Check for TypeScript compilation errors: `npm run build`
