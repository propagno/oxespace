import type { OxequeryMessageParams } from '../../shared/messages/oxequery'

/** The parameter names each oxequery code carries, as the catalogs must interpolate them (C3 contract, S0.1 part 2b). */
export const OXEQUERY_PARAMETERS: Record<keyof OxequeryMessageParams, string[]> = {
  'oxequery.edit.readOnly': [],
  'oxequery.edit.notTable': [],
  'oxequery.edit.noKey': [],
  'oxequery.test.connected': [],
  'oxequery.startFailed': ['reason'],
  'oxequery.sql.copyProgram': [],
  'oxequery.sql.doBlock': [],
  'oxequery.sql.callProcedure': [],
  'oxequery.sql.destructiveInside': ['keyword', 'statement'],
  'oxequery.sql.rowLock': [],
  'oxequery.sql.sessionRole': [],
  'oxequery.sql.tableLock': [],
  'oxequery.session.busy': [],
  'oxequery.session.limit': ['limit'],
  'oxequery.session.agentTransaction': [],
  'oxequery.mongo.confirmName': [],
  'oxequery.mongo.confirm': [],
  'oxequery.mongo.production': [],
  'oxequery.mongo.deletes': [],
  'oxequery.sql.ambiguousEscape': []
}
