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

### 3. Create the Master Spreadsheets

In your Google Drive, create the following **3 master spreadsheets**:

1. **Borrowers** - Will store all borrower/member data
2. **Media** - Will store all media items (books, DVDs, etc.)
3. **Loans** - Will store all loan records

**Important naming requirements:**
- Spreadsheet names must **start with** the exact names above (e.g., "Borrowers", "Borrowers-v2", "Media Dev", etc.)
- The system will auto-discover and use the most recently modified spreadsheet for each type

**Note:** You can add initial data to these spreadsheets now, or leave them empty - the system will initialize headers automatically later.

### 4. Create the Hub Spreadsheet (Automated)

Run the automated setup script to create your Hub spreadsheet:

```bash
npm run setup:hub
```

This script will:
1. ✓ Search for your 3 master spreadsheets
2. ✓ Validate all 3 exist (errors if any are missing)
3. ✓ Create a new "Library Hub" spreadsheet
4. ✓ Create the 3 required sheets (Borrowers, Media, Loans)
5. ✓ Add IMPORTRANGE formulas to link to master spreadsheets
6. ✓ Output the Hub spreadsheet URL

**If the script fails with "Missing master spreadsheet(s)":**
- Make sure you created all 3 master spreadsheets in Step 3
- Verify they're named correctly (starting with "Borrowers", "Media", "Loans")
- Check they're not in the trash

### 5. Create a New Apps Script Project

Option A: Create standalone project and link:
```bash
npx clasp create --type standalone --title "Library Manager"
```

Option B: Create bound to the Hub spreadsheet (recommended):
```bash
npx clasp create --type sheets --title "Library Manager" --parentId YOUR_HUB_SPREADSHEET_ID
```

**Tip:** Copy the Hub spreadsheet ID from the URL created in Step 4. The spreadsheet ID is the long string between `/d/` and `/edit` in the URL.

This creates a `.clasp.json` file with your script ID.

### 6. Deploy

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

1. **Open the Hub spreadsheet** (from the URL output in Step 4)
2. **Authorize IMPORTRANGE formulas**
   - You'll see `#REF!` errors initially - this is normal
   - Click on any cell showing the error
   - Click "Allow access" when prompted
   - The data from master spreadsheets will now appear
3. **Refresh the page** - you should see "Library Manager" menu appear
4. **Initialize headers** (optional, if master spreadsheets are empty)
   - Go to **Library Manager > Maintenance > Initialize Headers**
   - This adds column headers to all 3 master spreadsheets

## Hub Spreadsheet Architecture

The `npm run setup:hub` script automatically creates a Hub spreadsheet with:

- **3 sheets (tabs):** Borrowers, Media, Loans
- **IMPORTRANGE formulas** in each sheet that pull data from the master spreadsheets:
  ```
  =IMPORTRANGE("MASTER_SPREADSHEET_ID", "Sheet1!A:G")
  ```

**How it works:**
- The Hub displays read-only data imported from the masters via `IMPORTRANGE`
- Volunteers interact with the Hub using the sidebar and menus
- Apps Script writes changes back to the master spreadsheets
- IMPORTRANGE automatically updates the Hub to reflect the changes

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

### "Missing master spreadsheet(s)" error during Hub setup

The `npm run setup:hub` script requires all 3 master spreadsheets to exist before creating the Hub.

**Solution:**
1. Create spreadsheets in Google Drive named "Borrowers", "Media", and "Loans"
2. Ensure they're not in the trash
3. Verify you're logged into the correct Google account: `npx clasp login`
4. Run the setup script again: `npm run setup:hub`

### "Not authenticated with clasp" error

**Solution:**
1. Run `npx clasp login`
2. Complete the authentication flow in your browser
3. Run the setup script again: `npm run setup:hub`

### "Could not access master spreadsheet" error

This error occurs when the Apps Script can't find the configured master spreadsheets.

**Solution:**
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
