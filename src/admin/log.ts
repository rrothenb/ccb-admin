/**
 * Admin-sync audit logging.
 *
 * Wraps the shared audit-log service so every admin-sync action is:
 *  - attributed to the active user,
 *  - tagged "[Admin Sync]" so it's distinguishable from the main library app's
 *    entries in the shared audit-log spreadsheet,
 *  - fail-safe — a logging error never breaks the operation (important for the
 *    landing-page hook, which must not stop the page from rendering).
 */

import { writeAuditLog } from '../services/audit-log';

export function logAdmin(action: string): void {
  try {
    const user = Session.getActiveUser().getEmail() || '(unknown)';
    writeAuditLog(user, `[Admin Sync] ${action}`);
  } catch (e) {
    Logger.log(`Admin audit log failed: ${e}`);
  }
}
