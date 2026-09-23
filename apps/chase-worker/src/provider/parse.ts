import {
  mapVerification,
  normaliseCompanyStatus,
  type ProviderCompany,
  type ProviderPerson,
} from "./types.js";

/**
 * The wire-shape readers, shared by both implementations on purpose: the
 * fixture provider and the HTTP provider must agree about what a Companies
 * House payload MEANS, or the fixtures stop being evidence about the live
 * API. One parser, two transports.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseCompanyProfile(companyNumber: string, payload: unknown): ProviderCompany {
  const record = asRecord(payload) ?? {};
  const statement = asRecord(record.confirmation_statement);
  return {
    companyNumber: asString(record.company_number) ?? companyNumber,
    companyName: asString(record.company_name) ?? "",
    companyStatus: normaliseCompanyStatus(record.company_status),
    nextStatementDue: statement ? asString(statement.next_due) : null,
  };
}

/** An officer's stable key is the appointments link Companies House gives
 *  under `links.officer.appointments`; it survives a name change and a
 *  re-appointment, which is exactly what an upsert needs. Without one, fall
 *  back to the role and appointment date rather than the name alone. */
function officerKey(item: Record<string, unknown>, index: number): string {
  const links = asRecord(item.links);
  const officer = links ? asRecord(links.officer) : null;
  const appointments = officer ? asString(officer.appointments) : null;
  if (appointments) return appointments;
  const role = asString(item.officer_role) ?? "unknown";
  const appointed = asString(item.appointed_on) ?? "";
  return `officer:${role}:${appointed}:${index}`;
}

export function parseOfficers(payload: unknown): ProviderPerson[] {
  const record = asRecord(payload);
  const items = record && Array.isArray(record.items) ? record.items : [];
  return items.map((raw, index) => {
    const item = asRecord(raw) ?? {};
    const verification = mapVerification(item.identity_verification_details);
    return {
      providerPersonKey: officerKey(item, index),
      kind: "officer" as const,
      name: asString(item.name) ?? "",
      role: asString(item.officer_role) ?? "unknown",
      appointedOn: asString(item.appointed_on),
      resignedOn: asString(item.resigned_on),
      verificationState: verification.state,
      verifiedOn: verification.verifiedOn,
    };
  });
}

export function parsePscs(payload: unknown): ProviderPerson[] {
  const record = asRecord(payload);
  const items = record && Array.isArray(record.items) ? record.items : [];
  return items.map((raw, index) => {
    const item = asRecord(raw) ?? {};
    const links = asRecord(item.links);
    const self = links ? asString(links.self) : null;
    const verification = mapVerification(item.identity_verification_details);
    return {
      providerPersonKey: self ?? `psc:${asString(item.notified_on) ?? ""}:${index}`,
      kind: "psc" as const,
      name: asString(item.name) ?? "",
      role: "psc",
      appointedOn: asString(item.notified_on),
      resignedOn: asString(item.ceased_on),
      verificationState: verification.state,
      verifiedOn: verification.verifiedOn,
    };
  });
}
