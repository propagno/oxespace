import type { Client, ClientConfig } from 'pg'
import type Cursor from 'pg-cursor'
import type { SqlColumn, SqlResult } from '../../../../shared/types/oxequery'

/**
 * "Load more" for the SQL editor. A SELECT whose result has more rows than the limit keeps its cursor open on
 * the connection's own client, so the next rows come from the same statement, with the person's search_path,
 * temporary tables and open transaction. Until the page closes that client is busy with the cursor, so:
 * - anything the person runs closes the page first (`pgSession` does it for every caller);
 * - catalog reads for the tree and autocomplete go to a second client meanwhile (`metaClient`).
 */
export interface OpenPage {
  id: string
  cursor: Cursor
  columns: SqlColumn[]
  /** Rows read past the last page; they open the next one. */
  carry: unknown[][]
  /** The page runs inside the read-only transaction OxeQuery opened for it, which closing rolls back. */
  wrapped: boolean
}

export interface PagedSession { client: Client; page?: OpenPage; meta?: Client; config: ClientConfig }

export type CursorRead = { rows: unknown[][]; result: { fields?: { name: string; dataTypeID: number }[]; command?: string; rowCount?: number | null } }

export function readRows(cursor: Cursor, count: number): Promise<CursorRead> {
  return new Promise((resolve, reject) => cursor.read(count, (error, rows, result) => error ? reject(error) : resolve({ rows: rows as unknown[][], result: result as never })))
}

export async function closePage(session: PagedSession): Promise<void> {
  const page = session.page
  if (!page) return
  session.page = undefined
  await new Promise<void>(resolve => page.cursor.close(() => resolve()))
  if (page.wrapped) await session.client.query('ROLLBACK').catch(() => undefined)
}

/** A second client for catalog reads while a page holds the first one; opened on first need, closed with the session. */
export async function metaClient(session: PagedSession, create: (config: ClientConfig) => Client): Promise<Client> {
  if (session.meta) return session.meta
  const client = create(session.config)
  client.on('error', () => { if (session.meta === client) session.meta = undefined })
  await client.connect()
  session.meta = client
  return client
}

/**
 * One page: `rows` holds up to `limit + 1` raw rows. The extra row only says that more exist. A page cut for size
 * dropped rows the grid never saw, so it cannot be continued in order.
 */
export function pageResult(columns: SqlColumn[], rows: unknown[][], limit: number, shape: { cells(row: unknown[]): unknown[]; capByBytes(rows: unknown[][]): { rows: unknown[][]; cut: boolean } }): {
  result: Pick<SqlResult, 'columns' | 'rows' | 'rowCount' | 'truncated' | 'limitedBy'>; more: boolean; carry: unknown[][]
} {
  const capped = shape.capByBytes(rows.slice(0, limit).map(row => shape.cells(row)))
  const more = rows.length > limit && !capped.cut
  return {
    result: {
      columns, rows: capped.rows, rowCount: capped.rows.length, truncated: rows.length > limit || capped.cut,
      ...(capped.cut ? { limitedBy: 'bytes' as const } : rows.length > limit ? { limitedBy: 'rows' as const } : {})
    },
    more, carry: more ? rows.slice(limit) : []
  }
}
