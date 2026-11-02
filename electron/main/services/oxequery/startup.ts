import { app, ipcMain, safeStorage } from 'electron'
import log from 'electron-log/main.js'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../../../shared/types/ipc'
import type { AppDatabase } from '../../db'
import type { OxePodSeam } from '../oxepod/seam'
import type { AgentGateway } from './agent-gateway'

export interface OxeQueryHandle {
  /** What the internal MCP tools call; absent when OxeQuery did not start. */
  agent?: AgentGateway
  /** Why OxeQuery did not start, in one line a person or an agent can read. */
  error?: string
}

/**
 * OxeQuery: the database worker and its service, loaded lazily so their code stays out of the entry chunk. A database
 * in a container is reached through OxePod, in process (`pod`).
 */
export async function startOxeQuery(db: AppDatabase, pod: () => Promise<OxePodSeam>): Promise<OxeQueryHandle> {
  try {
    const [{ OxeQueryService }, { OxeQueryWorkerClient }, { registerOxeQueryIpc, broadcastOxeQueryEvent }, { createSecretCipher }, pickers, { appApprovalPrompter }] = await Promise.all([
      import('./service'), import('./worker-client'), import('../../ipc/oxequery.ipc'), import('./secret-cipher'), import('./file-picker'), import('../agent-actions/approval-prompter')
    ])
    const oxeQuery = new OxeQueryService({
      db, emit: broadcastOxeQueryEvent, pod,
      cipher: createSecretCipher(safeStorage),
      worker: new OxeQueryWorkerClient(join(app.getAppPath(), 'out', 'main', 'oxequery-worker.js'), undefined, detail => log.error('OxeQuery worker failed', detail)),
      pickFile: pickers.pickCredentialFile, pickSavePath: pickers.pickExportPath, pickImportPath: pickers.pickImportPath,
      approvalPrompter: appApprovalPrompter
    })
    registerOxeQueryIpc(oxeQuery)
    app.once('before-quit', () => { void oxeQuery.dispose() })
    return { agent: oxeQuery.agent }
  } catch (error) {
    log.warn('OxeQuery unavailable', error)
    const { describeStartupFailure } = await import('./startup-failure')
    const reason = describeStartupFailure(error)
    // The view asks through this channel; answer with the reason instead of "no handler registered".
    ipcMain.handle(IPC_CHANNELS.oxeQuery.call, () => ({ ok: false, error: { code: 'failed', message: `OxeQuery did not start: ${reason}`, messageCode: { code: 'oxequery.startFailed', params: { reason } } } }))
    return { error: reason }
  }
}
