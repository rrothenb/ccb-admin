# Library Management System - Setup Guide

Complete setup instructions for deploying the Freedom web application.

> Moving an existing deployment to a different Google account? Follow
> **[MIGRATION.md](MIGRATION.md)** instead — it covers the same steps plus the
> things that don't travel (Contacts history, website PDF links, deployment ids).
> The admin sync tool has its own guide: **[SETUP-admin.md](SETUP-admin.md)**.

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
npx clasp create --type standalone --title "Freedom"
```

This creates a `.clasp.json` file with your script ID.

### 5. Build and Push the Code

```bash
npm run push
```

This compiles and bundles the TypeScript with esbuild and uploads it to your Apps Script project.

> **On a brand-new project, use `push` here, not `deploy`.** `npm run deploy` ends in `clasp deploy --deploymentId AKfycbx…`, an id baked into `package.json` that belongs to an *existing* deployment. In a new project that id doesn't exist and the command fails. Create the deployment in step 8, pin its id in `package.json`, and `npm run deploy` works from then on.

Once that's done, the rule is: `npm run deploy` ships a change to users; `npm run push` only updates the editor copy and leaves the served version alone.

### 6. Configure in Apps Script Editor

Open the Apps Script editor:

```bash
npx clasp open
```

Run the following from the editor (select the function in the dropdown and click **Run**, or call it from the execution console).

#### 6a. Point the App at the Master Spreadsheets

Edit the constants at the top of `src/gas-entry.ts` — each takes a spreadsheet ID or, just as well, the Sheets URL you copied from the address bar:

```ts
const MASTER_SPREADSHEETS = {
  borrowers: '1AbC…',
  media: '1DeF…',
  loans: '1GhI…',
};
```

Push the change (`npm run push`), then run in the editor:

```javascript
setMasterSpreadsheetIdsFromConstants()
```

**First run:** you'll need to authorize the script:
- Click "Review permissions" → choose your account
- Click "Advanced" → "Go to Freedom (unsafe)" → "Allow"

> **Why not `runDiscovery()`?** It exists, and it finds the spreadsheets by name — but it searches Drive, and this app's manifest deliberately carries **no Drive scope** so that volunteers signing in are only ever asked for Sheets access. Called here it throws *"You do not have permission to call DriveApp.searchFiles"*. If you want name-based discovery anyway, [MIGRATION.md](MIGRATION.md#appendix-using-discovery-in-the-main-app) has the temporary-scope recipe. The admin project holds the Drive scope and uses `runDiscovery()` normally.

#### 6b. (Optional) Enable Audit Logging

```javascript
setAuditLogSpreadsheetId()
```

Records the audit-log spreadsheet ID in script properties so write actions (checkouts, returns, edits, deletions) are appended to it.

The ID itself is the `DEFAULT_AUDIT_LOG_SPREADSHEET_ID` constant in `src/services/audit-log.ts` — the function takes no arguments, so a new installation either shares that spreadsheet with the deploying account or edits the constant and redeploys. That same constant is the fallback both projects use when the property isn't set, so the account **must** be able to open it: if it can't, write actions fail with "Access denied to the Audit Log spreadsheet" rather than skipping the log.

#### 6c. Verify Configuration

```javascript
showConfig()
```

Confirms the Borrowers, Media, and Loans IDs are set. If any are "(not set)", check the constants in step 6a and run it again.

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

Create the deployment in the editor:

1. In the Apps Script editor, click **Deploy → New deployment**
2. Click the gear next to "Select type" and choose **Web app**
3. Fill in the settings:
   - **Description:** "Freedom v1" (or your preference)
   - **Execute as:** **User accessing the web app**
   - **Who has access:** **Anyone with a Google account**
4. Click **Deploy**, then copy **both** the web app URL and the deployment ID:
   ```
   https://script.google.com/macros/s/AKfycby.../exec
   ```
5. Paste the deployment ID into `package.json`, replacing the one in `deploy:main`:
   ```
   "deploy:main": "npm run build:main && clasp push --force && clasp deploy --deploymentId <YOUR_ID>"
   ```

From now on `npm run deploy` updates *this* deployment, so the URL never changes under your users.

**Important:**
- **Execute as: User accessing** means each request runs under that user's own permissions, so the user must be shared on the master spreadsheets.
- **Who has access: Anyone with a Google account** lets anyone open the URL, but they can only read/write data they've been shared on.

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

Each Apps Script project stores its own spreadsheet IDs, so an environment is a project plus the sheets you point it at. To maintain separate environments:

### For Development
1. Log in with your dev account: `npx clasp login`
2. Create dev spreadsheets: "Borrowers Dev", "Media Dev", "Loans Dev"
3. Create a dev Apps Script project
4. Point it at the dev sheets (step 6a) and deploy

### For Production
1. Log in with the production account: `npx clasp login`
2. Create production spreadsheets: "Borrowers", "Media", "Loans"
3. Create a production Apps Script project
4. Point it at the production sheets (step 6a) and deploy

Each project also needs its own deployment ID in `package.json` — see step 8.

### Managing Multiple Environments

You can maintain multiple `.clasp.json` files:

```bash
# Save development config
cp .clasp.json .clasp.dev.json

# Switch to prod account and create prod project
npx clasp login
npx clasp create --type standalone --title "Freedom Production"

# Save production config
cp .clasp.json .clasp.prod.json

# Switch between environments
cp .clasp.dev.json .clasp.json   # Switch to dev
cp .clasp.prod.json .clasp.json  # Switch to prod
```

After switching, run `npm run deploy` to ship to that environment.

## Maintenance Functions

These functions are available in the Apps Script editor:

### `setMasterSpreadsheetIdsFromConstants()`
Stores the three IDs from the `MASTER_SPREADSHEETS` block at the top of `src/gas-entry.ts`. This is how the main app is configured — at setup, and again whenever you switch to a different set of sheets. Blank entries are left alone, so you can repoint one sheet without touching the others.

### `runDiscovery()`
Finds the master spreadsheets by name and stores their IDs. **Needs a Drive scope this project doesn't grant** — use it in the admin project, not here. See step 6a.

### `showConfig()`
Displays current configuration (master spreadsheet IDs and when they were last set).

### `clearConfig()`
Clears the stored master spreadsheet configuration. Use this to start over.

### `setAuditLogSpreadsheetId()` / `getAuditLogSpreadsheetId()`
Enable audit logging / read back the configured audit-log spreadsheet ID.

### `initializeAllHeaders()`
Adds column headers to all master spreadsheets. Safe to run when sheets are empty.

## Troubleshooting

### "Not authenticated with clasp" error
1. Run `npx clasp login`
2. Complete authentication in the browser
3. Retry your command

### "You do not have permission to call DriveApp.searchFiles"
You ran `runDiscovery()` in the main project. It needs a Drive scope the manifest deliberately omits — use `setMasterSpreadsheetIdsFromConstants()` instead (step 6a).

### `showConfig()` says "(not set)" after configuring
1. Check the IDs really are filled in in `MASTER_SPREADSHEETS` (`src/gas-entry.ts`)
2. Make sure you pushed the edit (`npm run push`) before running the function — the editor runs the *pushed* code, not your working copy
3. Run `setMasterSpreadsheetIdsFromConstants()` again and read the log it prints

### "Access denied" / "Could not access master spreadsheet" runtime error
- The signed-in user isn't shared on that master spreadsheet (or only has view access for a write).
- Share the spreadsheet with the user (editor for writes), or run `showConfig()` to check the configured IDs are the ones you meant.

### "Access denied to the Audit Log spreadsheet"
The account can't open the audit-log sheet (see step 6b). Share it with that account as **editor** — logging isn't best-effort, so this failure surfaces to the user mid-action.

### "Deployment not found" from `npm run deploy`
`package.json` still holds a deployment ID from another project or account. Create a deployment (step 8) and pin its ID.

### Changes to code not appearing
1. Make sure you ran `npm run deploy` (not just `npm run push`)
2. Hard-refresh the web app page (Cmd+Shift+R / Ctrl+Shift+R)
3. Check for build errors: `npm run build`
4. Check Apps Script logs: `npx clasp logs`

### Authorization errors
The first time the script runs, Google asks for permissions. On free accounts you may see an "Unverified app" warning:
1. Click **Advanced**
2. Click **Go to Freedom (unsafe)**
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
- Moving accounts: [MIGRATION.md](MIGRATION.md)
- The admin sync tool: [SETUP-admin.md](SETUP-admin.md)

## License

MIT
