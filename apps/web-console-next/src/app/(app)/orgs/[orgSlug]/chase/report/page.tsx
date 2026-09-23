"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Download, FileWarning } from "lucide-react";
import { OrgScope } from "@/components/shell/org-scope";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";
import { formatDaysUntilDue, reportFileName } from "@/components/chase/chase";

export default function ReportPage() {
  const params = useParams<{ orgSlug: string }>();
  const slug = params?.orgSlug ?? "";
  return <OrgScope slug={slug}>{(org) => <Inner orgId={org.id} orgSlug={org.slug} />}</OrgScope>;
}

/**
 * This month's filings at risk: every company whose confirmation statement is
 * due within 30 days with someone on it still unverified. "Download CSV" asks
 * the same route for its `text/csv` rendering — generated per request, never
 * stored.
 */
function Inner({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const [downloading, setDownloading] = React.useState(false);
  const report = useApiQuery(qk.chaseReport(orgId), () => wrap(() => client.chase.atRiskReport(orgId)));
  const rows = report.data?.companies ?? [];

  const download = async () => {
    setDownloading(true);
    const r = await wrap(() => client.chase.atRiskReportCsv(orgId));
    setDownloading(false);
    if (!r.ok) {
      toast({ kind: "error", title: "Download failed", description: r.error.message });
      return;
    }
    const url = URL.createObjectURL(new Blob([r.data], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = reportFileName(orgSlug, new Date());
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">At-risk filings</h1>
          <p className="text-sm text-muted-foreground">
            Confirmation statements due within {report.data?.windowDays ?? 30} days with someone still unverified.
          </p>
        </div>
        <Button onClick={() => void download()} disabled={downloading || rows.length === 0}>
          <Download className="h-4 w-4 mr-1.5" /> {downloading ? "Preparing…" : "Download CSV"}
        </Button>
      </header>

      {report.loading ? (
        <Card>
          <CardHeader className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </CardHeader>
        </Card>
      ) : report.error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">{report.error.code}</CardTitle>
            <CardDescription>{report.error.message}</CardDescription>
          </CardHeader>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileWarning}
          title="Nothing at risk this month"
          description="No company on your book files within 30 days with an unverified director or PSC."
        />
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Statement due</TableHead>
                <TableHead>Unverified</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.companyNumber}>
                  <TableCell>
                    <div className="font-medium">{row.companyName || "—"}</div>
                    <div className="text-xs text-muted-foreground">{row.companyNumber}</div>
                  </TableCell>
                  <TableCell>
                    <div>{row.nextStatementDue ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{formatDaysUntilDue(row.daysUntilDue)}</div>
                  </TableCell>
                  <TableCell>
                    <div>{row.unverifiedCount}</div>
                    <div className="text-xs text-muted-foreground">{row.unverifiedNames.join(", ")}</div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
