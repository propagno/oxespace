import type { IpcRendererEvent } from 'electron'
import {
  IPC_CHANNELS,
  type AgentProfile,
  type AgentReadiness,
  type OxeApi,
  type ShellProfile,
  type TerminalDataEvent,
  type TerminalExitEvent,
  type Workspace
} from '../../shared/types/ipc'

export interface PreloadIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: IpcRendererEvent, payload: unknown) => void): void
  removeListener(channel: string, listener: (event: IpcRendererEvent, payload: unknown) => void): void
}

export function createOxeApi(ipc: PreloadIpc): OxeApi {
  return {
    app: {
      version: '0.1.0'
    },
    workspace: {
      list: () => ipc.invoke(IPC_CHANNELS.workspace.list) as Promise<Workspace[]>,
      create: (input) => ipc.invoke(IPC_CHANNELS.workspace.create, input) as Promise<Workspace>,
      setActive: (id) => ipc.invoke(IPC_CHANNELS.workspace.setActive, id) as Promise<Workspace>,
      delete: (id) => ipc.invoke(IPC_CHANNELS.workspace.delete, id) as Promise<void>,
      closePane: (id) => ipc.invoke(IPC_CHANNELS.workspace.closePane, id) as Promise<void>,
      splitPane: (input) => ipc.invoke(IPC_CHANNELS.workspace.splitPane, input) as Promise<Workspace>,
      pickFolder: () => ipc.invoke(IPC_CHANNELS.workspace.pickFolder) as Promise<string | null>,
      shellProfiles: () => ipc.invoke(IPC_CHANNELS.workspace.shellProfiles) as Promise<ShellProfile[]>
    },
    terminal: {
      start: (input) => ipc.invoke(IPC_CHANNELS.terminal.start, input) as Promise<void>,
      write: (input) => ipc.invoke(IPC_CHANNELS.terminal.write, input) as Promise<void>,
      resize: (input) => ipc.invoke(IPC_CHANNELS.terminal.resize, input) as Promise<void>,
      stop: (input) => ipc.invoke(IPC_CHANNELS.terminal.stop, input) as Promise<void>,
      restart: (input) => ipc.invoke(IPC_CHANNELS.terminal.restart, input) as Promise<void>,
      onData: (listener) => subscribe<TerminalDataEvent>(ipc, IPC_CHANNELS.terminal.onData, listener),
      onExit: (listener) => subscribe<TerminalExitEvent>(ipc, IPC_CHANNELS.terminal.onExit, listener)
    },
    agent: {
      list: () => ipc.invoke(IPC_CHANNELS.agent.list) as Promise<AgentProfile[]>,
      create: (input) => ipc.invoke(IPC_CHANNELS.agent.create, input) as Promise<AgentProfile>,
      update: (id, input) => ipc.invoke(IPC_CHANNELS.agent.update, id, input) as Promise<AgentProfile>,
      delete: (id) => ipc.invoke(IPC_CHANNELS.agent.delete, id) as Promise<void>,
      discover: (forceRefresh) => ipc.invoke(IPC_CHANNELS.agent.discover, forceRefresh) as Promise<AgentReadiness[]>,
      getReadiness: () => ipc.invoke(IPC_CHANNELS.agent.getReadiness) as Promise<AgentReadiness[]>
    }
  }
}

function subscribe<TPayload>(
  ipc: PreloadIpc,
  channel: string,
  listener: (event: TPayload) => void
): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
    listener(payload as TPayload)
  }

  ipc.on(channel, wrapped)
  return () => ipc.removeListener(channel, wrapped)
}
