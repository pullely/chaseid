const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface PageParams {
  limit: number;
  offset: number;
  /** The next cursor, or null when the page came back short — the baseline's
   *  `meta.cursor` contract: a null cursor means "that was the last page". */
  nextCursor(rowsReturned: number): string | null;
}

/**
 * Offset pagination behind a cursor-shaped envelope.
 *
 * The baseline's keyset helper is built for `(created_at, id)`, and the board
 * sorts by a NULLABLE confirmation-statement date, which a keyset cursor
 * cannot express without a second sort key nobody would understand. The
 * register is thousands of rows, not millions, so offsets are honest here —
 * and the envelope stays `{ meta: { cursor } }`, so the page size and the
 * client code are identical to every other list in the product.
 */
export function readPageParams(url: URL): PageParams {
  const rawLimit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIMIT) : DEFAULT_LIMIT;

  const cursor = url.searchParams.get("cursor");
  let offset = 0;
  if (cursor) {
    const decoded = Number(cursor);
    if (Number.isFinite(decoded) && decoded >= 0) offset = Math.trunc(decoded);
  }

  return {
    limit,
    offset,
    nextCursor(rowsReturned: number): string | null {
      return rowsReturned < limit ? null : String(offset + limit);
    },
  };
}
