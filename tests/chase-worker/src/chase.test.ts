import type { ChaseMessage, ChasePersonWithCompany, ChaseRepository, RecordChaseMessageInput } from "@saas/db/chase";
import type { EnqueueNotificationRequest } from "@saas/contracts/notifications";
import {
  chaseOne,
  decideChase,
  sweepChases,
  templateForStep,
  windowCutoff,
  type ChaseDeps,
} from "@chase-worker/chase";
import { recipientToken } from "@chase-worker/people";

const DAY = 24 * 60 * 60 * 1000;
const MONDAY = new Date("2026-09-21T09:00:00.000Z");

function person(overrides: Partial<ChasePersonWithCompany> = {}): ChasePersonWithCompany {
  return {
    id: "0f0e0d0c-0b0a-4908-8706-050403020100",
    orgId: "org-uuid",
    companyId: "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9",
    providerPersonKey: "officer-1",
    kind: "officer",
    name: "Jane Director",
    role: "director",
    appointedOn: "2019-01-01",
    resignedOn: null,
    verificationState: "unverified",
    verificationSource: "companies_house",
    verifiedOn: null,
    contactEmail: "Jane@Example.com",
    chaseStep: 0,
    lastChasedAt: null,
    createdAt: MONDAY.toISOString(),
    updatedAt: MONDAY.toISOString(),
    companyNumber: "00000001",
    companyName: "HARBOURSIDE ACCOUNTING LIMITED",
    // 14 days out: inside the 30-day window.
    nextStatementDue: "2026-10-05",
    ...overrides,
  };
}

/**
 * An in-memory register one person deep, driven day by day. The person row
 * is mutated by `advanceChaseStep` exactly as D1 would, so a sweep reads what
 * the previous sweep wrote.
 */
function world(initial: ChasePersonWithCompany, enqueueOk = true) {
  const row = { ...initial };
  const messages: ChaseMessage[] = [];
  const enqueued: EnqueueNotificationRequest[] = [];
  let clock = MONDAY;

  const repo = {
    recordChaseMessage: async (input: RecordChaseMessageInput) => {
      const message: ChaseMessage = {
        id: input.id,
        orgId: input.orgId,
        personId: input.personId,
        companyId: input.companyId,
        step: input.step,
        channel: "email",
        toAddress: input.toAddress,
        templateKey: input.templateKey,
        notificationId: input.notificationId,
        enqueueResult: input.enqueueResult,
        sentAt: clock.toISOString(),
      };
      messages.push(message);
      return { ok: true as const, value: message };
    },
    advanceChaseStep: async (_id: string, step: number, chasedAt: string) => {
      row.chaseStep = step;
      row.lastChasedAt = chasedAt;
      return { ok: true as const, value: undefined };
    },
  } as unknown as ChaseRepository;

  const deps: ChaseDeps = {
    repo,
    transact: (fn) => fn(repo, null),
    enqueue: async (request) => {
      enqueued.push(request);
      return enqueueOk
        ? { ok: true as const, notificationId: `ntf_${enqueued.length}` }
        : { ok: false as const, reason: "no_binding" as const };
    },
    now: () => clock,
  };

  return {
    deps,
    row,
    messages,
    enqueued,
    advance(days: number) {
      clock = new Date(clock.getTime() + days * DAY);
    },
    sweep() {
      return sweepChases(deps, [{ ...row }], "req_test");
    },
  };
}

describe("decideChase", () => {
  it("sends step 1 to an unverified person whose company files inside the window", () => {
    expect(decideChase(person(), MONDAY)).toEqual({ send: true, step: 1, templateKey: "chase.first_notice" });
  });

  it("does not chase a filing outside the 30-day window", () => {
    expect(decideChase(person({ nextStatementDue: "2026-12-01" }), MONDAY)).toEqual({
      send: false,
      reason: "outside_window",
    });
  });

  it("does not chase a company with no known filing date", () => {
    expect(decideChase(person({ nextStatementDue: null }), MONDAY)).toEqual({ send: false, reason: "outside_window" });
  });

  it("chases an OVERDUE filing — late is more urgent, not less", () => {
    expect(decideChase(person({ nextStatementDue: "2026-09-01" }), MONDAY).send).toBe(true);
  });

  it("never chases a verified, unknown or resigned person, or one with no address", () => {
    expect(decideChase(person({ verificationState: "verified" }), MONDAY)).toEqual({ send: false, reason: "not_unverified" });
    expect(decideChase(person({ verificationState: "unknown" }), MONDAY)).toEqual({ send: false, reason: "not_unverified" });
    expect(decideChase(person({ resignedOn: "2026-01-01" }), MONDAY)).toEqual({ send: false, reason: "resigned" });
    expect(decideChase(person({ contactEmail: null }), MONDAY)).toEqual({ send: false, reason: "no_contact" });
  });

  it("stops after the escalation", () => {
    expect(decideChase(person({ chaseStep: 3, lastChasedAt: "2026-01-01T00:00:00Z" }), MONDAY)).toEqual({
      send: false,
      reason: "complete",
    });
  });

  it("a manual chase skips the window and the interval but not the facts", () => {
    const fresh = person({ chaseStep: 1, lastChasedAt: MONDAY.toISOString(), nextStatementDue: "2027-06-01" });
    expect(decideChase(fresh, MONDAY, "manual")).toEqual({ send: true, step: 2, templateKey: "chase.reminder" });
    expect(decideChase(person({ verificationState: "verified" }), MONDAY, "manual").send).toBe(false);
  });

  it("maps steps onto the three templates", () => {
    expect([1, 2, 3].map(templateForStep)).toEqual(["chase.first_notice", "chase.reminder", "chase.escalation"]);
  });
});

describe("the chase, day by day", () => {
  it("moves 0 → 1 with one message, and a second sweep the same day writes none", async () => {
    const w = world(person());

    const first = await w.sweep();
    expect(first.sent).toBe(1);
    expect(w.row.chaseStep).toBe(1);
    expect(w.messages).toHaveLength(1);
    expect(w.messages[0]!.templateKey).toBe("chase.first_notice");

    const second = await w.sweep();
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(1);
    expect(w.messages).toHaveLength(1);
  });

  it("escalates to step 2 after the interval rather than re-sending step 1, then to step 3, then stops", async () => {
    const w = world(person({ nextStatementDue: "2026-10-15" }));
    await w.sweep();
    expect(w.row.chaseStep).toBe(1);

    w.advance(6);
    await w.sweep();
    expect(w.row.chaseStep).toBe(1); // six days is not seven

    w.advance(1);
    await w.sweep();
    expect(w.row.chaseStep).toBe(2);
    expect(w.messages.map((m) => m.step)).toEqual([1, 2]);

    w.advance(7);
    await w.sweep();
    expect(w.row.chaseStep).toBe(3);

    w.advance(7);
    await w.sweep();
    expect(w.messages.map((m) => m.templateKey)).toEqual([
      "chase.first_notice",
      "chase.reminder",
      "chase.escalation",
    ]);
  });

  it("keys every send chase:<cmp>:<recipient>:<step>, lower-cases the address and carries no token", async () => {
    const w = world(person());
    await w.sweep();
    const sent = w.enqueued[0]!;
    expect(sent.idempotencyKey).toBe(
      `chase:cmp_1a2b3c4d5e6f40718293a4b5c6d7e8f9:${recipientToken("Jane Director", "jane@example.com")}:1`,
    );
    expect(sent.recipient.address).toBe("jane@example.com");
    expect(sent.category).toBe("product");
    expect(Object.keys(sent.templateData ?? {}).sort()).toEqual(
      ["companyName", "companyNumber", "daysUntilDue", "nextStatementDue", "personName", "step"].sort(),
    );
  });

  it("records a failed enqueue on the AML file without moving the clock", async () => {
    const w = world(person(), false);
    const result = await chaseOne(w.deps, person(), { subjectType: "user", subjectId: "usr_1" }, "req_1", "sweep");
    expect(result.message?.enqueueResult).toBe("no_binding");
    expect(w.row.chaseStep).toBe(0);
  });
});

describe("windowCutoff", () => {
  it("is the ISO date thirty days from today", () => {
    expect(windowCutoff(MONDAY)).toBe("2026-10-21");
  });
});
