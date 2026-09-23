"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { ScrollText } from "lucide-react";
import { OrgScope } from "@/components/shell/org-scope";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";
import { STEP_LABEL } from "@/components/chase/chase";

export default function MessagesPage() {
  const params = useParams<{ orgSlug: string }>();
  const slug = params?.orgSlug ?? "";
  return <OrgScope slug={slug}>{(org) => <Inner orgId={org.id} />}</OrgScope>;
}

/** The chase log — append-only, newest first. The page an auditor is shown. */
function Inner({ orgId }: { orgId: string }) {
  const { client } = useSession();
  const log = useApiQuery(qk.chaseMessages(orgId), () =>
    wrap(async () => (await client.chase.listMessages(orgId, { limit: 200 })).messages),
  );
  const rows = log.data ?? [];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Chase log</h1>
        <p className="text-sm text-muted-foreground">
          Every chase sent, with its step, address, template and outcome. Nothing here is ever edited or deleted.
        </p>
      </header>

      {log.loading ? (
        <Card>
          <CardHeader className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </CardHeader>
        </Card>
      ) : log.error ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">{log.error.code}</CardTitle>
            <CardDescription>{log.error.message}</CardDescription>
          </CardHeader>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No chases sent yet"
          description="The morning sweep chases unverified people whose company files within 30 days."
        />
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sent</TableHead>
                <TableHead>Step</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap">{new Date(m.sentAt).toLocaleString()}</TableCell>
                  <TableCell>{STEP_LABEL[m.step] ?? `Step ${m.step}`}</TableCell>
                  <TableCell>{m.toAddress}</TableCell>
                  <TableCell className="font-mono text-xs">{m.templateKey}</TableCell>
                  <TableCell>
                    <Badge variant={m.enqueueResult === "ok" ? "success" : "destructive"}>{m.enqueueResult}</Badge>
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
