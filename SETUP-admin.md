# Admin project setup (one-time)

The admin sync tool is a **second, separate Apps Script project** in this same
repo. It carries the sensitive `contacts` / Drive scopes so the main public web
app never has to (adding those to the main app would force every user to
re-consent). Source is shared; only the deploy target differs.

## What it does

One page (its own web app URL, visible only to the master account) with five
tools. The first two spreadsheets you upload — the **Master Membership file**
and the **Register** — feed everything below them:

| Tool | What it does |
|---|---|
| Membership sync — detect | Reconciles Master + Register + the Borrowers sheet + the account's Contacts into a tiered worklist. Read-only. A 🛑 finding blocks the write tools until it's resolved. |
| Update the Borrowers sheet | Adds members missing from the app and updates expiry dates. Preview, then apply. |
| Gmail Contacts projection | Creates/labels contacts for this year's members. Additive only — never deletes a contact or removes a label. |
| Website class schedule | Rebuilds the schedule Doc (stable PDF link) from the uploads. |
| Library catalogue | Rebuilds the catalogue Docs (stable PDF links) from the Media sheet. |

Both write tools are preview-first, and every apply is logged to the audit sheet.

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

## Status: the development project

The admin project is created and wired up in the **development** account:
- Script: `1yQIdLqmkBefj-SDxaTrkytCLZZn6DZPMKbmHNaLlrdF_hgqYPx2mqlLM`
- Config: `.clasp.admin.json` (repo root, gitignored) → `rootDir` = `dist-admin`
- Deployment id is pinned in `package.json`'s `deploy:admin`.

Day-to-day: `npm run deploy:admin` builds, pushes, and redeploys.

Master contacts account (interim, for acceptance testing): `bigdeadbob@gmail.com`
owns this project.

> **Going live is an account move.** Contacts are written to the **executing
> user's** account, so the production project must be created under the real
> contact-holder account — and the alumni labels built up in the interim account
> do **not** come with it. Follow **[MIGRATION.md](MIGRATION.md)**, which covers
> the Contacts export/import and the fact that the catalogue/schedule PDF links
> change. Don't run the Contacts projection in the new account until the import
> is verified.

## First-run configuration (one-time, in the admin editor)

The admin project is a **separate** Apps Script project, so it has its own
(empty) script-properties store — none of the main app's discovered IDs carry
over. Run these once: `npm run open:admin`, then in the editor pick each
function from the dropdown and **Run** (approve the auth prompt the first time).

| Function | What it does |
|---|---|
| `runDiscovery()` | Locates the master spreadsheets by name and stores their IDs. Finds Borrowers + Media (+ Loans, which the admin project ignores). Works here because this manifest **does** carry the Drive scope — the main app's doesn't, and configures its IDs by hand instead. |
| `setAuditLogSpreadsheetId()` | Points audit logging at the shared log sheet (ID hardcoded in the function). If skipped, `writeAuditLog` silently falls back to `Logger.log`. |
| `showConfig()` / `getAuditLogSpreadsheetId()` | Verify the two above. |

**Advanced services.** `appsscript.admin.json` declares People (v1) and Drive
(v3), so a push normally enables them. If a Contacts run fails with
*"People is not defined"*, open the editor → **Services (+)** → add
**Peopleapi v1** (that also enables the API in the linked Cloud project), then
redeploy.

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
