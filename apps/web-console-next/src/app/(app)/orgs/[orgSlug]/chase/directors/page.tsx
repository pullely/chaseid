"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Mail, Send, ShieldAlert } from "lucide-react";
import { OrgScope } from "@/components/shell/org-scope";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";
import {
  RISK_LABEL,
  RISK_VARIANT,
  STATE_LABEL,
  STATE_VARIANT,
  STEP_LABEL,
  formatDaysUntilDue,
} from "@/components/chase/chase";
import type { ChaseRisk, ChaseVerificationState, PublicChaseDirector } from "@saas/contracts/chase";

type StateFilter = ChaseVerificationState | "all";
type RiskFilter = ChaseRisk | "all";

export default function DirectorsPage() {
  const params = useParams<{ orgSlug: string }>();
  const slug = params?.orgSlug ?? "";
  return <OrgScope slug={slug}>{(org) => <Inner orgId={org.id} />}</OrgScope>;
}

/**
 * The status board: every director and PSC across the firm's book, soonest
 * filing first, filtered by verification state and derived risk. Marking a
 * person verified and setting an address are optimistic against the query
 * cache with rollback; "Chase now" sends the next step through the same
 * state machine the morning cron runs.
 */
function Inner({ orgId }: { orgId: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [state, setState] = React.useState<StateFilter>("unverified");
  const [risk, setRisk] = React.useState<RiskFilter>("all");
  const [editing, setEditing] = React.useState<PublicChaseDirector | null>(null);
  const [email, setEmail] = React.useState("");

  const filters = `${state}:${risk}`;
  const key = qk.chaseDirectors(orgId, filters);
  const board = useApiQuery(key, () =>
    wrap(async () =>
      (
        await client.chase.listDirectors(orgId, {
          ...(state !== "all" ? { state } : {}),
          ...(risk !== "all" ? { risk } : {}),
          limit: 200,
        })
      ).directors,
    ),
  );
  const rows = board.data ?? [];

  const patchRow = (id: string, patch: Partial<PublicChaseDirector>) => {
    const previous = qc.getQueryData<PublicChaseDirector[]>(key);
    qc.setQueryData<PublicChaseDirector[]>(key, (cur) =>
      (cur ?? []).map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
    return () => qc.setQueryData<PublicChaseDirector[]>(key, previous);
  };

  const markVerified = async (row: PublicChaseDirector) => {
    const rollback = patchRow(row.id, { verificationState: "verified", risk: row.risk === "at_risk" ? "due_soon" : row.risk });
    const r = await wrap(() => client.chase.updateDirector(orgId, row.id, { verificationState: "verified" }));
    if (!r.ok) {
      rollback();
      toast({ kind: "error", title: "Could not mark verified", description: r.error.message });
      return;
    }
    toast({ kind: "success", title: `${row.name} marked verified` });
    void qc.invalidateQueries({ queryKey: ["chaseDirectors", orgId] });
  };

  const saveEmail = async () => {
    if (!editing) return;
    const row = editing;
    const next = email.trim() || null;
    setEditing(null);
    const rollback = patchRow(row.id, { contactEmail: next });
    const r = await wrap(() => client.chase.updateDirector(orgId, row.id, { contactEmail: next }));
    if (!r.ok) {
      rollback();
      toast({ kind: "error", title: "Could not save the address", description: r.error.message });
      return;
    }
    toast({ kind: "success", title: next ? `Address saved for ${row.name}` : `Address cleared for ${row.name}` });
  };

  const chaseNow = async (row: PublicChaseDirector) => {
    const r = await wrap(() => client.chase.chaseDirector(orgId, row.id));
    if (!r.ok) {
      toast({ kind: "error", title: "Chase failed", description: r.error.message });
      return;
    }
    if (r.data.skippedReason) {
      toast({ kind: "warning", title: "Nothing sent", description: skipCopy(r.data.skippedReason) });
      return;
    }
    toast({ kind: "success", title: `${STEP_LABEL[r.data.step] ?? `Step ${r.data.step}`} sent to ${row.name}` });
    void qc.invalidateQueries({ queryKey: ["chaseDirectors", orgId] });
    void qc.invalidateQueries({ queryKey: qk.chaseMessages(orgId) });
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Status board</h1>
          <p className="text-sm text-muted-foreground">
            Every director and PSC on your book, soonest confirmation statement first.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={state} onValueChange={(v) => setState(v as StateFilter)}>
            <SelectTrigger className="w-40" aria-label="Verification state"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              <SelectItem value="unverified">Unverified</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>
          <Select value={risk} onValueChange={(v) => setRisk(v as RiskFilter)}>
            <SelectTrigger className="w-36" aria-label="Risk"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any risk</SelectItem>
              <SelectItem value="at_risk">At risk</SelectItem>
              <SelectItem value="due_soon">Due soon</SelectItem>
              <SelectItem value="ok">OK</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      {board.loading ? (
        <Card>
          <CardHeader className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </CardHeader>
        </Card>
      ) : board.error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">{board.error.code}</CardTitle>
            <CardDescription>{board.error.message}</CardDescription>
          </CardHeader>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title="Nobody matches these filters"
          description="Import client companies on the Companies page; the sync fills this board with their directors and PSCs."
        />
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Statement due</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Chase</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.kind === "psc" ? "PSC" : row.role} · {row.contactEmail ?? "no address"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{row.companyName || row.companyNumber}</div>
                    <div className="text-xs text-muted-foreground">{row.companyNumber}</div>
                  </TableCell>
                  <TableCell>
                    <div>{row.nextStatementDue ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{formatDaysUntilDue(row.daysUntilDue)}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATE_VARIANT[row.verificationState]}>{STATE_LABEL[row.verificationState]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={RISK_VARIANT[row.risk]}>{RISK_LABEL[row.risk]}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{STEP_LABEL[row.chaseStep] ?? `Step ${row.chaseStep}`}</div>
                    {row.lastChasedAt && (
                      <div className="text-muted-foreground">{new Date(row.lastChasedAt).toLocaleDateString()}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Set address for ${row.name}`}
                      onClick={() => {
                        setEmail(row.contactEmail ?? "");
                        setEditing(row);
                      }}
                    >
                      <Mail className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Chase ${row.name} now`}
                      disabled={row.verificationState !== "unverified" || !row.contactEmail || row.chaseStep >= 3}
                      onClick={() => void chaseNow(row)}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Mark ${row.name} verified`}
                      disabled={row.verificationState === "verified"}
                      onClick={() => void markVerified(row)}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contact address</DialogTitle>
            <DialogDescription>
              Companies House publishes no personal addresses. Chases for {editing?.name} go to the address you set here.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void saveEmail();
            }}
          >
            <Input type="email" value={email} placeholder="name@example.com" onChange={(e) => setEmail(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function skipCopy(reason: string): string {
  switch (reason) {
    case "not_unverified":
      return "This person is not unverified.";
    case "resigned":
      return "This person has resigned.";
    case "no_contact":
      return "Set a contact address first.";
    case "complete":
      return "All three steps have been sent.";
    default:
      return reason;
  }
}
