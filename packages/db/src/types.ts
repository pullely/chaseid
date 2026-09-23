// Branded UUID identifier + decode helpers live in `./ids` (`@saas/db/ids`).
export { isUuid, asUuid, uuidFromPublicId } from "./ids/index.js";
export type { Uuid } from "./ids/index.js";

export const BOUNDED_CONTEXTS = [
  "control",
  "identity",
  "membership",
  "projects",
  "billing",
  "events",
  "config",
  "webhooks",
  "metering",
  "notifications",
  "support",
  "integrations",
  // chaseid CH1: the client register and its verification chase — the one
  // bounded context this product adds to the cirrus baseline.
  "chase",
] as const;

export type BoundedContext = (typeof BOUNDED_CONTEXTS)[number];

export interface MigrationEntry {
  id: string;
  context: BoundedContext;
  path: string;
  checksum: string;
  description: string;
}

export interface MigrationManifest {
  version: 1;
  migrations: MigrationEntry[];
}
