import { randomUUID } from 'node:crypto'
import type { MongoClient } from 'mongodb'

/** The find or aggregate a connection is running: its comment on the server and the signal that stops it here. */
export interface MongoOperation { comment: string; controller: AbortController }

/** What a connection's session holds for cancelling; the core's session has these fields. */
export interface CancellableSession { client: MongoClient; operation?: MongoOperation }

/**
 * Runs a read with a comment on the server and an abort signal on the client, so `cancelOperation` can stop it
 * either way. The previous operation of the session is replaced, as only one runs at a time.
 */
export async function runTagged<T>(session: CancellableSession | undefined, run: (comment: string, signal: AbortSignal) => Promise<T>): Promise<T> {
  const operation: MongoOperation = { comment: `oxequery:${randomUUID()}`, controller: new AbortController() }
  if (session) session.operation = operation
  try { return await run(operation.comment, operation.controller.signal) } finally { if (session?.operation === operation) delete session.operation }
}

/**
 * Stops the running operation. On the server it is found by its comment and killed, which needs the `killOp`
 * privilege; without it, or when the server cannot be asked, the driver still abandons the operation and closes
 * its cursor here. Returns whether there was an operation to stop.
 */
export async function cancelOperation(session: CancellableSession | undefined): Promise<boolean> {
  const operation = session?.operation
  if (!session || !operation) return false
  try {
    const admin = session.client.db('admin')
    const current = await admin.command({ currentOp: 1, 'command.comment': operation.comment }) as { inprog?: Array<{ opid?: number | string }> }
    for (const running of current.inprog ?? []) if (running.opid !== undefined) await admin.command({ killOp: 1, op: running.opid })
  } catch { /* No killOp privilege, or the server is unreachable: the client-side abort below still stops it here. */ }
  operation.controller.abort(new Error('Cancelled'))
  return true
}
