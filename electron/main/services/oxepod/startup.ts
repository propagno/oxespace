import { app } from 'electron'
import log from 'electron-log/main.js'
import { broadcastOxePodEvent, registerOxePodIpc } from '../../ipc/oxepod.ipc'
import { describeStartupFailure } from '../oxequery/startup-failure'
import type { OxePodService } from './service'

export interface OxePodHandle {
  /** OxePod, loaded by the first caller: the window, OxeQuery (in process) or an agent's container tool. */
  load(): Promise<OxePodService>
  /** OxePod when something already loaded it; nothing is loaded to answer. */
  peek(): OxePodService | undefined
}

/** Registers OxePod's channel. The service itself (the container runtime) is imported on first use. */
export function startOxePod(): OxePodHandle {
  let loading: Promise<OxePodService> | undefined
  let ready: OxePodService | undefined
  const load = (): Promise<OxePodService> => {
    loading ??= Promise.all([import('./service'), import('../../runtime/execution-host')]).then(([{ OxePodService }, { LocalExecutionHost }]) => {
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
