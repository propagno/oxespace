/** C3 message codes of the oxequery domain (`oxequery.*`); merged into `MessageParams` and `MESSAGE_CODES` by shared/messages.ts. */

export interface OxequeryMessageParams {
  'oxequery.edit.readOnly': Record<string, never>
  'oxequery.edit.notTable': Record<string, never>
  'oxequery.edit.noKey': Record<string, never>
  'oxequery.test.connected': Record<string, never>
  'oxequery.startFailed': { reason: string }
  /** SQL risk: `COPY … TO/FROM PROGRAM` runs a shell command on the database server. */
  'oxequery.sql.copyProgram': Record<string, never>
  /** SQL risk: a `DO` block runs code whose effect is not known before it runs. */
  'oxequery.sql.doBlock': Record<string, never>
  /** SQL risk: `CALL` runs a stored procedure whose effect is not known before it runs. */
  'oxequery.sql.callProcedure': Record<string, never>
  /** SQL risk: a `DO` or `CALL` carries a destructive keyword (DROP, TRUNCATE, DELETE, …) in its body or arguments. */
  'oxequery.sql.destructiveInside': { statement: string; keyword: string }
  /** SQL risk: `SELECT … FOR UPDATE / FOR SHARE` locks the rows it reads. */
  'oxequery.sql.rowLock': Record<string, never>
  /** SQL risk: `SET ROLE` / `SET SESSION AUTHORIZATION` changes the session user. */
  'oxequery.sql.sessionRole': Record<string, never>
  /** SQL risk: `VACUUM FULL` locks the whole table while it runs. */
  'oxequery.sql.tableLock': Record<string, never>
  /** A session with a transaction open or a command running is never closed to reopen it with new settings. */
  'oxequery.session.busy': Record<string, never>
  /** One connection already holds the most database connections it may hold for one role (the person or an agent). */
  'oxequery.session.limit': { limit: number }
  /** An agent sent BEGIN: an agent's session never keeps a transaction, so it was rolled back and refused. */
  'oxequery.session.agentTransaction': Record<string, never>
  /** Mongo write (B15): a change on a production connection waits for the connection's name, typed. */
  'oxequery.mongo.confirmName': Record<string, never>
  /** Mongo write: a change that needs the person's confirmation (a delete). */
  'oxequery.mongo.confirm': Record<string, never>
  /** Mongo write reason: the connection is a production one. */
  'oxequery.mongo.production': Record<string, never>
  /** Mongo write reason: the document will be deleted. */
  'oxequery.mongo.deletes': Record<string, never>
  /** SQL risk: a backslash in an ordinary string can end it early on a legacy server, so more runs than the text shows. */
  'oxequery.sql.ambiguousEscape': Record<string, never>
}

export const OXEQUERY_MESSAGE_CODES = [
  'oxequery.edit.readOnly',
  'oxequery.edit.notTable',
  'oxequery.edit.noKey',
  'oxequery.test.connected',
  'oxequery.startFailed',
  'oxequery.sql.copyProgram',
  'oxequery.sql.doBlock',
  'oxequery.sql.callProcedure',
  'oxequery.sql.destructiveInside',
  'oxequery.sql.rowLock',
  'oxequery.sql.sessionRole',
  'oxequery.sql.tableLock',
  'oxequery.session.busy',
  'oxequery.session.limit',
  'oxequery.session.agentTransaction',
  'oxequery.mongo.confirmName',
  'oxequery.mongo.confirm',
  'oxequery.mongo.production',
  'oxequery.mongo.deletes',
  'oxequery.sql.ambiguousEscape'
] as const satisfies readonly (keyof OxequeryMessageParams)[]
