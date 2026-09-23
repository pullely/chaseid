import { hexToUuid, uuidToHex } from "@saas/db/ids";

export function generateRequestId(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  let hex = "";
  for (let i = 0; i < buf.length; i++) {
    hex += buf[i]!.toString(16).padStart(2, "0");
  }
  return `req_${hex}`;
}

export function parseOrgPublicId(publicId: string): string | null {
  if (!publicId.startsWith("org_")) return null;
  return hexToUuid(publicId.slice(4));
}

export function orgPublicId(uuid: string): string {
  return `org_${uuidToHex(uuid)}`;
}

// Chaseid's own prefixes. None of the four collides with the baseline's
// register (org_, usr_, ses_, chl_, sp_, mem_, inv_, prj_, env_, stg_, flg_,
// sec_, whe_, whs_, whd_, ntf_, int_, igd_, repl_, sub_, sa_).
export function companyPublicId(uuid: string): string {
  return `cmp_${uuidToHex(uuid)}`;
}

export function parseCompanyPublicId(publicId: string): string | null {
  if (!publicId.startsWith("cmp_")) return null;
  return hexToUuid(publicId.slice(4));
}

export function personPublicId(uuid: string): string {
  return `prs_${uuidToHex(uuid)}`;
}

export function parsePersonPublicId(publicId: string): string | null {
  if (!publicId.startsWith("prs_")) return null;
  return hexToUuid(publicId.slice(4));
}

export function syncRunPublicId(uuid: string): string {
  return `syn_${uuidToHex(uuid)}`;
}

export function chaseMessagePublicId(uuid: string): string {
  return `chs_${uuidToHex(uuid)}`;
}
