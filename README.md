# CCB Library Admin - Web App Conversion

These files convert the sidebar-based app into a standalone web app.

## What Changed

| Old (Sidebar) | New (Web App) |
|---------------|---------------|
| `src/ui/sidebar.ts` | `src/ui/webapp.ts` |
| `src/ui/html/Sidebar.html` | `src/ui/html/App.html` |
| `src/ui/html/SidebarJS.html` | `src/ui/html/AppJS.html` |
| `src/gas-entry.ts` | `src/gas-entry.ts` (modified) |

## Installation

1. **Copy these files into your existing project:**

   ```
   src/ui/webapp.ts           → replaces sidebar.ts (or keep both)
   src/ui/html/App.html       → new file
   src/ui/html/AppJS.html     → new file  
   src/gas-entry.ts           → replaces existing gas-entry.ts
   ```

2. **Keep these existing files unchanged:**
   - `src/services/*` (all service files)
   - `src/types/*` (all type files)
   - `src/ui/html/Styles.html` (CSS, still used)

## Deployment

1. **Build and push:**
   ```bash
   npm run build
   npm run push
   ```

2. **Create a "Hub" spreadsheet** (for access control):
   - Create an empty Google Sheet called "Library Hub" (or any name)
   - Share it with the volunteers who should have access
   - Copy its ID from the URL

3. **Configure access control** (in Apps Script editor):
   - Open the script editor: `clasp open`
   - Run the function: `setHubId('YOUR_HUB_SPREADSHEET_ID')`
   - Run discovery: `runDiscovery()`

4. **Deploy as web app:**
   - In Apps Script editor: Deploy → New deployment
   - Type: **Web app**
   - Execute as: **Me** (your account)
   - Who has access: **Anyone with Google account**
   - Click Deploy and copy the URL

5. **Share with volunteers:**
   - Give them the web app URL
   - Make sure they're shared on the Hub spreadsheet
   - They just visit the URL and sign in — no scary authorization!

## How Access Control Works

The web app checks if the signed-in user has access to your Hub spreadsheet:

```
User visits web app URL
    ↓
Signs in with Google (normal login)
    ↓
Script checks: Can this user access Hub spreadsheet?
    ↓
Yes → Show the app
No  → Show "Access Denied"
```

To add/remove volunteers:
- **Add:** Share the Hub spreadsheet with them
- **Remove:** Remove their access to the Hub spreadsheet

## Differences from Sidebar Version

1. **No spreadsheet visible** — Volunteers just see the web app UI
2. **No authorization prompt** — Just normal Google sign-in
3. **Tab-based navigation** — Click tabs instead of switching sheets
4. **Search is client-side** — Faster filtering of loaded data
5. **Modals instead of dialogs** — Forms appear in-page, not separate windows

## Setup Checklist

- [ ] Copy new files to project
- [ ] Keep existing services and types
- [ ] Build and push: `npm run push`
- [ ] Create Hub spreadsheet for access control
- [ ] Run `setHubId('...')` in script editor
- [ ] Run `runDiscovery()` to find master spreadsheets
- [ ] Deploy as web app
- [ ] Share Hub spreadsheet with volunteers
- [ ] Share web app URL with volunteers
