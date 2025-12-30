# CCB Library Admin - Web App

A library management system built on Google Apps Script and Google Sheets, deployed as a standalone web application.

## Overview

This system provides a web-based interface for managing a church or community library. It uses:
- **Google Sheets** as the database (3 master spreadsheets: Borrowers, Media, Loans)
- **Google Apps Script** for the backend logic
- **Web App deployment** for the user interface
- **Google Drive sharing** for access control

## Key Features

- **Standalone web app** - No spreadsheet visible to users, just the web interface
- **Simple access control** - Share a single "CCB Webapp Access Control" spreadsheet to grant access
- **Tab-based navigation** - Borrowers, Media, and Loans tabs
- **Client-side search** - Fast filtering of loaded data
- **No authorization prompts** - Users just sign in with their Google account

## Quick Start

See [SETUP.md](SETUP.md) for detailed setup instructions.

**Summary:**
1. Install dependencies: `npm install`
2. Login to Google Apps Script: `npx clasp login`
3. Create 3 master spreadsheets (Borrowers, Media, Loans)
4. Create an "Access Control" spreadsheet for permissions
5. Create Apps Script project: `npx clasp create --type standalone`
6. Deploy: `npm run push`
7. Configure in Apps Script editor:
   - Run `setAccessControlId('your-spreadsheet-id')`
   - Run `runDiscovery()` to find master spreadsheets
8. Deploy as web app
9. Share the web app URL with users

## Architecture

### Data Flow

```
User visits web app URL
    ↓
Signs in with Google account
    ↓
Script checks: Can user access the Access Control spreadsheet?
    ↓
Yes → Load the web app UI
No  → Show "Access Denied"
    ↓
Web app reads/writes directly to master spreadsheets
```

### Spreadsheets

**3 Master Spreadsheets** (your data):
- **Borrowers** - Library members
- **Media** - Books, DVDs, etc.
- **Loans** - Checkout records

**1 Access Control Spreadsheet** (for permissions):
- Can be any Google Sheet (even empty)
- Share it with users who should access the web app
- The web app checks if users can view/edit this spreadsheet
- To grant access: Share this spreadsheet
- To revoke access: Remove sharing from this spreadsheet

### No "Hub" Needed

Unlike the previous sidebar-based architecture, this web app does **NOT** require:
- A "Hub" spreadsheet with IMPORTRANGE formulas
- Users to have direct access to the master spreadsheets
- Users to open any spreadsheet at all

The web app talks directly to the master spreadsheets via Apps Script services.

## Deployment

### Build and Push

```bash
npm run build    # Compile TypeScript to Google Apps Script JavaScript
npm run push     # Upload to Google's servers
```

### Initial Configuration (in Apps Script Editor)

Open the Apps Script editor:
```bash
npx clasp open
```

Then run these setup functions:

#### 1. Set Access Control Spreadsheet ID

In the Apps Script editor's execution panel (at the bottom), type:
```javascript
setAccessControlId('your-spreadsheet-id-here')
```

Replace `'your-spreadsheet-id-here'` with the actual ID from your Access Control spreadsheet's URL (the long string between `/d/` and `/edit`).

#### 2. Discover Master Spreadsheets

Run this to find your Borrowers, Media, and Loans spreadsheets:
```javascript
runDiscovery()
```

Check the execution log to verify all 3 were found.

#### 3. Verify Configuration

Run this to see the current configuration:
```javascript
showConfig()
```

All 4 IDs should be set (Borrowers, Media, Loans, Access Control).

### Deploy as Web App

1. In Apps Script editor: **Deploy → New deployment**
2. Type: **Web app**
3. Description: "Library Manager v1" (or whatever you prefer)
4. Execute as: **Me** (your account)
5. Who has access: **Anyone with Google account**
6. Click **Deploy** and copy the URL

### Share with Users

1. Share the **Access Control spreadsheet** with users who should access the web app
2. Give them the **web app URL**
3. They visit the URL and sign in - that's it!

## Managing Access

**To add a user:**
- Share the Access Control spreadsheet with them (viewer or editor, doesn't matter)

**To remove a user:**
- Remove their access from the Access Control spreadsheet

**Note:** Users do NOT need access to the master spreadsheets. The web app runs as your account and has full access to read/write the master spreadsheets.

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
npm test                  # Run all tests
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage report
```

### Linting

```bash
npm run lint
```

## Available Commands

- `npm run build` - Compile TypeScript
- `npm run push` - Build and push to Google Apps Script
- `npm run deploy` - Build, push, and create new deployment
- `npm run watch` - Watch for changes and rebuild
- `npx clasp open` - Open in Apps Script editor
- `npx clasp logs` - View execution logs

## Project Structure

```
ccb-admin/
├── src/
│   ├── types/           # TypeScript type definitions
│   ├── services/        # Business logic (borrowers, media, loans)
│   ├── ui/              # Web app UI
│   │   ├── webapp.ts    # Entry point and access control
│   │   └── html/        # HTML templates (App.html, AppJS.html, Styles.html)
│   ├── utils/           # Utility functions
│   └── gas-entry.ts     # Apps Script global function exports
├── dist/                # Compiled output (auto-generated, pushed to GAS)
├── build.js             # Build script (esbuild)
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript configuration
└── appsscript.json      # Apps Script manifest
```

## Troubleshooting

### "Could not access master spreadsheet" error

Run `runDiscovery()` in the Apps Script editor to reconfigure master spreadsheet IDs.

### Menu or web app doesn't appear

1. Refresh the page
2. Check logs: `npx clasp logs`
3. Verify deployment: `npx clasp deployments`

### Access denied for valid users

1. Verify the Access Control spreadsheet ID is set: run `showConfig()`
2. Verify the user has access to the Access Control spreadsheet
3. Check Apps Script logs for specific errors

### Changes not appearing

1. Make sure you ran `npm run push`
2. Clear your browser cache
3. Check for TypeScript errors: `npm run build`

## License

MIT
