import type { DesignGrabPayload } from './design-mode'

export interface BrowserPreviewMount {
  ownerKey: string
  workspaceId: string
  threadId?: string
  tabId: string
  url: string
  allowExternal: boolean
  agentAccess: boolean
}

export interface BrowserPreviewMountResult { lease: string }

export interface BrowserPreviewBounds {
  ownerKey: string
  tabId: string
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}

export interface BrowserPreviewTabState {
  id: string
  url: string | null
  title: string
  loading: boolean
  error: string | null
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserPreviewSessionState {
  ownerKey: string
  sessionId: string
  activeTabId: string
  tabs: BrowserPreviewTabState[]
}

export interface BrowserPreviewGrant {
  previewSessionId: string
  origin: string
  scope: 'session' | 'action'
  grantedAt: number
}

export interface BrowserPreviewAgentAction {
  id: string
  kind: 'click' | 'fill' | 'navigate' | 'scroll'
  label: string
  value?: string
  at: number
}

export interface BrowserPreviewConsoleRow {
  level: 'error' | 'warning' | 'info'
  message: string
  source: string
  line: number
}

export interface BrowserPreviewNetworkRow {
  method: string
  url: string
  status: number | null
  type: string
  ms: number | null
  failed?: 'canceled' | 'error'
}

export interface BrowserPreviewEvent {
  ownerKey: string
  tabId: string
  type: 'ready' | 'navigation' | 'loading' | 'title' | 'failed' | 'grab' | 'cancel' | 'session' | 'access' | 'grant' | 'agent-action' | 'console' | 'network' | 'broker'
  session?: BrowserPreviewSessionState
  url?: string
  title?: string
  loading?: boolean
  canGoBack?: boolean
  canGoForward?: boolean
  message?: string
  payload?: DesignGrabPayload
  screenshot?: string | null
  /** `access`: main turned agent access off (T43); the window shows it and asks the person again to turn it on. */
  agentAccess?: boolean
  grant?: BrowserPreviewGrant | null
  phase?: 'before' | 'after'
  action?: BrowserPreviewAgentAction
  result?: 'ok' | 'denied' | 'failed'
  row?: BrowserPreviewConsoleRow | BrowserPreviewNetworkRow
  at?: number
  attached?: boolean
  devToolsOpen?: boolean
}

export interface BrowserPreviewApi {
  session(input: {ownerKey:string;action:'open'|'new'|'select'|'close'|'navigate';tabId?:string;url?:string;allowExternal?:boolean}): Promise<BrowserPreviewSessionState>
  mount(input: BrowserPreviewMount): Promise<BrowserPreviewMountResult>
  bounds(input: BrowserPreviewBounds): Promise<void>
  /** `grant` only when the person confirms access (T43): without it, main can keep or lower agent access but never raise it. */
  /** `autoVerify`: with access on, the agent is told with each message to check this page after it edits; false turns that off. */
  setAccess(input: {ownerKey:string;tabId:string;agentAccess:boolean;allowExternal:boolean;grant?:boolean;autoVerify?:boolean}): Promise<{agentAccess:boolean}>
  /** `keep`: the picker stays on after each pick, for several elements in a row. */
  designMode(input: {ownerKey:string;tabId:string;enabled:boolean;keep?:boolean}): Promise<void>
  setZoom(input: {ownerKey:string;tabId:string;zoom:number}): Promise<void>
  reload(input: {ownerKey:string;tabId:string}): Promise<void>
  back(input: {ownerKey:string;tabId:string}): Promise<void>
  forward(input: {ownerKey:string;tabId:string}): Promise<void>
  captureElement(input: {ownerKey:string;tabId:string;rect:{x:number;y:number;width:number;height:number}}): Promise<string | null>
  /** The same capture, also saved under the app's private capture folder so an agent can be given its path. `path` is null when it could not be saved. */
  captureElementFile(input: {ownerKey:string;tabId:string;rect:{x:number;y:number;width:number;height:number}}): Promise<{dataUrl:string;path:string|null} | null>
  captureClipboard(input: {ownerKey:string;tabId:string}): Promise<void>
  close(input: {ownerKey:string;tabId:string;lease?:string}): Promise<void>
  revokeGrant(input: { ownerKey: string; tabId: string }): Promise<void>
  setDevice(input: { ownerKey: string; tabId: string; deviceId: string | null; rotated: boolean }): Promise<void>
  onEvent(listener: (event: BrowserPreviewEvent) => void): () => void
}
