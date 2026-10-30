import { app, safeStorage, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import type { PostApiResult, PostOp } from '../../../shared/oxepost/types'
import { requireAppFrame } from './ipc-guards'
import { createSecretCipher } from '../services/oxequery/secret-cipher'
import { OxePostService } from '../services/oxepost/service'

const OPS = new Set<PostOp>(['list', 'read', 'save', 'rename', 'delete', 'envSave', 'envDelete', 'secretSet', 'secretClear', 'send', 'history'])
let service: OxePostService | undefined

/**
 * The one command channel of OxePost. index.ts registers the channel and imports this module on the first call, so
 * none of OxePost is in the entry bundle. Every operation is validated again in the service.
 */
export function handleOxePost(event: IpcMainInvokeEvent, request: unknown, rootOf: (workspaceId: string) => string | undefined): Promise<PostApiResult<unknown>> {
  requireAppFrame(event, 'OxePost')
  const body = request && typeof request === 'object' ? request as { op?: unknown; input?: unknown } : {}
  if (typeof body.op !== 'string' || !OPS.has(body.op as PostOp)) throw new Error('Unknown OxePost operation')
  service ??= new OxePostService({ rootOf, vault: createSecretCipher(safeStorage), secretsFile: join(app.getPath('userData'), 'oxepost-secrets.json') })
  return service.call(body.op as PostOp, body.input)
}
