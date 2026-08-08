# Moving to a different Google account

Two ways to do this:

- **[Route A — transfer ownership](#route-a--transfer-ownership)** (preferred).
  Hand the existing Drive files to the new account. The web app URLs, the
  configuration, and the website's PDF links all survive.
- **[Route B — recreate from scratch](#route-b--recreate-from-scratch)**. New
  projects, new deployments, new everything. Use this when transfer isn't
  available, or when rebuilding after an account is lost.

Whichever route, [the Gmail Contacts move](#the-gmail-contacts-move-both-routes)
is the same and has to be done by hand.

For a first-time setup that isn't a move, [SETUP.md](SETUP.md) (main app) and
[SETUP-admin.md](SETUP-admin.md) (admin app) cover the same ground with more
explanation.

## What actually has to move

Neither app runs as its owner — both deploy with `executeAs: USER_ACCESSING`.
So "the app is in the wrong account" is three separate questions, and only the
last one is a hard requirement:

| | Who it has to be | Why |
|---|---|---|
| Who owns the **code** | anybody | The owner is only who can edit and deploy. No runtime role. |
| Who owns the **spreadsheets** | anybody, as long as the volunteers are shared | Reads and writes run as the signed-in volunteer. |
| Whose **Contacts** are written | the account that opens the **admin** app | The People API writes to the executing user. |

If the goal is purely that the right account holds the members' contact
details, only the admin app strictly has to move. Moving the main app too is a
tidiness decision — a good one for handover, but not a functional requirement.

## Which route can you take?

Ownership transfer is Google's feature, not this project's, and availability
depends on the account types:

| From → to | Transfer? |
|---|---|
| Same Workspace domain | Yes, for everything |
| Different Workspace domains | **No** — cross-domain transfer is blocked. Route B. |
| Consumer Gmail → consumer Gmail | Yes for Google-native file types; check the script projects specifically |

**Check it in thirty seconds:** open the Apps Script project's file in Drive,
click Share, add the target account, and look at the role dropdown. If
"Transfer ownership" is offered, Route A is open. If it isn't, take Route B.

### What survives a transfer

Script properties, script ids, and deployment ids belong to the **script
project**, not to the account — so transferring the file carries them along.

| Thing | Route A (transfer) | Route B (recreate) |
|---|---|---|
| Web app URLs | **Survive** — nobody needs a new link | Change; everyone needs the new link |
| Deployment ids in `package.json` | Unchanged | **Must be replaced by hand** |
| Master spreadsheet ids (script properties) | **Survive** | Re-set in each project (they don't share a store) |
| Audit-log spreadsheet id | Survives; transfer or share the sheet too | Share the sheet, or edit `DEFAULT_AUDIT_LOG_SPREADSHEET_ID` |
| Catalogue / schedule Doc ids | **Survive — the website's PDF links keep working** | New Docs, new URLs; the website needs updating |
| Your local clasp workflow | Keeps working — an *editor* can push, owner or not | New `.clasp*.json` files |
| Gmail Contacts + their labels | **Do not transfer.** Account data, not project data | Same — export/import |
| OAuth grants | Per user; re-consented on first run | Same |

The one row that no route helps with is Contacts. It has
[its own section](#the-gmail-contacts-move-both-routes).

## Route A — transfer ownership

Do the transfers from the **old** account, in Drive's share dialog for each
file ("Transfer ownership"). The new account has to accept each one.

1. **The two script projects** — "Freedom" and "CCB Admin Sync". Keep the old
   account on as an **editor** so you can still `clasp push` from your laptop.
2. **The three master spreadsheets** — Borrowers, Media, Loans.
3. **The audit-log spreadsheet.**
4. **The generated Docs** — the catalogue Docs and the class-schedule Doc. This
   is what keeps the website's PDF links alive; skip it and those links break
   the first time the admin app can't open the old Doc.
5. **Check the main app.** Open its web app URL (unchanged) and confirm the
   roster loads and a checkout works. Nothing should have moved.
6. **Check the admin app.** Have the **new** account open the admin URL. It's
   deployed "Only myself", which resolves to whoever published it — if the new
   owner is refused, have them do **Deploy → New deployment** in the editor
   (Execute as: *User accessing*, Access: *Only myself*) and pin that new
   deployment id in `package.json`'s `deploy:admin`. That's the one id that may
   still change on this route.
7. **Run the Contacts import** —
   [see below](#the-gmail-contacts-move-both-routes) — before running the
   Contacts projection.
8. **Verify** with the [checklist](#verification-checklist), skipping the rows
   about new URLs and ids.

Then, once you're happy: sign the old account out of anything shared, and keep
its Contacts until the import is confirmed. There's nothing to decommission —
the deployments are the same ones, now owned by the right account.

> **Don't copy instead of transferring.** A *copy* of a master spreadsheet
> leaves two live sets, and the app points at one by id — the wrong one can be
> edited by mistake for weeks before anyone notices. Transfer, and there is only
> ever one.

## Route B — recreate from scratch

Everything below is the rebuild path: new projects, new deployments, new
configuration. Follow it top to bottom — the ordering matters in a few places
and those are called out.

### Before you start

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

### 1. Switch clasp to the new account

```bash
npx clasp logout
npx clasp login          # sign in as the NEW account
```

Both projects push from whichever account clasp is currently logged in as —
there is no per-project login.

### 2. Main app: create the project

```bash
mv .clasp.json .clasp.old.json 2>/dev/null    # keep the old one if you still want it
npx clasp create --type standalone --title "Freedom"
npm run push                                   # push code — NOT `npm run deploy` yet
```

**Why `push` and not `deploy`:** `npm run deploy` ends in
`clasp deploy --deploymentId AKfycbx…`, an id that belongs to the *old*
account's deployment. In a brand-new project that id doesn't exist and the
command fails. You create the deployment first (next step), then pin its id.

### 3. Main app: create the web-app deployment and pin its id

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

### 4. Main app: point it at the master spreadsheets

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

### 5. Main app: audit logging

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

### 6. Main app: share and hand out the new URL

1. Share Borrowers, Media, and Loans with each volunteer (**editor** for the
   desk, **viewer** for read-only). Access is nothing but this sharing.
2. Send out the **new web app URL** — the old one dies with the old
   deployment. Bookmarks, the website, and any printed cards all need updating.
3. Have one volunteer who is *not* you open it and do a checkout and a return.

### 7. Admin app: create the project

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

### 8. Admin app: services and first-run configuration

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

## The Gmail Contacts move (both routes)

This is the step with no code path and no shortcut — worth reading before you
run anything. It applies just as much to Route A: ownership transfer moves
*files*, and Contacts aren't a file.

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

## The website PDF links

The catalogue and schedule generators keep the same Google Doc across runs
(their ids live in the admin project's script properties) so the PDF export
URLs on the website stay stable.

**Route A:** the properties travel with the project and the Docs were
transferred in step 4, so the links keep working. Run **Generate catalogue**
and **Generate schedule** once and confirm they rewrite the same Docs rather
than creating new ones — if a Doc wasn't transferred, the generator can't open
it, logs that, and silently creates a replacement with a new URL.

**Route B:** a new project has no such properties, so the first run **creates
new Docs with new ids and new URLs**.

1. Run **Generate catalogue** and **Generate schedule** in the admin app.
2. Copy the new PDF links it reports.
3. Update the links on the website.
4. Keep the old Docs until the new links are live and checked.

## Decommissioning the old account (Route B)

On Route A there's nothing to decommission — the deployments are the same ones,
now owned by the right account. On Route B, only after the new one is fully
verified:

- unshare the master spreadsheets from the old account (or leave viewer access
  for a grace period);
- archive the old deployments (Apps Script → **Deploy → Manage deployments** →
  archive) so no one reaches a live-looking old URL;
- keep the old account's Contacts until you're confident the import is
  complete — it's the only copy of the alumni history.

## Verification checklist

Work through this in the new account before telling anyone the move is done.
The rows marked *(B)* only apply to the recreate route.

- [ ] `showConfig()` in the **main** project lists all three spreadsheet ids
- [ ] The web app opens (at the new URL, on Route B) and the Members tab shows the roster
- [ ] A checkout, a return, and an extend all succeed from the desk
- [ ] A volunteer who is *not* the owner can do the same
- [ ] The audit-log sheet has rows from those actions, with the right emails
- [ ] `showConfig()` in the **admin** project lists Borrowers and Media
- [ ] The new account — not the old one — is the one that opens the admin app
- [ ] Membership sync detection runs and reports a worklist
- [ ] Borrowers preview shows a sane plan (and nothing 🛑 blocking)
- [ ] Contacts preview shows mostly *label additions*, not mass creations
- [ ] Catalogue and schedule rewrite their existing Docs (Route A) or the website links are updated *(B)*
- [ ] Both deployment ids in `package.json` are the new ones (`git diff`) *(B)*

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
