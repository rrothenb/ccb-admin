# Library System MVP - Decision Summary

> ⚠️ **Historical document — superseded.** This captures early MVP planning decisions and does **not** describe the system as built. The shipped implementation diverged in major ways:
> - **No "Hub" spreadsheet and no `IMPORTRANGE`.** The app is a **standalone web app** (`doGet`) that reads/writes the master spreadsheets directly via Apps Script.
> - **No bound sidebar/menu.** The UI is a tab-based web app (Circulation Desk, Members, Resources, Loans).
> - **Runs as the accessing user** (`executeAs: USER_ACCESSING`); access is controlled by sharing the three master spreadsheets — not by a Hub and not by an owner-runs-everything model.
> - **Entity fields evolved** (e.g. Borrowers track `expiryDate`/`memberSince`; Media uses `classification`/`barcodes`/`resourceBox`; Loans store `barcode`/`title`/`checkoutDate`/`dueDate`/`borrower*`).
>
> For accurate, current documentation see **[README.md](README.md)** and **[SETUP.md](SETUP.md)**. The content below is retained only as a record of the original design rationale.

## Goal
Build an MVP to replace the current library management process. Prioritize final UX over features—make it mistake-proof for non-technical volunteers.

## Technology Choice
**Google Sheets + Apps Script**

Chosen because:
- Volunteers already understand Sheets
- Authentication is built-in (Google account sharing)
- No additional cost
- Full control over UX
- No installation required for end users

## Architecture

### Four-Spreadsheet Model

| Spreadsheet | Purpose | Apps Script |
|-------------|---------|-------------|
| **Borrowers** | Master data for library members | No (passive) |
| **Media** | Master data for books, DVDs, etc. | No (passive) |
| **Loans** | Master data for loan records | No (passive) |
| **Hub** | Volunteer interface with linked views | Yes |

- Master spreadsheets are passive data stores (no scripts)
- Hub uses `IMPORTRANGE` to display data from the three masters
- Apps Script in Hub writes back to master spreadsheets via `SpreadsheetApp.openById()`
- Auto-discovery: Script finds masters by name (e.g., "Borrowers", "Media-v2") in Drive
- Volunteers only need access to Hub; script accesses masters on their behalf

### User Interface

- **Context-aware sidebar:** Detects active sheet, shows relevant actions for that sheet (e.g., Loans sheet shows loan operations)
- **Custom HTML dialogs:** Full control over UX, including autocomplete for member/book lookup and validation before writes
- **Custom menu:** Appears automatically when spreadsheet opens

### Authentication & Roles

- Leverage Google's built-in sharing (specific accounts only, not "anyone with link")
- *(Planned)* Volunteers tab in master sheet defines roles (Admin, Desk Volunteer, Read Only)
- *(Planned)* Script checks `Session.getActiveUser().getEmail()` against roles
- *(Planned)* Role determines which menu items and actions are available

> **Note:** Role-based access is deferred for initial MVP. Currently relies on Google Sheets sharing permissions.

## Development Workflow

### Local Development with clasp
```bash
npm install -g @google/clasp
clasp login
clasp clone <script-id>
clasp push   # deploy changes
```

- Write code locally in preferred editor
- Use Git/GitHub for version control
- TypeScript supported (optional)

### Testing Strategy
- Extract pure business logic into functions without Google API calls
- Unit test pure logic locally with Jest
- Integration test manually against a dev copy of the spreadsheet

### Deployment
- Volunteers don't install anything
- Script is bound to spreadsheet—menus/sidebar just appear
- First use triggers one-time Google authorization prompt
- "Unverified app" warning on free Google accounts (volunteers click through once)

## Future Considerations

### Google Workspace (Deferred)
- Organization likely qualifies for Google for Nonprofits (free Workspace)
- Benefits: Shared Drives (files belong to org, not individuals), no scary auth warning, better admin control
- Deferred until after MVP delivers value and builds trust
- Current "one account owns everything" setup works for MVP

## Entities to Manage

### MVP (Implemented)
- **Borrowers** - Library members (id, name, email, phone, status, joinDate, notes)
- **Media** - Books, DVDs, etc. (id, title, author, type, isbn, status, notes)
- **Loans** - Checkout records (id, borrowerId, barcode, checkout, due, returnDate, status)

### Future
- Classes
- Teachers
- Volunteers
- Payments

## Example: Loan Checkout Flow
1. Volunteer opens Loans sheet
2. Sidebar shows "New Loan" button
3. Dialog opens with:
   - Member search with autocomplete
   - Book search with autocomplete
4. On submit, script validates:
   - Book is not currently on loan
   - Member is in good standing
5. If valid, loan is written to master sheet
6. Volunteer sheet view updates automatically

## Open Questions
- ~~Which entities are essential for MVP vs. nice-to-have?~~ → Borrowers, Media, Loans for MVP
- What are the current pain points with loan tracking?
- ~~Specific fields needed for each entity?~~ → Defined above in Entities section
