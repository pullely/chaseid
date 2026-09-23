/**
 * chaseid — the client register and its verification chase (CH).
 *
 * Wire shapes only: plain TypeScript, no runtime validation, ids as public-id
 * strings, timestamps and dates as ISO strings — the baseline's contract
 * convention. Validation is hand-rolled in the owning handler.
 */

export type ChaseCompanyStatus = "active" | "dissolved" | "liquidation" | "unknown";
export type ChaseSyncState = "never" | "ok" | "not_found" | "provider_error";
export type ChaseVerificationState = "verified" | "unverified" | "unknown";
export type ChaseProviderKind = "http" | "fixture";

/** Derived on read, never stored — see apps/chase-worker/src/risk.ts. */
export type ChaseRisk = "at_risk" | "due_soon" | "ok";

export interface PublicChaseCompany {
  id: string;
  companyNumber: string;
  companyName: string;
  companyStatus: ChaseCompanyStatus;
  nextStatementDue: string | null;
  daysUntilDue: number | null;
  risk: ChaseRisk;
  lastSyncedAt: string | null;
  lastSyncState: ChaseSyncState;
  lastSyncError: string | null;
  peopleCount: number;
  unverifiedCount: number;
  createdAt: string;
}

export interface PublicChaseDirector {
  id: string;
  companyId: string;
  companyNumber: string;
  companyName: string;
  name: string;
  kind: "officer" | "psc";
  role: string;
  appointedOn: string | null;
  verificationState: ChaseVerificationState;
  verifiedOn: string | null;
  contactEmail: string | null;
  chaseStep: number;
  lastChasedAt: string | null;
  nextStatementDue: string | null;
  daysUntilDue: number | null;
  risk: ChaseRisk;
}

export interface PublicChaseSyncRun {
  id: string;
  trigger: "cron" | "manual" | "import";
  provider: ChaseProviderKind;
  startedAt: string;
  finishedAt: string | null;
  companiesScanned: number;
  peopleUpserted: number;
  errors: number;
}

export interface PublicChaseMessage {
  id: string;
  personId: string;
  companyId: string;
  step: number;
  channel: string;
  toAddress: string;
  templateKey: string;
  notificationId: string | null;
  enqueueResult: string;
  sentAt: string;
}

/** One contact the firm supplies for a person the sync will discover.
 *  Companies House publishes no personal addresses, so this is the only way
 *  a chase ever reaches anybody. */
export interface ChaseImportContact {
  name: string;
  email: string;
}

export interface ChaseImportCompany {
  companyNumber: string;
  contacts?: ChaseImportContact[];
}

export interface ImportChaseCompaniesRequest {
  companies: ChaseImportCompany[];
}

export interface ImportChaseCompaniesResponse {
  imported: number;
  updated: number;
  skipped: number;
  contactsMatched: number;
  syncRunId: string;
  provider: ChaseProviderKind;
}

export interface ListChaseCompaniesResponse {
  companies: PublicChaseCompany[];
}

export interface GetChaseCompanyResponse {
  company: PublicChaseCompany;
  directors: PublicChaseDirector[];
}

export interface ListChaseDirectorsResponse {
  directors: PublicChaseDirector[];
}

export interface UpdateChaseDirectorRequest {
  contactEmail?: string | null;
  verificationState?: ChaseVerificationState;
}

export interface UpdateChaseDirectorResponse {
  director: PublicChaseDirector;
}

export interface SyncChaseCompanyResponse {
  company: PublicChaseCompany;
  syncRunId: string;
  provider: ChaseProviderKind;
}

export interface ListChaseSyncRunsResponse {
  syncRuns: PublicChaseSyncRun[];
}

export interface ListChaseMessagesResponse {
  messages: PublicChaseMessage[];
}

export interface ChaseDirectorChaseResponse {
  message: PublicChaseMessage | null;
  step: number;
  skippedReason: string | null;
}

export interface ChaseAtRiskCompanyRow {
  companyNumber: string;
  companyName: string;
  nextStatementDue: string | null;
  daysUntilDue: number | null;
  unverifiedCount: number;
  unverifiedNames: string[];
}

export interface ChaseAtRiskReportResponse {
  generatedAt: string;
  windowDays: number;
  companies: ChaseAtRiskCompanyRow[];
}

/** The window, in days before the confirmation-statement date, inside which
 *  an unverified person makes the filing "at risk". The brief's own number. */
export const CHASE_RISK_WINDOW_DAYS = 30;

/** Days between chase steps. Step 1 goes out as soon as a company enters the
 *  risk window; 2 and 3 follow on this clock. */
export const CHASE_STEP_INTERVAL_DAYS = 7;

export const CHASE_TEMPLATE_KEYS = [
  "chase.first_notice",
  "chase.reminder",
  "chase.escalation",
] as const;

/** Where a director is told to go. No token, no link back into Chaseid —
 *  the recipient is sent to GOV.UK and nowhere else (risks CH-D). */
export const GOV_UK_VERIFY_URL =
  "https://www.gov.uk/guidance/verifying-your-identity-for-companies-house";
