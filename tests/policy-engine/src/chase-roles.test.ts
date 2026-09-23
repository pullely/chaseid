import { authorize } from "@saas/policy-engine";
import type { AuthorizationRequest, MembershipFact } from "@saas/contracts/policy";
import type { TenancyRole } from "@saas/contracts/tenancy";

// chaseid CH3 — what the firm's existing roles mean on the chase surface.
// Reviewer-style access is the baseline's `viewer` role: it opens the board,
// the chase log and the at-risk report (chase.read) and cannot import,
// remove, mark verified or chase (chase.write). Unknown or absent membership
// is deny-by-default, which the chase worker answers as 404.

function request(action: string, role: string | null, orgId = "org_1"): AuthorizationRequest {
  const memberships: MembershipFact[] = role
    ? [{ kind: "role_assignment", role: role as TenancyRole, scope: { kind: "organization", orgId: "org_1" } }]
    : [];
  return {
    subject: { type: "user", id: "usr_1" },
    action,
    resource: { kind: "organization", orgId },
    context: { memberships },
  };
}

const MATRIX: Array<[role: string, read: boolean, write: boolean]> = [
  ["owner", true, true],
  ["admin", true, true],
  ["builder", true, true],
  ["viewer", true, false],
  ["billing_admin", false, false],
];

describe("chase.* on the firm's roles", () => {
  it.each(MATRIX)("%s — read %s, write %s", (role, read, write) => {
    expect(authorize(request("chase.read", role)).allow).toBe(read);
    expect(authorize(request("chase.write", role)).allow).toBe(write);
  });

  it("denies a non-member and a member of another firm", () => {
    expect(authorize(request("chase.read", null)).allow).toBe(false);
    expect(authorize(request("chase.read", "owner", "org_2")).allow).toBe(false);
  });
});
