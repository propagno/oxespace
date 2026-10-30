import { app, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { PostApiResult, PostOp } from '../../../shared/oxepost/types'
import { requireAppFrame } from './ipc-guards'
import type { OxePostService } from '../services/oxepost/service'

const OPS = new Set<PostOp>(['list', 'read', 'save', 'rename', 'delete', 'envSave', 'envDelete', 'secretSet', 'secretClear', 'send', 'history'])
let service: Promise<OxePostService> | undefined

/**
 * The one command channel of OxePost. Only this stub is loaded at startup; the service (files, secrets, sending)
 * is imported by the first request, so none of it weighs on the main entry bundle or on boot.
 * Every operation is validated again in the service.
 */
export function registerOxePostIpc(rootOf: (workspaceId: string) => string | undefined): void {
  ipcMain.handle(IPC_CHANNELS.oxePost.call, async (event, request: unknown): Promise<PostApiResult<unknown>> => {
    requireAppFrame(event, 'OxePost')
    const body = request && typeof request === 'object' ? request as { op?: unknown; input?: unknown } : {}
    if (typeof body.op !== 'string' || !OPS.has(body.op as PostOp)) throw new Error('Unknown OxePost operation')
    service ??= Promise.all([import('../services/oxepost/service'), import('../services/oxequery/secret-cipher')]).then(([{ OxePostService }, { createSecretCipher }]) =>
      new OxePostService({ rootOf, vault: createSecretCipher(safeStorage), secretsFile: join(app.getPath('userData'), 'oxepost-secrets.json') }))
    return (await service).call(body.op as PostOp, body.input)
  })
}
