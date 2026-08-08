# Freedom - Web App

A library management system built on Google Apps Script and Google Sheets, deployed as a standalone web application.

## Overview

This system provides a web-based interface for managing a community library. It uses:
- **Google Sheets** as the database (3 master spreadsheets: Borrowers, Media, Loans)
- **Google Apps Script** for the backend logic (TypeScript, bundled with esbuild)
- **Web App deployment** for the user interface
- **Google Drive sharing** for access control

## Related Projects

- **[liberty-extract](https://github.com/rrothenb/liberty-extract)** — companion tooling that extracts the data needed to populate the master spreadsheets (Borrowers, Media, Loans) out of **Liberty**, the library system this app is migrating from. Use it to produce the initial spreadsheet data for setup.

### Admin sync tool

A **second, master-account-only Apps Script project** lives in this same repo (`src/admin-entry.ts` → `dist-admin/`, deployed via `npm run deploy:admin`). It carries the sensitive `contacts`/Drive scopes — kept out of the main app so regular users never have to consent to them — and owns the once-a-year membership workflow: reconcile the Master + Register spreadsheets against the app and the account's Contacts, write back the Borrowers sheet, project Gmail Contacts labels, and regenerate the website's catalogue and class-schedule PDFs. Every write is preview-first and additive. See **[SETUP-admin.md](SETUP-admin.md)**.

## Key Features

- **Standalone web app** — no spreadsheet visible to users, just the web interface
- **Circulation Desk** — check out, return, and extend loans by scanning/typing a barcode, with barcode typeahead and per-session history; a check-out-by-name fallback lets you type a title and press Enter when a copy has already walked off (only for resources with exactly one available copy)
- **Members** — full roster shown by default, with client-side search and sortable Name/Expiry columns; active/expired status derived from each member's expiry date
- **Resources** — search the catalog by title/author/barcode/etc., filter by classification and by availability status (available / on-loan / no-copies); add, edit, and delete resources
- **Loans** — view active loans, filter to overdue only, search by member/resource/barcode, and sort by member, resource, classification, checkout date, or due date
- **Audit logging** — write actions (checkouts, returns, edits, deletions), session starts (one entry per page load), and every error shown to a user are recorded to a configured log spreadsheet
- **No authorization prompts beyond sign-in** — users just sign in with their Google account

## Quick Start

See [SETUP.md](SETUP.md) for detailed setup instructions, or [MIGRATION.md](MIGRATION.md) if you're moving an existing deployment to a different Google account.

**Summary:**
1. Install dependencies: `npm install`
2. Log in to Google Apps Script: `npx clasp login`
3. Create 3 master spreadsheets in your Drive named **Borrowers**, **Media**, and **Loans**
4. Create the Apps Script project: `npx clasp create --type standalone`
5. Push the code: `npm run push` (not `deploy` — there's no deployment to update yet)
6. Deploy as a web app (Execute as: **User accessing**, Access: **Anyone with a Google account**), and pin the new deployment ID in `package.json`'s `deploy:main`
7. Configure in the Apps Script editor:
   - Fill in `MASTER_SPREADSHEETS` at the top of `src/gas-entry.ts`, push, and run `setMasterSpreadsheetIdsFromConstants()`
   - (Optional) Run `setAuditLogSpreadsheetId()` to enable audit logging
   - Run `showConfig()` to verify configuration
8. Share the **three master spreadsheets** with your users, and give them the web app URL

## Architecture

### Data Flow

```
User visits web app URL
    ↓
Signs in with their Google account
    ↓
Web app runs AS the signed-in user (executeAs: USER_ACCESSING)
    ↓
Apps Script reads/writes the master spreadsheets using the user's own
Google permissions — if the user isn't shared on a spreadsheet, the
operation fails with an "Access denied" message
```

### Spreadsheets

**3 Master Spreadsheets** (your data) — the main app is pointed at them by ID via `setMasterSpreadsheetIdsFromConstants()`; the admin project finds them by name prefix via `runDiscovery()`:
- **Borrowers** — library members
- **Media** — books, DVDs, etc. (a.k.a. "Resources" in the UI)
- **Loans** — active checkout records (rows are removed on return)

**1 Audit Log Spreadsheet** (optional) — write actions are appended here when configured via `setAuditLogSpreadsheetId()`.

## Access Control

Access is governed entirely by **Google's native sharing on the master spreadsheets** — there is no separate access-control spreadsheet or allow-list.

Because the web app is deployed with `executeAs: USER_ACCESSING`, every read and write runs under the signed-in user's own Google identity:

- **To grant access:** share the Borrowers, Media, and Loans spreadsheets with the user (editor access is needed for checkouts/returns/edits; viewer access only allows browsing).
- **To revoke access:** remove the user's sharing from those spreadsheets.

> Note: this is the opposite of an earlier design where the app ran as the owner and users needed no spreadsheet access. Users now **do** need to be shared on the master spreadsheets.

## Deployment

### Build and deploy

```bash
npm run deploy   # Build, push, and update the live web-app deployment
```

`npm run deploy` builds the TypeScript, pushes to Apps Script, and updates the existing versioned deployment (the deployment ID is baked into the `deploy` script in `package.json`). This is the command that actually changes what users see at the web app URL.

```bash
npm run push     # Build and push files only (no new deployment/version)
```

`npm run push` uploads the latest code to the Apps Script project but does **not** update the served web-app version — use it only for editor testing, not to ship a change.

### Initial configuration (in the Apps Script editor)

Open the editor:
```bash
npx clasp open
```

Then run these functions from the editor's function dropdown:

1. **`setMasterSpreadsheetIdsFromConstants`** — stores the three IDs you filled into `MASTER_SPREADSHEETS` at the top of `src/gas-entry.ts` (IDs or Sheets URLs both work). This is how the main app is configured: its manifest carries no Drive scope, so the name-based `runDiscovery` can't run here.
2. **`setAuditLogSpreadsheetId`** *(optional)* — enables audit logging by recording the log spreadsheet ID in script properties. The ID is a constant in `src/services/audit-log.ts`; the account must be able to open that sheet.
3. **`showConfig`** — prints the current configuration so you can verify the master spreadsheet IDs are set.
4. **`clearConfig`** — clears the stored master spreadsheet configuration.

### Deploy as a web app

1. In the Apps Script editor: **Deploy → New deployment**
2. Type: **Web app**
3. Execute as: **User accessing the web app**
4. Who has access: **Anyone with a Google account**
5. Click **Deploy** and copy the URL

### Share with users

1. Share the **Borrowers, Media, and Loans** spreadsheets with the users who should have access
2. Give them the **web app URL**
3. They visit the URL and sign in

## Development Workflow

### Local development

```bash
npm run watch    # Type-check in watch mode (tsc --watch)
npm run deploy   # Build, push, and deploy when ready to ship a change
```

### Running tests

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

- `npm run build` / `build:admin` — Compile/bundle TypeScript to `dist/` / `dist-admin/`
- `npm run push` / `push:admin` — Build and push files to Apps Script (no new deployment)
- `npm run deploy` / `deploy:admin` — Build, push, and update the live deployment
- `npm run open` / `open:admin` — Open the project in the Apps Script editor
- `npm run watch` — Type-check on change
- `npm test` / `npm run test:watch` / `npm run test:coverage` — Jest tests
- `npm run lint` — ESLint
- `npx clasp logs` — View execution logs

> The two `deploy` scripts each pin a deployment ID. They belong to the account that created those deployments — a new account needs its own IDs pasted in. See [MIGRATION.md](MIGRATION.md).

## Project Structure

```
ccb-admin/
├── src/
│   ├── types/                # TypeScript type definitions (entities, config)
│   ├── services/             # Business logic (borrowers, media, loans, discovery, audit-log)
│   ├── utils/                # Shared helpers (resource boxes)
│   ├── ui/                   # Main web app UI
│   │   ├── webapp.ts         # doGet entry point
│   │   └── html/             # HTML templates (App.html, AppJS.html, Styles.html)
│   ├── admin/                # Admin sync app (separate GAS project)
│   │   ├── ingest/           # .xlsx upload → parsed Master / Register rows
│   │   ├── detector/         # Reconciliation: matching, kinship, spelling, rules
│   │   ├── contacts/         # Gmail Contacts projection (planner + People API)
│   │   ├── schedule/         # Class-schedule Doc generation
│   │   ├── catalogue/        # Library catalogue Doc generation
│   │   ├── borrower-sync.ts  # Borrowers sheet write-back
│   │   └── html/Admin.html   # Admin UI (single page)
│   ├── test/                 # Jest setup + GAS mocks
│   ├── gas-entry.ts          # Main app's global function exports (client-callable)
│   └── admin-entry.ts        # Admin app's global function exports
├── dist/                     # Main app build output (auto-generated, pushed to GAS)
├── dist-admin/               # Admin app build output (auto-generated)
├── build.js                  # Build script (esbuild; `node build.js main|admin`)
├── package.json              # Dependencies, scripts, and the two deployment IDs
├── tsconfig.json             # TypeScript configuration
├── appsscript.json           # Main app manifest (web app + OAuth scopes)
└── appsscript.admin.json     # Admin app manifest (adds contacts/Drive/Docs scopes)
```

> Client-side JS in `AppJS.html` calls server functions via `google.script.run`. Any new server function in `gas-entry.ts` must be exported onto `globalThis` (see the bindings at the bottom of the file) or the client cannot call it.

## Troubleshooting

### "Access denied" / "Could not access master spreadsheet"

- Confirm the user is shared on the relevant master spreadsheet (editor access for writes).
- In the editor, run `showConfig()` to confirm the master spreadsheet IDs are set; if not, run `setMasterSpreadsheetIdsFromConstants()`.

### Web app doesn't appear or shows stale content

1. Make sure you ran `npm run deploy` (not just `npm run push`).
2. Refresh the page / clear your browser cache.
3. Check logs: `npx clasp logs`; verify deployment: `npx clasp deployments`.

### Changes not appearing

1. Confirm `npm run deploy` completed without errors.
2. Check for TypeScript/build errors: `npm run build`.

## License

MIT
