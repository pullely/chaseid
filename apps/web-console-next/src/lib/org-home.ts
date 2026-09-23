/**
 * An org's home: Chaseid's status board, under every profile. The board is the
 * product; projects (baseline) and settings (Solo) are plumbing a firm should
 * not land on (CL-7). Every "go to this org" link resolves through here.
 *
 * A plain module (no "use client") so the server-rendered org root can
 * redirect with it too.
 */
export function orgHomePath(orgSlug: string): string {
  return `/orgs/${orgSlug}/chase/directors`;
}
