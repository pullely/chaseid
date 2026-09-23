import type { ChaseCompany, ChaseMessage, ChasePerson, ChasePersonWithCompany, ChaseSyncRun } from "@saas/db/chase";
import type {
  PublicChaseCompany,
  PublicChaseDirector,
  PublicChaseMessage,
  PublicChaseSyncRun,
} from "@saas/contracts/chase";
import { chaseMessagePublicId, companyPublicId, personPublicId, syncRunPublicId } from "./ids.js";
import { daysUntilDue, deriveRisk } from "./risk.js";

export function presentCompany(
  company: ChaseCompany,
  people: ChasePerson[],
  now: Date,
): PublicChaseCompany {
  const live = people.filter((person) => person.resignedOn === null);
  const unverified = live.filter((person) => person.verificationState !== "verified").length;
  const days = daysUntilDue(company.nextStatementDue, now);
  return {
    id: companyPublicId(company.id),
    companyNumber: company.companyNumber,
    companyName: company.companyName,
    companyStatus: company.companyStatus,
    nextStatementDue: company.nextStatementDue,
    daysUntilDue: days,
    risk: deriveRisk(days, unverified),
    lastSyncedAt: company.lastSyncedAt,
    lastSyncState: company.lastSyncState,
    lastSyncError: company.lastSyncError,
    peopleCount: live.length,
    unverifiedCount: unverified,
    createdAt: company.createdAt,
  };
}

export function presentDirector(person: ChasePersonWithCompany, now: Date): PublicChaseDirector {
  const days = daysUntilDue(person.nextStatementDue, now);
  return {
    id: personPublicId(person.id),
    companyId: companyPublicId(person.companyId),
    companyNumber: person.companyNumber,
    companyName: person.companyName,
    name: person.name,
    kind: person.kind,
    role: person.role,
    appointedOn: person.appointedOn,
    verificationState: person.verificationState,
    verifiedOn: person.verifiedOn,
    contactEmail: person.contactEmail,
    chaseStep: person.chaseStep,
    lastChasedAt: person.lastChasedAt,
    nextStatementDue: person.nextStatementDue,
    daysUntilDue: days,
    // A person's own risk is their company's: one unverified person makes the
    // whole filing at risk, which is the fact the product exists to surface.
    risk: deriveRisk(days, person.verificationState === "verified" ? 0 : 1),
  };
}

export function presentSyncRun(run: ChaseSyncRun): PublicChaseSyncRun {
  return {
    id: syncRunPublicId(run.id),
    trigger: run.trigger,
    provider: run.provider,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    companiesScanned: run.companiesScanned,
    peopleUpserted: run.peopleUpserted,
    errors: run.errors,
  };
}

export function presentMessage(message: ChaseMessage): PublicChaseMessage {
  return {
    id: chaseMessagePublicId(message.id),
    personId: personPublicId(message.personId),
    companyId: companyPublicId(message.companyId),
    step: message.step,
    channel: message.channel,
    toAddress: message.toAddress,
    templateKey: message.templateKey,
    notificationId: message.notificationId,
    enqueueResult: message.enqueueResult,
    sentAt: message.sentAt,
  };
}
