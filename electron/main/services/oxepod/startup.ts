import { app } from 'electron'
import log from 'electron-log/main.js'
import { broadcastOxePodEvent, registerOxePodIpc } from '../../ipc/oxepod.ipc'
import { describeStartupFailure } from '../oxequery/startup-failure'
import type { AppDatabase } from '../../db'
import type { OxePodService } from './service'

export interface OxePodHandle {
  /** OxePod, loaded by the first caller: the window, OxeQuery (in process) or an agent's container tool. */
  load(): Promise<OxePodService>
  /** OxePod when something already loaded it; nothing is loaded to answer. */
  peek(): OxePodService | undefined
}

/**
 * Registers OxePod's channel. The service itself (the container runtime) is imported on first use, and takes the
 * app's database then: handing it over at boot imported the whole service into every start.
 */
export function startOxePod(db?: AppDatabase): OxePodHandle {
  let loading: Promise<OxePodService> | undefined
  let ready: OxePodService | undefined
  const load = (): Promise<OxePodService> => {
    loading ??= Promise.all([import('./service'), import('../../runtime/execution-host')]).then(([{ OxePodService, setOxePodAppDatabase }, { LocalExecutionHost }]) => {
      setOxePodAppDatabase(db)
      ready = new OxePodService({ host: new LocalExecutionHost(), emit: broadcastOxePodEvent })
      return ready
    }).catch((error: unknown) => {
      log.warn('OxePod unavailable', error)
      loading = undefined // a later request tries again
      throw error
    })
    return loading
  }
  registerOxePodIpc(load, describeStartupFailure)
  app.once('before-quit', () => { ready?.dispose() })
  return { load, peek: () => ready }
}
