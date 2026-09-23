import type { ChaseVerificationState } from "@saas/contracts/chase";
import { normaliseName } from "@saas/db/chase";

/**
 * The person (CL1, design §2.1): a human on one company, however many roles
 * Companies House lists them under.
 *
 * Officer and PSC records are separate rows — each role carries its own
 * verification state and its own chase step, and a gap on either blocks the
 * filing — but a firm counts, reads and emails humans. Rows whose names
 * normalise to the same key are one person. The key is the sorted token set
 * the CSV contact match already uses, so "OKONKWO, Adaeze Ngozi" (the officer
 * record) and "Adaeze Ngozi Okonkwo" (the PSC record) agree by construction.
 * It merges only on an identical token set: a spelling that differs shows a
 * human twice, never two humans as one (risks CL-A).
 */

/** PSC names carry a title; officer names do not. */
const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "sir", "dame", "lord", "lady"]);

export function personKey(name: string): string {
  return normaliseName(name)
    .split(" ")
    .filter((token) => token.length > 0 && !HONORIFICS.has(token))
    .join(" ");
}

export interface PersonRow {
  companyId: string;
  name: string;
  kind: "officer" | "psc";
  verificationState: ChaseVerificationState;
}

export interface PersonGroup<T extends PersonRow> {
  companyId: string;
  key: string;
  rows: T[];
}

/** Group rows into persons per company, in first-seen order. */
export function groupPeople<T extends PersonRow>(rows: readonly T[]): PersonGroup<T>[] {
  const groups = new Map<string, PersonGroup<T>>();
  for (const row of rows) {
    const key = personKey(row.name);
    const id = `${row.companyId}\u0000${key}`;
    const group = groups.get(id) ?? { companyId: row.companyId, key, rows: [] };
    group.rows.push(row);
    groups.set(id, group);
  }
  return [...groups.values()];
}

/** A person's state is the WORST of their roles: an unverified role is a gap
 *  the filing trips on even when another role is verified. `unknown` is never
 *  promoted to `unverified` — nobody has said it is. */
export function personState(rows: readonly Pick<PersonRow, "verificationState">[]): ChaseVerificationState {
  if (rows.some((row) => row.verificationState === "unverified")) return "unverified";
  if (rows.some((row) => row.verificationState === "unknown")) return "unknown";
  return "verified";
}

/** "Forename Surname": the PSC record's spelling when there is one (it is
 *  written that way), else the officer's "SURNAME, Forename" turned round. */
export function displayName(rows: readonly Pick<PersonRow, "name" | "kind">[]): string {
  const psc = rows.find((row) => row.kind === "psc");
  if (psc) return psc.name;
  const name = rows[0]?.name ?? "";
  const comma = name.indexOf(",");
  if (comma < 0) return name;
  const surname = name.slice(0, comma).trim();
  const forenames = name.slice(comma + 1).trim();
  const titled = surname.charAt(0) + surname.slice(1).toLowerCase();
  return forenames ? `${forenames} ${titled}` : titled;
}

export interface PersonCounts {
  peopleCount: number;
  unverifiedCount: number;
  unknownCount: number;
}

export function countPeople(rows: readonly PersonRow[]): PersonCounts {
  const counts: PersonCounts = { peopleCount: 0, unverifiedCount: 0, unknownCount: 0 };
  for (const group of groupPeople(rows)) {
    counts.peopleCount += 1;
    const state = personState(group.rows);
    if (state === "unverified") counts.unverifiedCount += 1;
    else if (state === "unknown") counts.unknownCount += 1;
  }
  return counts;
}

/** FNV-1a, 32 bits, as eight hex digits. Not a secret — a short, stable,
 *  separator-free token for an idempotency key segment. */
export function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The human a chase is addressed to: one person on one company at one
 *  address. Two roles of the same person with the same address share it, so
 *  the notifications idempotency key collapses them to one email per step;
 *  two addresses are two recipients, because the firm said so. */
export function recipientToken(name: string, email: string): string {
  return fnv1a32(`${personKey(name)}|${email.trim().toLowerCase()}`);
}
