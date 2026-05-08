import type { CreateWorkspaceInput, ShellProfile, Workspace } from './workspace'
import type { AgentProfile, AgentReadiness, CreateAgentProfileInput, UpdateAgentProfileInput } from './agent'

export type { ShellProfile, Workspace, AgentProfile, AgentReadiness }

export const IPC_CHANNELS = {
  workspace: {
    list: 'workspace:list',
    create: 'workspace:create',
    setActive: 'workspace:set-active',
    delete: 'workspace:delete',
    closePane: 'workspace:close-pane',
    splitPane: 'workspace:split-pane',
    pickFolder: 'workspace:pick-folder',
    shellProfiles: 'workspace:shell-profiles'
  },
  terminal: {
    start: 'terminal:start',
    write: 'terminal:write',
    resize: 'terminal:resize',
    stop: 'terminal:stop',
    restart: 'terminal:restart',
    onData: 'terminal:data',
    onExit: 'terminal:exit'
  },
  agent: {
    list:        'agent:list',
    create:      'agent:create',
    update:      'agent:update',
    delete:      'agent:delete',
    discover:    'agent:discover',
    getReadiness:'agent:get-readiness'
  }
} as const

export interface TerminalStartInput {
  paneId: string
  workspaceId: string
}

export interface TerminalWriteInput {
  paneId: string
  data: string
}

export interface TerminalResizeInput {
  paneId: string
  cols: number
  rows: number
}

export interface TerminalStopInput {
  paneId: string
}

export interface TerminalDataEvent {
  paneId: string
  data: string
}

export interface TerminalExitEvent {
  paneId: string
  exitCode: number | null
}

export interface SplitPaneInput {
  paneId: string
  direction: 'vertical' | 'horizontal'
}

export interface WorkspaceApi {
  list(): Promise<Workspace[]>
  create(input: CreateWorkspaceInput): Promise<Workspace>
  setActive(id: string): Promise<Workspace>
  delete(id: string): Promise<void>
  closePane(id: string): Promise<void>
  splitPane(input: SplitPaneInput): Promise<Workspace>
  pickFolder(): Promise<string | null>
  shellProfiles(): Promise<ShellProfile[]>
}

export interface TerminalApi {
  start(input: TerminalStartInput): Promise<void>
  write(input: TerminalWriteInput): Promise<void>
  resize(input: TerminalResizeInput): Promise<void>
  stop(input: TerminalStopInput): Promise<void>
  restart(input: TerminalStopInput): Promise<void>
  onData(listener: (event: TerminalDataEvent) => void): () => void
  onExit(listener: (event: TerminalExitEvent) => void): () => void
}

export interface AgentApi {
  list(): Promise<AgentProfile[]>
  create(input: CreateAgentProfileInput): Promise<AgentProfile>
  update(id: string, input: UpdateAgentProfileInput): Promise<AgentProfile>
  delete(id: string): Promise<void>
  discover(forceRefresh?: boolean): Promise<AgentReadiness[]>
  getReadiness(): Promise<AgentReadiness[]>
}

export interface OxeApi {
  app: {
    version: string
  }
  workspace: WorkspaceApi
  terminal: TerminalApi
  agent: AgentApi
}
