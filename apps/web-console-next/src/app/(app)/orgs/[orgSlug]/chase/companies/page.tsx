"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, RefreshCw, Trash2, Upload } from "lucide-react";
import { OrgScope } from "@/components/shell/org-scope";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { PreconditionInsight } from "@/components/precondition/insight";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap, type ApiErrorBody } from "@/lib/api";
import { formatDaysUntilDue, formatPeopleCounts, parseRegisterCsv, riskBadge } from "@/components/chase/chase";
import type { PublicChaseCompany } from "@saas/contracts/chase";

export default function CompaniesPage() {
  const params = useParams<{ orgSlug: string }>();
  const slug = params?.orgSlug ?? "";
  return <OrgScope slug={slug}>{(org) => <Inner orgId={org.id} />}</OrgScope>;
}

/**
 * The client register: each company's sync state and next statement date,
 * a CSV import (drag-and-drop or paste), a per-company re-sync and removal.
 * The CSV is parsed in the browser into the import route's JSON form.
 */
function Inner({ orgId }: { orgId: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = qk.chaseCompanies(orgId);
  const companies = useApiQuery(key, () =>
    wrap(async () => (await client.chase.listCompanies(orgId, { limit: 200 })).companies),
  );
  const runs = useApiQuery(qk.chaseSyncRuns(orgId), () =>
    wrap(async () => (await client.chase.listSyncRuns(orgId)).syncRuns),
  );
  const [importOpen, setImportOpen] = React.useState(false);
  const [csv, setCsv] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState<PublicChaseCompany | null>(null);
  const [precondition, setPrecondition] = React.useState<ApiErrorBody | null>(null);
  const items = companies.data ?? [];
  const lastRun = runs.data?.[0] ?? null;

  const refreshAll = () => {
    companies.reload();
    runs.reload();
    void qc.invalidateQueries({ queryKey: ["chaseDirectors", orgId] });
  };

  const runImport = async () => {
    const parsed = parseRegisterCsv(csv);
    if (parsed.companies.length === 0) {
      toast({ kind: "error", title: "No company numbers found", description: "Expected company_number,person_name,person_email." });
      return;
    }
    setBusy(true);
    const r = await wrap(() => client.chase.importCompanies(orgId, { companies: parsed.companies }));
    setBusy(false);
    if (!r.ok) {
      if (r.error.code === "precondition_failed" || r.error.code === "rate_limited") setPrecondition(r.error);
      else toast({ kind: "error", title: "Import failed", description: r.error.message });
      return;
    }
    setImportOpen(false);
    setCsv("");
    toast({
      kind: "success",
      title: `Imported ${r.data.imported}, updated ${r.data.updated}`,
      description: `${r.data.contactsMatched} contact address(es) matched · served by the ${r.data.provider} provider`,
    });
    refreshAll();
  };

  const resync = async (company: PublicChaseCompany) => {
    const r = await wrap(() => client.chase.syncCompany(orgId, company.id));
    if (!r.ok) {
      toast({ kind: "error", title: "Sync failed", description: r.error.message });
      return;
    }
    toast({ kind: "success", title: `Synced ${company.companyNumber}` });
    refreshAll();
  };

  const remove = async (company: PublicChaseCompany) => {
    const previous = qc.getQueryData<PublicChaseCompany[]>(key);
    qc.setQueryData<PublicChaseCompany[]>(key, (cur) => (cur ?? []).filter((c) => c.id !== company.id)); // optimistic
    const r = await wrap(() => client.chase.removeCompany(orgId, company.id));
    if (!r.ok) {
      qc.setQueryData<PublicChaseCompany[]>(key, previous); // rollback
      toast({ kind: "error", title: "Remove failed", description: r.error.message });
      return;
    }
    toast({ kind: "success", title: `Removed ${company.companyNumber}` });
    void qc.invalidateQueries({ queryKey: ["chaseDirectors", orgId] });
  };

  const onDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void file.text().then(setCsv);
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Companies</h1>
          <p className="text-sm text-muted-foreground">
            Your client register. Officers, PSCs and statement dates refresh from Companies House every night.
          </p>
        </div>
        <Button onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4 mr-1.5" /> Import CSV
        </Button>
      </header>

      {lastRun && (
        // A div, not a p: Badge renders a div, which a <p> may not contain.
        <div className="text-xs text-muted-foreground">
          Last sync {new Date(lastRun.startedAt).toLocaleString()} · {lastRun.companiesScanned} companies ·{" "}
          {lastRun.errors} error(s) ·{" "}
          {lastRun.provider === "fixture" ? (
            <Badge variant="warning">recorded fixture data — no Companies House key configured</Badge>
          ) : (
            <Badge variant="secondary">live Companies House</Badge>
          )}
        </div>
      )}

      {precondition && (
        <PreconditionInsight error={precondition} resource="company" onDismiss={() => setPrecondition(null)} />
      )}

      {companies.loading ? (
        <Card>
          <CardHeader className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </CardHeader>
        </Card>
      ) : companies.error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">{companies.error.code}</CardTitle>
            <CardDescription>{companies.error.message}</CardDescription>
          </CardHeader>
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No client companies yet"
          description="Import a CSV of company numbers to start watching their directors and PSCs."
          primaryAction={{ label: "Import CSV", onClick: () => setImportOpen(true) }}
        />
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Statement due</TableHead>
                <TableHead>People</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Sync</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="font-medium">{c.companyName || "—"}</div>
                    <div className="text-xs text-muted-foreground">{c.companyNumber} · {c.companyStatus}</div>
                  </TableCell>
                  <TableCell>
                    <div>{c.nextStatementDue ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{formatDaysUntilDue(c.daysUntilDue)}</div>
                  </TableCell>
                  <TableCell>
                    {c.peopleCount}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({formatPeopleCounts(c.peopleCount, c.unverifiedCount, c.unknownCount).detail})
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={riskBadge(c.risk, c.daysUntilDue, c.companyStatus).variant}>{riskBadge(c.risk, c.daysUntilDue, c.companyStatus).label}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{c.lastSyncState}</div>
                    {c.lastSyncedAt && <div className="text-muted-foreground">{new Date(c.lastSyncedAt).toLocaleString()}</div>}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" aria-label={`Re-sync ${c.companyNumber}`} onClick={() => void resync(c)}>
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={`Remove ${c.companyNumber}`} onClick={() => setRemoving(c)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import client companies</DialogTitle>
            <DialogDescription>
              Drop a CSV or paste it: <code>company_number,person_name,person_email</code>, one row per person.
              Names are matched to the directors Companies House lists.
            </DialogDescription>
          </DialogHeader>
          <CardContent className="p-0 space-y-3">
            <textarea
              className="w-full min-h-40 rounded-md border bg-background p-2 font-mono text-xs"
              placeholder={"company_number,person_name,person_email\n01234567,Jane Director,jane@example.com"}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
              <Button disabled={busy || !csv.trim()} onClick={() => void runImport()}>
                {busy ? "Importing…" : "Import"}
              </Button>
            </div>
          </CardContent>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this company?"
        description="Its directors leave the board. The chase log is kept — it is the firm's AML record."
        resourceName={removing ? `${removing.companyNumber} ${removing.companyName}` : undefined}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (removing) await remove(removing);
          setRemoving(null);
        }}
      />
    </div>
  );
}
