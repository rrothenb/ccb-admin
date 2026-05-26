# Library Management System - Setup Guide

Complete setup instructions for deploying the CCB Library Admin web application.

## Prerequisites

- **Node.js 18+** and npm
- **A Google account** (preferably a dedicated account for production)
- **Google Apps Script CLI** (`clasp`)

## Overview

You'll be creating:
1. **3 Master Spreadsheets** — your actual data (Borrowers, Media, Loans)
2. **1 Apps Script Project** — the backend code
3. **1 Web App Deployment** — the user-facing application
4. *(Optional)* **1 Audit Log Spreadsheet** — records write actions

> **Access control:** there is **no** separate "access control" spreadsheet. The web app is deployed to execute **as the user accessing it**, so access is governed by Google's native sharing on the three master spreadsheets — you grant access by sharing those spreadsheets with each user.

## Step-by-Step Setup

### 1. Install Dependencies

```bash
npm install
```

This installs TypeScript, the build tools (esbuild), Google Apps Script types, and testing frameworks.

### 2. Login to Google Apps Script

```bash
npx clasp login
```

This opens a browser window to authenticate with your Google account. Use the account that will own the deployment.

**For production:** use a dedicated organizational account, not a personal account.

### 3. Create the Master Spreadsheets

In Google Drive, create these **3 spreadsheets**:

1. **Borrowers** — library member data
2. **Media** — media items / resources (books, DVDs, etc.)
3. **Loans** — active checkout records

#### Important Naming Requirements

- Spreadsheet names must **start with** these exact words:
  - ✅ "Borrowers", "Borrowers-v2", "Borrowers Dev"
  - ✅ "Media", "Media Production", "Media-2024"
  - ✅ "Loans", "Loans Master"
- Discovery picks the **most recently modified** spreadsheet matching each prefix.
- This lets you keep separate dev and production spreadsheets in the same account.

**Note:** you can add data now or leave them empty — `initializeAllHeaders()` can add the header rows later.

> To populate these spreadsheets with data exported from **Liberty** (the system being migrated from), see the companion repo **[liberty-extract](https://github.com/rrothenb/liberty-extract)**.

### 4. Create the Apps Script Project

Create a new standalone Apps Script project:

```bash
npx clasp create --type standalone --title "CCB Library Admin"
```

This creates a `.clasp.json` file with your script ID.

### 5. Build and Deploy the Code

```bash
npm run deploy
```

This command compiles and bundles the TypeScript with esbuild, pushes to Apps Script, and updates the versioned web-app deployment.

> Use `npm run push` only for editor-side testing — it uploads the code but does **not** update the served web-app version. `npm run deploy` is what actually ships a change to users.

### 6. Configure in Apps Script Editor

Open the Apps Script editor:

```bash
npx clasp open
```

Run the following from the editor (select the function in the dropdown and click **Run**, or call it from the execution console).

#### 6a. Discover Master Spreadsheets

```javascript
runDiscovery()
```

This searches your Drive for spreadsheets whose names start with "Borrowers", "Media", and "Loans", and stores their IDs in script properties.

**First run:** you'll need to authorize the script:
- Click "Review permissions" → choose your account
- Click "Advanced" → "Go to CCB Library Admin (unsafe)" → "Allow"

Check the execution log — you should see each of the three spreadsheets found.

**If discovery fails:**
- Make sure all 3 spreadsheets exist and are named correctly (start with the exact prefix)
- Verify they're not in the trash
- Confirm you're logged into the correct Google account
- Make sure the spreadsheets are in (or shared into) the deploying account's Drive

#### 6b. (Optional) Enable Audit Logging

```javascript
setAuditLogSpreadsheetId()
```

Records the audit-log spreadsheet ID in script properties so write actions (checkouts, returns, edits, deletions) are appended to it.

#### 6c. Verify Configuration

```javascript
showConfig()
```

Confirms the Borrowers, Media, and Loans IDs are set. If any are "(not set)", re-run `runDiscovery()`.

### 7. Initialize Headers (Optional)

If your master spreadsheets are empty, add the column headers:

```javascript
initializeAllHeaders()
```

This adds the header row to each master spreadsheet:
- **Borrowers:** id, name, email, phone, gender, address, postcode, borrowerType, expiryDate, memberSince
- **Media:** id, title, author, type, classification, barcodes, resourceBox
- **Loans:** id, barcode, title, checkoutDate, dueDate, borrowerName, borrowerId

You can also add these headers manually if you prefer.

### 8. Deploy as Web App

If you haven't already created the deployment (step 5 uses an existing deployment ID baked into the `deploy` script), create one in the editor:

1. In the Apps Script editor, click **Deploy → New deployment**
2. Click the gear next to "Select type" and choose **Web app**
3. Fill in the settings:
   - **Description:** "CCB Library Admin v1" (or your preference)
   - **Execute as:** **User accessing the web app**
   - **Who has access:** **Anyone with a Google account**
4. Click **Deploy** and copy the web app URL:
   ```
   https://script.google.com/macros/s/AKfycby.../exec
   ```

**Important:**
- **Execute as: User accessing** means each request runs under that user's own permissions, so the user must be shared on the master spreadsheets.
- **Who has access: Anyone with a Google account** lets anyone open the URL, but they can only read/write data they've been shared on.

> The repo's `npm run deploy` updates a specific existing deployment (its ID is in `package.json`). If you create your own deployment, update that ID so `npm run deploy` targets it.

### 9. Share and Test

1. **Share the Borrowers, Media, and Loans spreadsheets** with your user(s):
   - **Editor** access for desk volunteers who check out / return / edit
   - **Viewer** access for read-only users
2. **Give them the web app URL**
3. Have them visit the URL and sign in with their Google account

**Test access:**
- A user shared on the spreadsheets can use the app.
- A user not shared on a spreadsheet gets an "Access denied" error when an action touches it.

## Development vs. Production Environments

The system discovers spreadsheets by name in the currently logged-in Google account. To maintain separate environments:

### For Development
1. Log in with your dev account: `npx clasp login`
2. Create dev spreadsheets: "Borrowers Dev", "Media Dev", "Loans Dev"
3. Create a dev Apps Script project
4. Run discovery and deploy

### For Production
1. Log in with the production account: `npx clasp login`
2. Create production spreadsheets: "Borrowers", "Media", "Loans"
3. Create a production Apps Script project
4. Run discovery and deploy

### Managing Multiple Environments

You can maintain multiple `.clasp.json` files:

```bash
# Save development config
cp .clasp.json .clasp.dev.json

# Switch to prod account and create prod project
npx clasp login
npx clasp create --type standalone --title "CCB Library Admin Production"

# Save production config
cp .clasp.json .clasp.prod.json

# Switch between environments
cp .clasp.dev.json .clasp.json   # Switch to dev
cp .clasp.prod.json .clasp.json  # Switch to prod
```

After switching, run `npm run deploy` to ship to that environment.

## Maintenance Functions

These functions are available in the Apps Script editor:

### `runDiscovery()`
Searches for master spreadsheets and updates configuration. Run this if you renamed a master spreadsheet, want to switch to a different set, or discovery failed during setup.

### `showConfig()`
Displays current configuration (master spreadsheet IDs and last discovery date).

### `clearConfig()`
Clears the stored master spreadsheet configuration. Use this to start over before re-running discovery.

### `setAuditLogSpreadsheetId()` / `getAuditLogSpreadsheetId()`
Enable audit logging / read back the configured audit-log spreadsheet ID.

### `initializeAllHeaders()`
Adds column headers to all master spreadsheets. Safe to run when sheets are empty.

## Troubleshooting

### "Not authenticated with clasp" error
1. Run `npx clasp login`
2. Complete authentication in the browser
3. Retry your command

### "Could not find spreadsheet(s)" during discovery
1. Verify all 3 spreadsheets exist in Google Drive
2. Check they're named correctly (starting with "Borrowers", "Media", "Loans")
3. Make sure they're not in the trash
4. Verify you're logged into the correct account: `npx clasp login`
5. Run `runDiscovery()` again

### "Access denied" / "Could not access master spreadsheet" runtime error
- The signed-in user isn't shared on that master spreadsheet (or only has view access for a write).
- Share the spreadsheet with the user (editor for writes), or run `showConfig()` / `runDiscovery()` if the configured IDs are wrong.

### Changes to code not appearing
1. Make sure you ran `npm run deploy` (not just `npm run push`)
2. Hard-refresh the web app page (Cmd+Shift+R / Ctrl+Shift+R)
3. Check for build errors: `npm run build`
4. Check Apps Script logs: `npx clasp logs`

### Authorization errors
The first time the script runs, Google asks for permissions. On free accounts you may see an "Unverified app" warning:
1. Click **Advanced**
2. Click **Go to CCB Library Admin (unsafe)**
3. Review permissions and click **Allow**

This is normal for personal projects that haven't gone through Google's verification process.

## Security Notes

- **Access control:** sharing on the three master spreadsheets is the only access layer — there is no separate allow-list.
- **Script execution:** the web app runs **as the user accessing it** (`executeAs: USER_ACCESSING`).
- **Data access:** each user needs to be shared on the master spreadsheets (editor for writes, viewer for read-only).
- **Audit:** when enabled, write actions are recorded with the acting user's email.

## Next Steps

- Add initial data to your master spreadsheets
- Share the master spreadsheets with your library team
- Customize the web app UI if needed (see `src/ui/html/App.html`)

## Getting Help

- Check the logs: `npx clasp logs`
- Review the code: `npx clasp open`
- See [README.md](README.md) for the architecture overview

## License

MIT
