# Library System MVP - Decision Summary

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

### Two-Spreadsheet Model

| Master Sheet (Admin Only) | Volunteer Sheet (Shared) |
|---------------------------|--------------------------|
| Full historical data | Current/active records via `IMPORTRANGE` |
| All tabs | Only operational tabs |
| Raw data, config, audit logs | Clean, simplified views |
| Source of truth | Read-only views + script-mediated writes |

- Volunteers don't need access to master sheet
- `IMPORTRANGE` authorized once by admin, then data flows through
- Apps Script writes back to master sheet on their behalf

### User Interface

- **Context-aware sidebar:** Detects active sheet, shows relevant actions for that sheet (e.g., Loans sheet shows loan operations)
- **Custom HTML dialogs:** Full control over UX, including autocomplete for member/book lookup and validation before writes
- **Custom menu:** Appears automatically when spreadsheet opens

### Authentication & Roles

- Leverage Google's built-in sharing (specific accounts only, not "anyone with link")
- Volunteers tab in master sheet defines roles (Admin, Desk Volunteer, Read Only)
- Script checks `Session.getActiveUser().getEmail()` against roles
- Role determines which menu items and actions are available

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
- Members/Borrowers
- Books/Media
- Loans
- Classes
- Teachers
- Volunteers
- Payments

*(Specific workflows and priorities TBD)*

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
- Which entities are essential for MVP vs. nice-to-have?
- What are the current pain points with loan tracking?
- Specific fields needed for each entity?
