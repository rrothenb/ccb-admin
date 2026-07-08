# Admin project setup (one-time)

The admin sync tool is a **second, separate Apps Script project** in this same
repo. It carries the sensitive `contacts` / Drive scopes so the main public web
app never has to (adding those to the main app would force every user to
re-consent). Source is shared; only the deploy target differs.

## Layout

| | Main app | Admin sync app |
|---|---|---|
| Entry point | `src/gas-entry.ts` | `src/admin-entry.ts` |
| Manifest | `appsscript.json` | `appsscript.admin.json` |
| Build output | `dist/` | `dist-admin/` |
| clasp config | `.clasp.json` | `.clasp.admin.json` |
| Build | `npm run build:main` | `npm run build:admin` |
| Deploy | `npm run deploy` / `deploy:main` | `npm run deploy:admin` |

Both clasp configs are gitignored (they hold script IDs). A committed
`.clasp.admin.json.example` shows the shape.

## Status: already done

The admin project is created and wired up:
- Script: `1yQIdLqmkBefj-SDxaTrkytCLZZn6DZPMKbmHNaLlrdF_hgqYPx2mqlLM`
- Config: `.clasp.admin.json` (repo root, gitignored) → `rootDir` = `dist-admin`
- Deployment id is pinned in `package.json`'s `deploy:admin`.

Day-to-day: `npm run deploy:admin` builds, pushes, and redeploys.

Master contacts account (interim, for acceptance testing): `bigdeadbob@gmail.com`
owns the admin project. Contacts are written to the **executing user's** account,
so before production this project must be re-owned by the real contact-holder
account.

## First-run configuration (one-time, in the admin editor)

The admin project is a **separate** Apps Script project, so it has its own
(empty) script-properties store — none of the main app's discovered IDs carry
over. Run these once: `npm run open:admin`, then in the editor pick each
function from the dropdown and **Run** (approve the auth prompt the first time).

| Function | What it does |
|---|---|
| `runDiscovery()` | Locates the master spreadsheets by name and stores their IDs. Finds Borrowers + Media (+ Loans, which the admin project ignores). |
| `setAuditLogSpreadsheetId()` | Points audit logging at the shared log sheet (ID hardcoded in the function). If skipped, `writeAuditLog` silently falls back to `Logger.log`. |
| `showConfig()` / `getAuditLogSpreadsheetId()` | Verify the two above. |

**Sheets the admin project uses:** Borrowers (write expiry), the audit-log sheet
(log sync actions), and Media (catalogue PDF generator only). **Not Loans.**

**Access prerequisites** — the owning account (`bigdeadbob@gmail.com`) needs:
read/write on **Borrowers** and **Media**, and **edit** access to the **audit-log**
spreadsheet. (Discovery will print a harmless partial warning if Loans isn't shared.)

## How it was created (for reference / re-creating)

Two gotchas, both learned the hard way:
1. `clasp create` writes `.clasp.json` to the **current dir** by default, which
   would clobber the main config — so stash main first.
2. Do **NOT** pass `--rootDir ./dist-admin` to `clasp create`: it writes the
   config *inside* `dist-admin/`, and `npm run build:admin` deletes and
   recreates `dist-admin/` on every build, wiping it. Create the config at the
   repo root and set `rootDir` afterward.

```bash
mv .clasp.json .clasp.main.bak                              # stash main
npx clasp create --type webapp --title "CCB Admin Sync"     # writes ./.clasp.json
mv .clasp.json .clasp.admin.json                            # becomes the admin config
mv .clasp.main.bak .clasp.json                              # restore main
# edit .clasp.admin.json: set "rootDir" to the absolute path of ./dist-admin
npm run build:admin
npx clasp -P .clasp.admin.json push --force
npx clasp -P .clasp.admin.json deploy                       # prints the deployment id → pin it in package.json
```

In the Apps Script editor for the admin project, confirm the web app settings
(Execute as: **User accessing**, Access: **Only myself** — matches
`appsscript.admin.json`). Only the master account should ever open its URL.
