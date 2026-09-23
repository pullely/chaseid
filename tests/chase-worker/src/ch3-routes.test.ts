import type { DatabaseSync } from "node:sqlite";
import { authorize } from "@saas/policy-engine";
import type { AuthorizationRequest, MembershipFact } from "@saas/contracts/policy";
import type { TenancyRole } from "@saas/contracts/tenancy";
import type { ChaseAtRiskReportResponse, ImportChaseCompaniesResponse } from "@saas/contracts/chase";
import { route } from "@chase-worker/router";
import type { Env } from "@chase-worker/env";
import { orgPublicId } from "@chase-worker/ids";
import { d1Over, migratedDatabase } from "./sqlite-harness";

// CH3's "done when", through the worker's own router: real SQLite behind
// PLATFORM_DB, the real policy engine behind a fake POLICY_WORKER, a fake
// membership worker that says which role the caller holds, and a fake
// billing worker that answers the plan's company allowance.

const ORG = "6b2e1d0c-3a4f-4b5e-9c8d-7e6f5a4b3c2d";
const ORG_PUBLIC = orgPublicId(ORG);

function fetcher(handler: (body: unknown) => unknown): Fetcher {
  return {
    fetch: async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      return Response.json({ data: handler(body) });
    },
  } as unknown as Fetcher;
}

function envFor(db: DatabaseSync, role: TenancyRole, limit: number | null = null): Env {
  const memberships: MembershipFact[] = [
    { kind: "role_assignment", role, scope: { kind: "organization", orgId: ORG } },
  ];
  return {
    ENVIRONMENT: "test",
    PLATFORM_DB: d1Over(db) as unknown as D1Database,
    MEMBERSHIP_WORKER: fetcher(() => ({ memberships })),
    POLICY_WORKER: fetcher((body) => authorize(body as AuthorizationRequest)),
    BILLING_WORKER: fetcher((body) => ({
      allowed: true,
      orgId: (body as { orgId: string }).orgId,
      entitlementKey: "limit.chase_companies",
      valueType: "quantity",
      limitValue: limit,
      source: "plan",
      subscriptionId: null,
    })),
  };
}

function req(method: string, path: string, init: { body?: string; type?: string; accept?: string } = {}): Request {
  const headers = new Headers({ "x-actor-subject-id": "usr_1", "x-actor-subject-type": "user" });
  if (init.type) headers.set("content-type", init.type);
  if (init.accept) headers.set("accept", init.accept);
  return new Request(`https://chase.internal${path}`, { method, headers, ...(init.body ? { body: init.body } : {}) });
}

const IMPORT_CSV = [
  "company_number,person_name,person_email",
  "00000001,Adaeze Ngozi Okonkwo,adaeze@example.com",
  "00000002,,",
  "SC000003,Fiona Macarthur,fiona@example.com",
].join("\n");

async function importAs(db: DatabaseSync, role: TenancyRole, limit: number | null = null): Promise<Response> {
  return route(
    req("POST", `/v1/organizations/${ORG_PUBLIC}/chase/companies/import`, { body: IMPORT_CSV, type: "text/csv" }),
    envFor(db, role, limit),
  );
}

const count = (db: DatabaseSync, sql: string): number => Number((db.prepare(sql).get() as { n: number }).n);

describe("CH3 through the router, on real SQLite", () => {
  it("a viewer gets 404 from import and 200 from the report", async () => {
    const db = migratedDatabase();
    expect((await importAs(db, "viewer")).status).toBe(404);
    expect(count(db, "SELECT count(*) AS n FROM chase_companies")).toBe(0);

    expect((await importAs(db, "builder")).status).toBe(200);
    const report = await route(req("GET", `/v1/organizations/${ORG_PUBLIC}/chase/report/at-risk`), envFor(db, "viewer"));
    expect(report.status).toBe(200);
  });

  it("the CSV rendering is an attachment whose rows match the JSON rendering", async () => {
    const db = migratedDatabase();
    expect((await importAs(db, "owner")).status).toBe(200);

    const json = await route(req("GET", `/v1/organizations/${ORG_PUBLIC}/chase/report/at-risk`), envFor(db, "viewer"));
    const report = ((await json.json()) as { data: ChaseAtRiskReportResponse }).data;
    expect(report.companies.length).toBeGreaterThan(0);
    // PENNINE (00000002) files in 120 days: never on this month's report.
    expect(report.companies.map((c) => c.companyNumber)).not.toContain("00000002");

    const csv = await route(
      req("GET", `/v1/organizations/${ORG_PUBLIC}/chase/report/at-risk?format=csv`),
      envFor(db, "viewer"),
    );
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(csv.headers.get("content-disposition")).toMatch(/^attachment; filename="chaseid-at-risk-\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = (await csv.text()).trim().split("\r\n");
    expect(lines[0]).toBe("company_number,company_name,next_statement_due,days_until_due,unverified_count,unverified_names");
    expect(lines.slice(1).map((line) => line.split(",")[0])).toEqual(report.companies.map((c) => c.companyNumber));

    // Accept: text/csv selects the same rendering.
    const byAccept = await route(
      req("GET", `/v1/organizations/${ORG_PUBLIC}/chase/report/at-risk`, { accept: "text/csv" }),
      envFor(db, "viewer"),
    );
    expect(byAccept.headers.get("content-type")).toMatch(/^text\/csv/);

    // Exporting is audited; reading on screen is not.
    expect(count(db, "SELECT count(*) AS n FROM events_audit_entries WHERE event_type = 'chase.report.exported'")).toBe(2);
  });

  it("refuses an import past the plan's allowance before writing any row", async () => {
    const db = migratedDatabase();
    const refused = await importAs(db, "owner", 2);
    expect(refused.status).toBe(412);
    const body = (await refused.json()) as { error: { code: string; details: Record<string, unknown> } };
    expect(body.error.code).toBe("precondition_failed");
    expect(body.error.details.reason).toBe("limit_reached");
    expect(count(db, "SELECT count(*) AS n FROM chase_companies")).toBe(0);
    expect(count(db, "SELECT count(*) AS n FROM chase_sync_runs")).toBe(0);

    // At the allowance exactly, it goes through; re-importing costs nothing.
    expect((await importAs(db, "owner", 3)).status).toBe(200);
    expect((await importAs(db, "owner", 3)).status).toBe(200);
  });

  it("records companies_under_management on the baseline's metering context, once a day", async () => {
    const db = migratedDatabase();
    const res = await importAs(db, "owner");
    const data = ((await res.json()) as { data: ImportChaseCompaniesResponse }).data;
    expect(data.imported).toBe(3);
    const reading = db
      .prepare("SELECT quantity FROM metering_usage_records WHERE metric = 'companies_under_management'")
      .all() as Array<{ quantity: number }>;
    expect(reading.map((r) => Number(r.quantity))).toEqual([3]);

    await importAs(db, "owner");
    expect(count(db, "SELECT count(*) AS n FROM metering_usage_records WHERE metric = 'companies_under_management'")).toBe(1);
  });

  it("audits every import on the audit surface", async () => {
    const db = migratedDatabase();
    await importAs(db, "owner");
    expect(count(db, "SELECT count(*) AS n FROM events_audit_entries WHERE event_type = 'chase.company.imported'")).toBe(3);
  });
});
