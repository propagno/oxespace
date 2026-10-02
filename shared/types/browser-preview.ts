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

export interface BrowserPreviewEvent {
  ownerKey: string
  tabId: string
  type: 'ready' | 'navigation' | 'loading' | 'title' | 'failed' | 'grab' | 'cancel' | 'session'
  session?: BrowserPreviewSessionState
  url?: string
  title?: string
  loading?: boolean
  canGoBack?: boolean
  canGoForward?: boolean
  message?: string
  payload?: DesignGrabPayload
  screenshot?: string | null
}

export interface BrowserPreviewApi {
  session(input: {ownerKey:string;action:'open'|'new'|'select'|'close'|'navigate';tabId?:string;url?:string;allowExternal?:boolean}): Promise<BrowserPreviewSessionState>
  mount(input: BrowserPreviewMount): Promise<BrowserPreviewMountResult>
  bounds(input: BrowserPreviewBounds): Promise<void>
  setAccess(input: {ownerKey:string;tabId:string;agentAccess:boolean;allowExternal:boolean}): Promise<void>
  designMode(input: {ownerKey:string;tabId:string;enabled:boolean}): Promise<void>
  setZoom(input: {ownerKey:string;tabId:string;zoom:number}): Promise<void>
  reload(input: {ownerKey:string;tabId:string}): Promise<void>
  back(input: {ownerKey:string;tabId:string}): Promise<void>
  forward(input: {ownerKey:string;tabId:string}): Promise<void>
  captureElement(input: {ownerKey:string;tabId:string;rect:{x:number;y:number;width:number;height:number}}): Promise<string | null>
  captureClipboard(input: {ownerKey:string;tabId:string}): Promise<void>
  close(input: {ownerKey:string;tabId:string;lease?:string}): Promise<void>
  onEvent(listener: (event: BrowserPreviewEvent) => void): () => void
}
