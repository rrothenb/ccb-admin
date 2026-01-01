# Library Management System - Setup Guide

Complete setup instructions for deploying the CCB Library Admin web application.

## Prerequisites

- **Node.js 18+** and npm
- **A Google account** (preferably a dedicated account for production)
- **Google Apps Script CLI** (`clasp`)

## Overview

You'll be creating:
1. **3 Master Spreadsheets** - Your actual data (Borrowers, Media, Loans)
2. **1 Access Control Spreadsheet** - Controls who can use the web app (can be empty)
3. **1 Apps Script Project** - The backend code
4. **1 Web App Deployment** - The user-facing application

## Step-by-Step Setup

### 1. Install Dependencies

```bash
npm install
```

This installs TypeScript, the build tools, Google Apps Script types, and testing frameworks.

### 2. Login to Google Apps Script

```bash
npx clasp login
```

This opens a browser window to authenticate with your Google account. Use the account that will own the deployment.

**For production:** Use a dedicated organizational account, not a personal account.

### 3. Create the Master Spreadsheets

In Google Drive, create these **3 spreadsheets**:

1. **Borrowers** - Will store library member data
2. **Media** - Will store media items (books, DVDs, etc.)
3. **Loans** - Will store checkout/loan records

#### Important Naming Requirements

- Spreadsheet names must **start with** these exact names
  - ✅ "Borrowers", "Borrowers-v2", "Borrowers Dev"
  - ✅ "Media", "Media Production", "Media-2024"
  - ✅ "Loans", "Loans Master"
- The discovery system will find the **most recently modified** spreadsheet for each type
- This allows you to have separate dev and production spreadsheets

**Note:** You can add data now or leave them empty - the system will initialize headers automatically later.

### 4. Create the Access Control Spreadsheet

Create **1 more spreadsheet** in Google Drive:

- **Name:** "CCB Webapp Access Control" (or any name you prefer)
- **Purpose:** Controls who can access the web app
- **Contents:** Can be completely empty

This spreadsheet's sharing settings determine who can use the web app:
- Anyone with **view** or **edit** access to this spreadsheet can use the web app
- No access to this spreadsheet = denied access to the web app

**For production:**
- Share this spreadsheet with your library volunteers
- Do NOT share the master spreadsheets with volunteers (the web app will access them on their behalf)

### 5. Create the Apps Script Project

Create a new standalone Apps Script project:

```bash
npx clasp create --type standalone --title "CCB Admin"
```

This creates a `.clasp.json` file with your script ID.

**Alternative (bound to a spreadsheet):**
```bash
npx clasp create --type sheets --title "CCB Admin" --parentId YOUR_ACCESS_CONTROL_SPREADSHEET_ID
```

Use this if you want the script project accessible directly from the Access Control spreadsheet's Extensions menu.

### 6. Build and Deploy the Code

```bash
npm run push
```

This command:
1. Compiles TypeScript to JavaScript
2. Bundles the code with esbuild
3. Pushes to Google Apps Script

You should see output like:
```
└─ dist/appsscript.json
└─ dist/code.js
Pushed 2 files.
```

### 7. Configure in Apps Script Editor

Open the Apps Script editor:

```bash
npx clasp open
```

This opens the project in your browser.

#### 7a. Set the Access Control Spreadsheet ID

1. Copy the spreadsheet ID from your Access Control spreadsheet's URL
   - The URL looks like: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`
   - Copy the long string between `/d/` and `/edit`

2. At the bottom of the Apps Script editor, find the execution panel (or View → Execution log)

3. In the execution panel, type this command:
   ```javascript
   setAccessControlId('PASTE_YOUR_SPREADSHEET_ID_HERE')
   ```

4. Press Enter or click Run

5. **First run:** You'll need to authorize the script
   - Click "Review permissions"
   - Choose your account
   - Click "Advanced" → "Go to CCB Admin (unsafe)"
   - Click "Allow"

6. Check the execution log - you should see:
   ```
   Access Control spreadsheet ID set to: YOUR_ID
   ```

#### 7b. Discover Master Spreadsheets

Run the discovery process to find your 3 master spreadsheets:

```javascript
runDiscovery()
```

Check the execution log. You should see:
```
Discovery complete!

Found:
- Borrowers: "Borrowers"
- Media: "Media"
- Loans: "Loans"
```

**If discovery fails:**
- Make sure all 3 spreadsheets exist and are named correctly
- Verify they're not in the trash
- Check you're logged into the correct Google account
- Make sure the spreadsheets are in your Google Drive (not just shared with you)

#### 7c. Verify Configuration

Run this to verify everything is configured:

```javascript
showConfig()
```

You should see all 4 IDs set:
```
Current Configuration:
Borrowers ID: 1abc...
Media ID: 1def...
Loans ID: 1ghi...
Access Control ID: 1jkl...
Last Discovery: 2025-12-30 12:00:00
```

If any IDs are "(not set)", go back and fix the issue.

### 8. Deploy as Web App

1. In Apps Script editor, click **Deploy → New deployment**

2. Click the gear icon next to "Select type" and choose **Web app**

3. Fill in the deployment settings:
   - **Description:** "CCB Admin v1" (or whatever you prefer)
   - **Execute as:** **Me** (your account - this is important!)
   - **Who has access:** **Anyone with Google account**

4. Click **Deploy**

5. **Copy the web app URL** - it looks like:
   ```
   https://script.google.com/macros/s/AKfycby.../exec
   ```

**Important Notes:**
- "Execute as: Me" means the script runs with YOUR permissions, giving it access to the master spreadsheets
- "Who has access: Anyone with Google account" means anyone can visit the URL, but they still need to pass the access control check

### 9. Initialize Headers (Optional)

If your master spreadsheets are empty, initialize the column headers:

```javascript
initializeAllHeaders()
```

This adds the header row to each master spreadsheet:
- **Borrowers:** id, name, email, phone, status, joinDate, notes
- **Media:** id, title, author, type, isbn, status, notes
- **Loans:** id, borrowerId, mediaId, checkoutDate, dueDate, returnDate, status

You can also manually add these headers if you prefer.

### 10. Share and Test

1. **Share the Access Control spreadsheet** with your test user(s)
2. **Give them the web app URL**
3. Have them visit the URL and sign in with their Google account
4. They should see the CCB Admin web app!

**Test the access control:**
- Remove a user's access to the Access Control spreadsheet
- Have them refresh the web app
- They should see "Access Denied"

## Development vs. Production Environments

The system discovers spreadsheets by name in the currently logged-in Google account. To maintain separate environments:

### For Development

1. Login with your dev account: `npx clasp login`
2. Create dev spreadsheets: "Borrowers Dev", "Media Dev", "Loans Dev", "Access Control Dev"
3. Create dev Apps Script project
4. Run discovery and deploy

### For Production

1. Login with the production account: `npx clasp login`
2. Create production spreadsheets: "Borrowers", "Media", "Loans", "CCB Webapp Access Control"
3. Create production Apps Script project
4. Run discovery and deploy

### Managing Multiple Environments

You can maintain multiple `.clasp.json` files:

```bash
# Save development config
cp .clasp.json .clasp.dev.json

# Switch to prod account and create prod project
npx clasp login
npx clasp create --type standalone --title "CCB Admin Production"

# Save production config
cp .clasp.json .clasp.prod.json

# Switch between environments
cp .clasp.dev.json .clasp.json   # Switch to dev
cp .clasp.prod.json .clasp.json  # Switch to prod
```

After switching, run `npm run push` to deploy to that environment.

## Maintenance Functions

These functions are available in the Apps Script editor:

### `runDiscovery()`
Searches for master spreadsheets and updates configuration. Run this if:
- You renamed a master spreadsheet
- You want to switch to a different set of master spreadsheets
- Discovery failed during initial setup

### `showConfig()`
Displays current configuration (all spreadsheet IDs and last discovery date).

### `clearConfig()`
Clears all configuration. Use this to start over.

### `setAccessControlId('id')`
Sets the Access Control spreadsheet ID. Run this if you change the spreadsheet.

### `initializeAllHeaders()`
Adds column headers to all master spreadsheets. Safe to run multiple times (won't duplicate).

### `updateOverdueStatuses()`
Updates loan statuses to mark overdue loans. You can run this manually or set up a daily trigger.

## Setting Up Automated Tasks (Optional)

You can set up triggers to run maintenance tasks automatically:

1. In Apps Script editor: **Triggers** (clock icon on left sidebar)
2. Click **Add Trigger**
3. Choose function: `updateOverdueStatuses`
4. Event source: **Time-driven**
5. Type: **Day timer**
6. Time: **Midnight to 1am** (or your preferred time)
7. Click **Save**

This will automatically mark overdue loans each day.

## Troubleshooting

### "Not authenticated with clasp" error

**Solution:**
1. Run `npx clasp login`
2. Complete authentication in browser
3. Try your command again

### "Missing master spreadsheet(s)" error during discovery

**Solution:**
1. Verify all 3 spreadsheets exist in Google Drive
2. Check they're named correctly (starting with "Borrowers", "Media", "Loans")
3. Make sure they're not in the trash
4. Verify you're logged into the correct account: `npx clasp login`
5. Run `runDiscovery()` again

### "Could not access master spreadsheet" runtime error

**Solution:**
- The spreadsheet IDs in configuration are invalid or you don't have access
- Run `runDiscovery()` to reconfigure

### Access denied for valid users

**Solution:**
1. Run `showConfig()` - verify Access Control ID is set
2. Check the user has access to the Access Control spreadsheet (view or edit)
3. Have the user refresh the web app page
4. Check Apps Script logs: `npx clasp logs`

### Changes to code not appearing

**Solution:**
1. Make sure you ran `npm run push` after making changes
2. Refresh the web app page (hard refresh: Cmd+Shift+R or Ctrl+Shift+R)
3. Check for build errors: `npm run build`
4. Check Apps Script logs: `npx clasp logs`

### Authorization errors

The first time the script runs, Google will ask for permissions. On free accounts, you may see "Unverified app" warning:
1. Click **Advanced**
2. Click **Go to CCB Admin (unsafe)**
3. Review permissions and click **Allow**

This is normal for personal projects that haven't gone through Google's verification process.

## Security Notes

- **Access Control:** The Access Control spreadsheet sharing is your only security layer
- **Script Execution:** The web app runs as YOUR account (the deployer)
- **Data Access:** Your account needs view/edit access to all master spreadsheets
- **User Permissions:** Users do NOT need direct access to master spreadsheets
- **Audit:** All changes are made by your account in the logs

## Next Steps

- Add initial data to your master spreadsheets
- Share the Access Control spreadsheet with your library team
- Set up automated overdue loan checking (see "Setting Up Automated Tasks")
- Customize the web app UI if needed (see `src/ui/html/App.html`)

## Getting Help

- Check the logs: `npx clasp logs`
- Review the code: `npx clasp open`
- See [README.md](README.md) for architecture overview

## License

MIT
