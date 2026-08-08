# Moving to a different Google account

How to stand both Apps Script projects up in a new account — the production
move, or a rebuild after an account is lost. Written to be followed top to
bottom; the ordering matters in a few places and those are called out.

For a first-time setup that isn't a move, [SETUP.md](SETUP.md) (main app) and
[SETUP-admin.md](SETUP-admin.md) (admin app) cover the same ground with more
explanation.

## What is tied to the account (and therefore has to be redone)

Nothing in the repo knows about the old account except two deployment ids in
`package.json`. Everything else that's account-bound lives in Google:

| Thing | Where it lives | On a new account |
|---|---|---|
| Script ids (both projects) | `.clasp.json`, `.clasp.admin.json` (gitignored) | Recreated by `clasp create` |
| Deployment ids (both) | pinned in `package.json`'s `deploy:main` / `deploy:admin` | **Must be replaced by hand** |
| Web app URLs | derived from the deployment ids | **Change** — everyone needs the new link |
| Master spreadsheet ids | script properties, per project | Re-set in each project (they don't share a store) |
| Audit-log spreadsheet id | `DEFAULT_AUDIT_LOG_SPREADSHEET_ID` in `src/services/audit-log.ts` | Share the sheet with the new account, or edit the constant |
| Catalogue / schedule Doc ids | admin project's script properties | Regenerated on first run — **the PDF links on the website change** |
| Gmail Contacts + their labels | the account's own Contacts | **Do not follow the code.** Export/import if you want the history |
| OAuth grants | the account | Re-consented on first run of each project |

Two of those bite quietly: the **website PDF links** and the **Contacts
history**. Both have their own steps below.

## Before you start

Have ready:

- the new account signed in to a browser;
- the three master spreadsheets — **Borrowers**, **Media**, **Loans** — either
  owned by the new account or shared with it as editor;
- the audit-log spreadsheet, shared with the new account as **editor**;
- this repo checked out, `npm install` run, tests green (`npm test`).

> **Transfer beats copy.** If you *copy* the master spreadsheets into the new
> account instead of transferring ownership, you end up with two sets, and the
> app is pointed by id, so a stale copy can be edited by mistake for weeks
> before anyone notices. Transfer ownership (Sheets → Share → the new account →
> "Transfer ownership") and there is only ever one.

## 1. Switch clasp to the new account

```bash
npx clasp logout
npx clasp login          # sign in as the NEW account
```

Both projects push from whichever account clasp is currently logged in as —
there is no per-project login.

## 2. Main app: create the project

```bash
mv .clasp.json .clasp.old.json 2>/dev/null    # keep the old one if you still want it
npx clasp create --type standalone --title "Freedom"
npm run push                                   # push code — NOT `npm run deploy` yet
```

**Why `push` and not `deploy`:** `npm run deploy` ends in
`clasp deploy --deploymentId AKfycbx…`, an id that belongs to the *old*
account's deployment. In a brand-new project that id doesn't exist and the
command fails. You create the deployment first (next step), then pin its id.

## 3. Main app: create the web-app deployment and pin its id

In the Apps Script editor (`npx clasp open`):

1. **Deploy → New deployment**, type **Web app**
2. **Execute as:** *User accessing the web app*
3. **Who has access:** *Anyone with a Google account*
4. **Deploy**, then copy both the **deployment id** and the **web app URL**

Then edit `package.json` and replace the id in `deploy:main`:

```
"deploy:main": "npm run build:main && clasp push --force && clasp deploy --deploymentId <NEW_ID>"
```

From here on `npm run deploy` works normally and keeps the URL stable.

## 4. Main app: point it at the master spreadsheets

Open `src/gas-entry.ts`, fill in the ids (or paste the Sheets URLs — either
works) at the top:

```ts
const MASTER_SPREADSHEETS = {
  borrowers: '1AbC…',
  media: '1DeF…',
  loans: '1GhI…',
};
```

Then `npm run deploy`, and in the editor run
**`setMasterSpreadsheetIdsFromConstants()`** once. Approve the authorization
prompt (see [Authorization warnings](#authorization-warnings) below). Confirm
with **`showConfig()`** — all three ids should be listed.

> **Why not `runDiscovery()`:** the main app's manifest carries no Drive scope
> on purpose, so that a volunteer signing in is only ever asked for Sheets
> access. Discovery searches Drive, so in this project it fails with
> *"You do not have permission to call DriveApp.searchFiles"*. If you would
> rather use name-based discovery anyway, see
> [Using discovery in the main app](#appendix-using-discovery-in-the-main-app).

If the master sheets are empty, run **`initializeAllHeaders()`** now.

## 5. Main app: audit logging

The audit-log spreadsheet id is a constant in `src/services/audit-log.ts`, used
as the default for both projects. Either:

- **share that spreadsheet** with the new account as editor (keeps one
  continuous log across the move — usually what you want), or
- **create a new log sheet**, put its id in `DEFAULT_AUDIT_LOG_SPREADSHEET_ID`,
  and redeploy.

Then run **`setAuditLogSpreadsheetId()`** in the editor and check with
**`getAuditLogSpreadsheetId()`**.

If the account can't open that sheet, every write action fails with "Access
denied to the Audit Log spreadsheet" — logging is not best-effort here.

## 6. Main app: share and hand out the new URL

1. Share Borrowers, Media, and Loans with each volunteer (**editor** for the
   desk, **viewer** for read-only). Access is nothing but this sharing.
2. Send out the **new web app URL** — the old one dies with the old
   deployment. Bookmarks, the website, and any printed cards all need updating.
3. Have one volunteer who is *not* you open it and do a checkout and a return.

## 7. Admin app: create the project

The admin app is a second, separate Apps Script project — same repo, same
source, different entry point and manifest. It holds the Contacts/Drive scopes
so the main app doesn't have to.

```bash
mv .clasp.json .clasp.main.bak                              # stash main's config
npx clasp create --type webapp --title "CCB Admin Sync"     # writes ./.clasp.json
mv .clasp.json .clasp.admin.json                            # this one is the admin config
mv .clasp.main.bak .clasp.json                              # put main's back
# edit .clasp.admin.json: "rootDir" → the absolute path of ./dist-admin
npm run build:admin
npx clasp -P .clasp.admin.json push --force
npx clasp -P .clasp.admin.json deploy                       # prints the new deployment id
```

Pin that id in `package.json`'s `deploy:admin`, exactly as in step 3. After
that, `npm run deploy:admin` is the one command you need.

Two traps, both learned the hard way:

1. `clasp create` writes `.clasp.json` into the current directory, which would
   clobber the main project's config — hence the stashing.
2. Do **not** pass `--rootDir ./dist-admin` to `clasp create`: it writes the
   config *inside* `dist-admin/`, which `npm run build:admin` deletes and
   recreates on every build, wiping it. Create it at the repo root and set
   `rootDir` afterwards.

In the editor (`npm run open:admin`), confirm the web app settings:
**Execute as: User accessing**, **Who has access: Only myself**. This URL should
never be given to anyone.

## 8. Admin app: services and first-run configuration

1. **People API.** `appsscript.admin.json` declares the People and Drive
   advanced services, so pushing the manifest normally enables them. If a
   Contacts run fails with *"People is not defined"*, open the editor →
   **Services (+)** → add **Peopleapi v1** (this also enables the API in the
   linked Cloud project) and redeploy.
2. In the editor, run **`runDiscovery()`** — this project *does* hold the Drive
   scope, so name-based discovery works here. It finds Borrowers and Media
   (and Loans, which the admin app ignores). Verify with **`showConfig()`**.
3. Run **`setAuditLogSpreadsheetId()`**, then **`getAuditLogSpreadsheetId()`**.

The admin account needs read/write on **Borrowers** and **Media**, and edit on
the **audit-log** sheet. Loans is not used by this project.

## 9. Admin app: the Gmail Contacts move

This is the step with no code path — worth reading before you run anything.

**The projection writes to the Contacts of whichever account is running it.** A
new account starts with an empty address book, so the first run there will
happily create this year's members and this year's labels — but the *past*
years, which are the alumni lists the whole labelling scheme exists to
preserve, are still sitting in the old account. Nothing in this repo moves
them.

So, before the first Contacts run in the new account:

1. In the **old** account, open [contacts.google.com](https://contacts.google.com)
   → **Export** → *Contacts* → **Google CSV**. The export includes group
   (label) membership.
2. In the **new** account, **Import** that CSV.
3. Spot-check that a couple of past-year labels (e.g. `25/26 Class 4 …`) came
   across with their members.
4. Only then run **Preview** in the admin app's Gmail Contacts card. Read the
   preview: if it wants to *create* people you know are already there, the
   import didn't land and the run would duplicate them. Fix the import first.

Because the projection only ever adds, a preview that looks wrong is safe to
walk away from — nothing has been written.

## 10. Admin app: the website PDF links

The catalogue and schedule generators keep the same Google Doc across runs
(their ids live in this project's script properties) so the PDF export URLs on
the website stay stable. A new project has no such properties, so the first run
in the new account **creates new Docs with new ids and new URLs**.

1. Run **Generate catalogue** and **Generate schedule** in the admin app.
2. Copy the new PDF links it reports.
3. Update the links on the website.
4. Keep the old Docs until the new links are live and checked.

## 11. Decommission the old account

Only after the new one is fully verified:

- unshare the master spreadsheets from the old account (or leave viewer access
  for a grace period);
- archive the old deployments (Apps Script → **Deploy → Manage deployments** →
  archive) so no one reaches a live-looking old URL;
- keep the old account's Contacts until you're confident the import is
  complete — it's the only copy of the alumni history.

## Verification checklist

Work through this in the new account before telling anyone the move is done.

- [ ] `showConfig()` in the **main** project lists all three spreadsheet ids
- [ ] The web app opens at the new URL and the Members tab shows the roster
- [ ] A checkout, a return, and an extend all succeed from the desk
- [ ] A volunteer who is *not* the owner can do the same
- [ ] The audit-log sheet has rows from those actions, with the right emails
- [ ] `showConfig()` in the **admin** project lists Borrowers and Media
- [ ] Membership sync detection runs and reports a worklist
- [ ] Borrowers preview shows a sane plan (and nothing 🛑 blocking)
- [ ] Contacts preview shows mostly *label additions*, not mass creations
- [ ] Catalogue and schedule generate, and the website links are updated
- [ ] Both deployment ids in `package.json` are the new ones (`git diff`)

## Authorization warnings

The first run in a new account shows Google's unverified-app screen: click
**Advanced → Go to … (unsafe) → Allow**. That's expected for a personal
project that hasn't been through Google's verification. The admin project asks
for noticeably more (Contacts, Drive, Docs) — that's the point of it being a
separate project, and only the master account ever sees that prompt.

## Appendix: using discovery in the main app

If you'd rather have the main app find the sheets by name than paste ids:

1. Add `"https://www.googleapis.com/auth/drive.readonly"` to `oauthScopes` in
   `appsscript.json`.
2. `npm run deploy`, then run `runDiscovery()` in the editor and re-authorize.
3. Check `showConfig()`.
4. **Remove the scope again** and `npm run deploy` once more, so volunteers
   aren't asked for Drive access.

Discovery takes the most recently modified spreadsheet whose name *starts with*
"Borrowers" / "Media" / "Loans". If an old copy or an export is sitting in that
Drive, it can win — which is the other reason the id-pasting path is the
default.
