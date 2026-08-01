/**
 * Detector types — the reconciliation core is a PURE module with no GAS
 * dependencies, so it can be unit-tested exhaustively (matching the project's
 * spike-and-validate ethos). GAS ingestion (Master xlsx, Register grid,
 * Borrowers sheet) normalizes into these shapes, then hands them to
 * `runDetector`; the resulting worklist drives the admin UI.
 *
 * The detector is the actual product: it cross-references the three sources
 * SYNERGISTICALLY (not pairwise) and emits an advisory, tiered worklist. It
 * never mutates anything and never silently merges — every judgement surfaces.
 */

/**
 * Severity tier. Only ONE tier gates anything:
 *   🛑 block   — a downstream tool genuinely CANNOT write until this is fixed;
 *   ⚠️ review  — advisory, ranked first because it's the interesting stuff
 *                (contradictions, uncertain matches) — but it does NOT gate;
 *   ℹ️ fyi     — advisory rollups.
 *
 * The rule for choosing: if the admin must change the data before the Borrowers
 * or Contacts write can proceed, it's `block`. Everything else is advisory —
 * the admin reads it, decides, and the tools still run. There is no "must
 * acknowledge" middle ground: that would be blocking without saying so.
 */
export type Tier = 'block' | 'confirm' | 'fyi';

/** Which engine produced a finding. R=rule, F=fuzzy(Levenshtein/bridge), AI=LLM (deferred). */
export type Engine = 'rule' | 'fuzzy' | 'ai';

/** Stable machine codes for each kind of finding (used for dedup + resolution memory). */
export type FindingCode =
  | 'name-collision'          // same normalized name appears >1x within/across a source
  | 'master-not-in-app'       // Master member with no App record, but creatable (a Register email matched by name)
  | 'master-household-email'  // Master member with no App record; only email is a same-surname household guess — verify
  | 'master-no-email'         // Master member with no App record AND no email anywhere — can't be created
  | 'app-active-not-in-master'// App member still active but absent from current-year Master
  | 'fuzzy-name-match'        // near-name candidate link Master↔App — human must confirm
  | 'spelling-disagreement'   // same person spelled differently across sources — suggests the likely typo
  | 'email-bridge-match'      // linked via Register household email, not by name — confirm
  | 'dropout-contradiction'   // name marked dropout/non-renewal yet also active
  | 'unpaid-but-active'       // active status but payment missing
  | 'nonexistent-class'       // Master CLASS NUMBER not in the canonical roster
  | 'class-disagreement'      // Master CLASS NUMBER != Register class for the same person
  | 'missing-email'           // App member has no email
  | 'malformed-email'         // App email fails a basic shape check
  | 'duplicate-email'         // same email on >1 App member
  | 'shared-new-contact'      // >1 Master member missing from the app resolve to ONE email/phone — can't create both
  | 'new-email-in-app'        // a to-be-created member's only email already belongs to a different app record
  | 'email-drift'             // app email differs from the Contacts email for the same person
  | 'children-aggregated';    // several Master child-rows fold into one App parent record

/** A single detector finding. `key` is a stable identity so resolutions persist year-to-year. */
export interface Finding {
  code: FindingCode;
  tier: Tier;
  engine: Engine;
  /** Human-readable, admin-facing message. */
  message: string;
  /** Names/emails involved — feeds dedup, the key, and the Contacts/expiry targeting later. */
  subjects: string[];
  /** Stable identity: `${code}::${sorted-normalized-subjects}`. Same issue → same key across runs. */
  key: string;
  /** Optional pointer back at the source row/tab, so the admin can go fix it. */
  location?: string;
}

/** A row from the Master Membership file (enrolment/finance ledger — owns membership + class). */
export interface MasterRow {
  /** Exact NAME string as it appears in the Master ("SURNAME, First"), preserved for stable re-matching. */
  rawName: string;
  /** DATE ENROLED as an ISO 'yyyy-MM-dd' string, or '' if blank/unusable (year < 2000). */
  enrolDate: string;
  /** CLASS NUMBER as-is: may be '', '8a', '11&12'. */
  classNumber: string;
  /** DAY / TIME cell as-is (e.g. "Monday 10h00-12h00"); '' if absent. Feeds the website schedule. */
  dayTime: string;
  /** STATUS column (e.g. 'active', 'dropout', 'non-renewal'), lowercased by the ingester. */
  status: string;
  /** RENEWAL / NEW marker, lowercased; '' if absent. */
  renewalType: string;
  /** True/false if the ingester could read payment; undefined if the file has no usable payment cell. */
  paid?: boolean;
  /** 1-based row number in the chosen Master tab, for pointing the admin at the row. */
  rowNumber: number;
}

/** A parsed Register entry (per-teacher attendance grid — downstream; source of class + household contact). */
export interface RegisterRow {
  rawName: string;
  email: string;
  /** A phone from the contact cell when it holds a number instead of an email ('' if none). */
  phone?: string;
  /** Class id from the "Class N / Teacher" header the row sits under. */
  classId: string;
  teacher: string;
  level: string;
}

/**
 * A read-only entry from the master account's Gmail Contacts. Every contact is
 * (or was) a member, so contacts corroborate email + name and can supply an email
 * for a member the app lacks. The detector only READS these — the projection
 * spoke is the only thing that ever writes Contacts.
 */
export interface ContactRecord {
  rawName: string;
  email: string;
  /** A phone number the contact carries ('' if none) — some members are phone-only. */
  phone?: string;
}

/** The subset of an app Borrower the detector needs (App owns contact info + is truth for email). */
export interface AppMember {
  id: string;
  rawName: string;
  email: string;
  /** Phone as stored in the app ('' if none) — a member may be phone-only. */
  phone?: string;
  /** Current expiry as stored in the app ('' if none). */
  expiryDate: string;
}

/** Canonical class roster — the ratified set of valid class ids (feeds nonexistent-class). */
export interface ClassRoster {
  validClassIds: string[];
}

/** Everything the detector reconciles in one sync. */
export interface DetectorInput {
  master: MasterRow[];
  register: RegisterRow[];
  app: AppMember[];
  roster: ClassRoster;
  /** The master account's Gmail Contacts (read-only corroborating source). Optional — defaults to none. */
  contacts?: ContactRecord[];
}

/** The detector's output: the worklist, plus roll-ups for the UI. */
export interface DetectorReport {
  findings: Finding[];
  /** True when no 🛑 block-tier findings remain unresolved — the clean-sync gate. */
  canSync: boolean;
  counts: Record<Tier, number>;
}
