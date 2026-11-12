import { app, BrowserWindow, clipboard, ClipboardItem, WebContentsView, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { designSourceProbeScript, sanitizeDesignProbe } from '../../../shared/design-source'
import { savePreviewCapture } from './browser-preview/preview-capture-store'
import { previewVerifyNote } from '../../../shared/preview-problems'
import { redactSecrets } from '../../../shared/secrets'
import { maskPreviewUrl } from './browser-preview/preview-observe'
import { setPreviewNoteSource } from './conversation/preview-note'
import { DESIGN_MODE_CHANNELS, type DesignGrabPayload } from '../../../shared/types/design-mode'
import type { BrowserPreviewBounds, BrowserPreviewEvent, BrowserPreviewMount, BrowserPreviewMountResult, BrowserPreviewSessionState } from '../../../shared/types/browser-preview'
import type { ExecutionOwner } from './execution-registry'
import { guestProbeWebPreferences, previewSessionFor, securePreviewGuest } from './browser-preview-security'
import { trustPreviewGuest } from '../ipc/ipc-sender-guard'
import { mainMessage } from '../../../shared/messages'
import { approvalCenter } from './approvals'
import { previewDraft } from './approvals/drafts'
import { requesterFor } from './approvals/requester'
import { brokerForGuest, type DebuggerLease } from './browser-preview/debugger-broker'
import { judgePreviewUrl, previewGrants, type PreviewNavigationCause } from './browser-preview/preview-grants'
import { emulationFor, PREVIEW_DEVICES } from '../../../shared/preview-devices'

interface BrowserTab {
  window: BrowserWindow
  view: WebContentsView
  ownerKey: string
  workspaceId: string
  threadId?: string
  tabId: string
  allowExternal: boolean
  agentAccess: boolean
  /** With agent access on: the agent is told to check this page after it edits (the Browser's "Auto-verify"). */
  autoVerify: boolean
  visible: boolean
  lease: string
  defaultUserAgent?: string
  emulationLease?: DebuggerLease
}

function checkedUrl(raw: string, allowExternal: boolean): string {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Preview accepts HTTP(S) URLs without embedded credentials')
  if (!allowExternal && judgePreviewUrl(url.href).kind !== 'loopback') throw new Error('Enable External preview to open this site')
  return url.href
}

/** Main-process owner of the embedded Chromium views and their live opt-in state. */
export class BrowserPreviewService {
  private tabs = new Map<string, BrowserTab>()
  private sessions = new Map<string, string>()
  private tabSessions = new Map<string, BrowserPreviewSessionState>()
  /** The agent access main lets each owner have (T43); a tab follows its owner. */
  private agentGrants = new Map<string, {granted: boolean; ownerKey: string; workspaceId?: string}>()
  private key(window: BrowserWindow, ownerKey: string, tabId: string): string { return `${window.id}:${ownerKey}:${tabId}` }
  private ownerKey(window: BrowserWindow, ownerKey: string): string { return `${window.id}:${ownerKey}` }
  private find(window: BrowserWindow, ownerKey: string, tabId: string): BrowserTab {
    const tab = this.tabs.get(this.key(window, ownerKey, tabId))
    if (!tab || tab.view.webContents.isDestroyed()) throw new Error('Browser tab is no longer open')
    return tab
  }
  sessionId(ownerKey: string): string {
    let id = this.sessions.get(ownerKey)
    if (!id) { id = randomUUID(); this.sessions.set(ownerKey, id) }
    return id
  }
  session(window: BrowserWindow, input: {ownerKey:string;action:'open'|'new'|'select'|'close'|'navigate';tabId?:string;url?:string;allowExternal?:boolean}): BrowserPreviewSessionState {
    if (!input || typeof input.ownerKey !== 'string' || !input.ownerKey || !['open','new','select','close','navigate'].includes(input.action)) throw new Error('Invalid browser session action')
    const key = this.ownerKey(window,input.ownerKey)
    let state = this.tabSessions.get(key)
    if (!state) {
      const id = randomUUID()
      state = {ownerKey:input.ownerKey,sessionId:this.sessionId(input.ownerKey),activeTabId:id,tabs:[{id,url:null,title:'New tab',loading:false,error:null,canGoBack:false,canGoForward:false}]}
      this.tabSessions.set(key,state)
      window.once('closed',() => { this.tabSessions.delete(key); this.agentGrants.delete(key); previewGrants.endSession(this.sessionId(input.ownerKey)) })
    }
    if (input.action === 'new') {
      const id = randomUUID()
      state.tabs.push({id,url:null,title:'New tab',loading:false,error:null,canGoBack:false,canGoForward:false})
      state.activeTabId = id
    } else if (input.action === 'navigate') {
      const meta = state.tabs.find(tab => tab.id === input.tabId && tab.id === state.activeTabId)
      if (!meta || typeof input.url !== 'string') throw new Error('Browser tab changed; select it before navigating')
      const nextUrl = checkedUrl(input.url,input.allowExternal === true)
      // A failed guest can have queued failure events even after close. Give
      // the replacement a new tab ID so those events cannot affect its state.
      if (meta.error) {
        this.close(window,{ownerKey:input.ownerKey,tabId:meta.id})
        meta.id = randomUUID()
        state.activeTabId = meta.id
      }
      meta.url = nextUrl
      meta.error = null
    } else if (input.action === 'select' || input.action === 'close') {
      const index = state.tabs.findIndex(tab => tab.id === input.tabId)
      if (index < 0) throw new Error('Browser tab is no longer open')
      if (input.action === 'select') state.activeTabId = state.tabs[index].id
      else {
        this.close(window,{ownerKey:input.ownerKey,tabId:state.tabs[index].id})
        state.tabs.splice(index,1)
        if (state.tabs.length === 0) state.tabs.push({id:randomUUID(),url:null,title:'New tab',loading:false,error:null,canGoBack:false,canGoForward:false})
        if (!state.tabs.some(tab => tab.id === state.activeTabId)) state.activeTabId = state.tabs[Math.min(index,state.tabs.length-1)].id
      }
    }
    for (const tab of this.tabs.values()) {
      if (tab.window === window && tab.ownerKey === input.ownerKey && tab.tabId !== state.activeTabId && tab.visible) {
        tab.visible = false
        tab.view.setVisible(false)
      }
    }
    const snapshot = this.snapshot(window,state)
    window.webContents.send(IPC_CHANNELS.browserPreview.onEvent,{ownerKey:input.ownerKey,tabId:state.activeTabId,type:'session',session:snapshot} satisfies BrowserPreviewEvent)
    return snapshot
  }
  private snapshot(window: BrowserWindow, state: BrowserPreviewSessionState): BrowserPreviewSessionState {
    return {...state,tabs:state.tabs.map(meta => {
      const tab = this.tabs.get(this.key(window,state.ownerKey,meta.id))
      if (!tab || tab.view.webContents.isDestroyed()) return {...meta}
      const guest = tab.view.webContents
      return {...meta,url:meta.url ?? guest.getURL(),title:guest.getTitle().slice(0,100) || meta.title,loading:guest.isLoading(),canGoBack:guest.canGoBack(),canGoForward:guest.canGoForward()}
    })}
  }
  private emit(tab: BrowserTab, event: Omit<BrowserPreviewEvent,'ownerKey'|'tabId'>): void {
    if (!tab.window.isDestroyed()) tab.window.webContents.send(IPC_CHANNELS.browserPreview.onEvent, {ownerKey:tab.ownerKey,tabId:tab.tabId,...event})
  }
  emitToTab(window: BrowserWindow, ownerKey: string, tabId: string, event: Omit<BrowserPreviewEvent,'ownerKey'|'tabId'>): void {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.browserPreview.onEvent, {ownerKey,tabId,...event})
  }
  async mount(window: BrowserWindow, input: BrowserPreviewMount): Promise<BrowserPreviewMountResult> {
    if (!input || typeof input.ownerKey !== 'string' || typeof input.workspaceId !== 'string' || typeof input.tabId !== 'string' || !/^[a-f\d-]{36}$/i.test(input.tabId)) throw new Error('Invalid browser mount')
    if (input.threadId && input.ownerKey !== `thread:${input.threadId}`) throw new Error('Browser Thread owner mismatch')
    if (!input.threadId && input.ownerKey !== input.workspaceId) throw new Error('Browser Code owner mismatch')
    const url = checkedUrl(input.url, input.allowExternal === true)
    const key = this.key(window, input.ownerKey, input.tabId)
    const state = this.tabSessions.get(this.ownerKey(window,input.ownerKey))
    const meta = state?.tabs.find(tab => tab.id === input.tabId)
    if (!meta) throw new Error('Browser tab is no longer open')
    meta.url = url
    let tab = this.tabs.get(key)
    if (!tab) {
      const view = new WebContentsView({webPreferences:{session:previewSessionFor(input.ownerKey),preload:join(app.getAppPath(),'out','preload','design-guest.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,...guestProbeWebPreferences()}})
      view.setBackgroundColor('#07080e')
      tab = {window,view,ownerKey:input.ownerKey,workspaceId:input.workspaceId,threadId:input.threadId,tabId:input.tabId,allowExternal:input.allowExternal === true,agentAccess:false,autoVerify:true,visible:false,lease:randomUUID()}
      this.tabs.set(key,tab)
      window.contentView.addChildView(view)
      view.setVisible(false)
      securePreviewGuest(view.webContents)
      trustPreviewGuest(view.webContents) // its design-guest preload may send the Design Mode channels, and only those
      const current = tab
      const isCurrent = (): boolean => this.tabs.get(key) === current && !view.webContents.isDestroyed()
      const guardPageMove = (event: { preventDefault(): void }, next: string, cause: PreviewNavigationCause): void => {
        try { checkedUrl(next, current.allowExternal) } catch { event.preventDefault(); return }
        const prev = view.webContents.getURL()
        const sid = this.sessionId(current.ownerKey)
        if (!current.agentAccess || !previewGrants.navigationNeedsAsk({ previewSessionId: sid, from: prev, to: next })) return
        event.preventDefault()
        const requester = current.threadId ? requesterFor({ kind: 'thread', id: current.threadId }) : { kind: 'agent' as const, id: `workspace:${current.workspaceId}`, label: mainMessage('approvals.requester.preview', {}) }
        void previewGrants.checkNavigation({
          previewSessionId: sid, from: prev, to: next, cause,
          ask: async req => (await approvalCenter.ask(previewDraft({ requester, action: 'navigate', page: prev, text: req.url }))).intent === 'allow'
        }).then(allowed => { if (allowed && isCurrent()) void view.webContents.loadURL(next).catch(() => {}) })
      }
      view.webContents.on('will-navigate', (event, next) => guardPageMove(event, next, 'script'))
      view.webContents.on('will-redirect', (event, next) => guardPageMove(event, next, 'redirect'))
      view.webContents.on('did-redirect-navigation', (_event, next, isInPlace, isMainFrame) => {
        if (!isMainFrame || isInPlace || !isCurrent()) return
        const prev = meta.url ?? ''
        const sid = this.sessionId(current.ownerKey)
        if (current.agentAccess && previewGrants.navigationNeedsAsk({ previewSessionId: sid, from: prev, to: next })) view.webContents.stop()
      })

      const emitNavigation = (next: string): void => {
        if (!isCurrent()) return
        meta.url = next
        meta.canGoBack = view.webContents.canGoBack()
        meta.canGoForward = view.webContents.canGoForward()
        this.emit(current,{type:'navigation',url:next,canGoBack:meta.canGoBack,canGoForward:meta.canGoForward})
      }
      // A same-document navigation (a #hash, history.pushState) keeps the page that was ready: Chromium reports it as a
      // load (did-start-loading) but never a new dom-ready, so the window would think the page is still loading and
      // keep design mode off (#243 CI). Say it is ready again once that load stops.
      let inPage = false
      view.webContents.on('did-navigate', (_event,next) => {
        inPage = false
        emitNavigation(next)
        if (isCurrent()) {
          const sid = this.sessionId(current.ownerKey)
          const grant = previewGrants.list(sid).find(item => { try { return item.origin === new URL(next).origin } catch { return false } }) ?? null
          this.emit(current, { type: 'grant', grant })
        }
      })
      view.webContents.on('did-navigate-in-page', (_event,next,isMainFrame) => { if (isMainFrame) inPage = true; emitNavigation(next); if (isMainFrame && isCurrent() && !view.webContents.isLoading()) this.emit(current,{type:'ready'}) })
      // What the page writes to its console as an error (an uncaught exception, a request that failed): the Browser
      // counts these since the last load, with or without an agent attached. Electron hands the level as a word in an
      // event object (and, in older versions, as a number in the second argument).
      view.webContents.on('console-message', (event: unknown, level?: unknown, message?: unknown, line?: unknown, sourceId?: unknown) => {
        if (!isCurrent()) return
        const details = (event && typeof event === 'object' ? event : {}) as { level?: unknown; message?: unknown; lineNumber?: unknown; sourceId?: unknown }
        if (details.level !== 'error' && level !== 3) return
        const text = redactSecrets(String(details.message ?? message ?? '')).slice(0, 500)
        if (!text) return
        const lineNumber = Number(details.lineNumber ?? line)
        this.emit(current,{type:'page-error',row:{level:'error',message:text,source:maskPreviewUrl(String(details.sourceId ?? sourceId ?? '')),line:Number.isFinite(lineNumber) ? lineNumber : 0},at:Date.now()})
      })
      view.webContents.on('page-title-updated', (_event,title) => { if (!isCurrent()) return; meta.title = title.slice(0,100); this.emit(current,{type:'title',title:meta.title}) })
      view.webContents.on('did-start-loading', () => { if (!isCurrent()) return; meta.loading = true; meta.error = null; this.emit(current,{type:'loading',loading:true}) })
      view.webContents.on('did-stop-loading', () => { if (!isCurrent()) return; meta.loading = false; this.emit(current,{type:'loading',loading:false}); if (inPage) { inPage = false; this.emit(current,{type:'ready'}) } })
      view.webContents.on('did-fail-load', (_event,code,description,_url,isMainFrame) => { if (!isCurrent()) return; if(code !== -3 && isMainFrame) { meta.loading = false; meta.error = description.slice(0,200); this.emit(current,{type:'failed',message:meta.error}) } })
      view.webContents.on('dom-ready', () => { if (isCurrent()) this.emit(current,{type:'ready'}) })
      if (view.webContents.debugger) {
        const broker = brokerForGuest(view.webContents)
        const emitBroker = (): void => { if (isCurrent()) { const s = broker.state(); this.emit(current,{type:'broker',attached:s.attached,devToolsOpen:s.devToolsOpen}) } }
        const offBroker = broker.onStateChange(emitBroker)
        view.webContents.on('devtools-opened', emitBroker)
        view.webContents.on('devtools-closed', emitBroker)
        view.webContents.once('destroyed', offBroker)
      }
      view.webContents.once('destroyed', () => { current.emulationLease?.release(); current.emulationLease = undefined; if (this.tabs.get(key) === current) this.tabs.delete(key) })
    }
    tab.allowExternal = input.allowExternal === true
    this.applyAgentAccess(window,input.ownerKey,input.agentAccess === true,false,input.workspaceId)
    const lease = randomUUID()
    tab.lease = lease
    if (tab.view.webContents.getURL() !== url || meta.error) {
      try { await tab.view.webContents.loadURL(url) }
      catch (error) {
        if (tab.lease !== lease) return {lease}
        if (!meta.error) {
          meta.loading = false
          meta.error = error instanceof Error ? error.message.slice(0,200) : 'The page could not be loaded.'
          this.emit(tab,{type:'failed',message:meta.error})
        }
      }
    }
    return {lease}
  }
  bounds(window: BrowserWindow, input: BrowserPreviewBounds): void {
    const tab = this.find(window,input.ownerKey,input.tabId)
    const {width:windowWidth,height:windowHeight} = window.getContentBounds()
    const {x,y,width,height} = input
    if (![x,y,width,height].every(Number.isFinite) || x < 0 || y < 0 || width < 0 || height < 0 || x + width > windowWidth + 2 || y + height > windowHeight + 2) throw new Error('Invalid browser bounds')
    const state = this.tabSessions.get(this.ownerKey(window,input.ownerKey))
    tab.visible = input.visible === true && state?.activeTabId === input.tabId && width >= 1 && height >= 1
    if (tab.visible) {
      // The main process, rather than the renderer's tab-strip attributes,
      // decides which native guest is active for this owner.
      for (const other of this.tabs.values()) {
        if (other !== tab && other.window === window && other.ownerKey === tab.ownerKey && other.visible) {
          other.visible = false
          other.view.setVisible(false)
        }
      }
    }
    if (tab.visible) tab.view.setBounds({x:Math.round(x),y:Math.round(y),width:Math.round(width),height:Math.round(height)})
    tab.view.setVisible(tab.visible)
  }
  tabsFor(window: BrowserWindow, ownerKey: string): Array<{id:string;active:boolean;url:string;title:string;loading:boolean}> {
    const state = this.tabSessions.get(this.ownerKey(window,ownerKey))
    if (!state) return []
    return this.snapshot(window,state).tabs.map(tab => ({id:tab.id,active:tab.id === state.activeTabId,url:tab.url ?? '',title:tab.title,loading:tab.loading}))
  }
  /**
   * T43 · Main decides agent access, per preview owner (a Code workspace or a conversation, in one window). Turning it
   * off always applies. Turning it on applies only with `grant`, which the window sends once, when the person confirms
   * the consent dialog; the window's re-sends on every tab change carry no grant, so they can keep access or lower it
   * but never give back what main revoked. Returns what applies.
   */
  setAccess(window: BrowserWindow, input: {ownerKey:string;tabId:string;agentAccess:boolean;allowExternal:boolean;grant?:boolean;autoVerify?:boolean}): {agentAccess:boolean} {
    if (!input || typeof input.ownerKey !== 'string' || typeof input.tabId !== 'string') throw new Error('Invalid browser access')
    const tab = this.tabs.get(this.key(window,input.ownerKey,input.tabId))
    if (!tab && input.grant !== true) this.find(window,input.ownerKey,input.tabId)
    if (tab) tab.allowExternal = input.allowExternal === true
    if (tab && typeof input.autoVerify === 'boolean') tab.autoVerify = input.autoVerify
    return {agentAccess:this.applyAgentAccess(window,input.ownerKey,input.agentAccess === true,input.grant === true,tab?.workspaceId)}
  }
  /** Whether main lets agents drive this owner's preview in this window (T43). */
  hasAgentAccess(window: BrowserWindow, ownerKey: string): boolean { return this.agentGrants.get(this.ownerKey(window,ownerKey))?.granted === true }
  /**
   * Main takes agent access away (an approval that blocks the window, a policy): it holds until the person grants it
   * again. It clears the grants of owners with no open tab too, so reopening the panel does not bring access back; a
   * grant whose workspace is not known yet (no tab ever mounted) is cleared by any workspace revoke, failing closed.
   */
  revokeAgentAccess(match: {workspaceId?: string; ownerKey?: string} = {}): number {
    let revoked = 0
    for (const grant of this.agentGrants.values()) {
      if (match.ownerKey !== undefined && grant.ownerKey !== match.ownerKey) continue
      if (match.workspaceId !== undefined && grant.workspaceId !== undefined && grant.workspaceId !== match.workspaceId) continue
      if (grant.granted) { grant.granted = false; revoked += 1; previewGrants.endSession(this.sessionId(grant.ownerKey)) }
    }
    for (const tab of this.tabs.values()) {
      if (!tab.agentAccess || this.hasAgentAccess(tab.window,tab.ownerKey)) continue
      tab.agentAccess = false
      this.emit(tab,{type:'access',agentAccess:false})
    }
    return revoked
  }
  private applyAgentAccess(window: BrowserWindow, ownerKey: string, requested: boolean, grant: boolean, workspaceId?: string): boolean {
    const key = this.ownerKey(window,ownerKey)
    const known = this.agentGrants.get(key)
    const next = requested && (grant || known?.granted === true)
    this.agentGrants.set(key,{granted:next,ownerKey,workspaceId:workspaceId ?? known?.workspaceId})
    for (const tab of this.tabs.values()) if (tab.window === window && tab.ownerKey === ownerKey) tab.agentAccess = next
    if (!next) previewGrants.endSession(this.sessionId(ownerKey))
    return next
  }
  revokeGrant(window: BrowserWindow, input: {ownerKey:string;tabId:string}): void {
    if (!input || typeof input.ownerKey !== 'string' || typeof input.tabId !== 'string') throw new Error('Invalid browser grant revoke')
    previewGrants.revoke(this.sessionId(input.ownerKey))
    this.emitToTab(window, input.ownerKey, input.tabId, { type: 'grant', grant: null })
  }
  async setDevice(window: BrowserWindow, input: {ownerKey:string;tabId:string;deviceId:string|null;rotated:boolean}): Promise<void> {
    if (!input || typeof input.ownerKey !== 'string' || typeof input.tabId !== 'string' || (input.deviceId !== null && typeof input.deviceId !== 'string') || typeof input.rotated !== 'boolean') {
      throw new Error('Invalid browser device emulation')
    }
    const preset = PREVIEW_DEVICES.find(item => item.id === (input.deviceId ?? 'desktop'))
    if (!preset) throw new Error('Unknown preview device')
    const tab = this.find(window, input.ownerKey, input.tabId)
    const guest = tab.view.webContents
    tab.defaultUserAgent ??= guest.getUserAgent()
    const emulation = emulationFor(preset, input.rotated)
    if (!emulation) {
      guest.disableDeviceEmulation()
      guest.setUserAgent(tab.defaultUserAgent)
      if (tab.emulationLease && guest.debugger) {
        await brokerForGuest(guest).sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {})
        tab.emulationLease.release()
        tab.emulationLease = undefined
      }
      return
    }
    guest.enableDeviceEmulation(emulation.deviceEmulation)
    guest.setUserAgent(emulation.userAgent)
    if (guest.debugger) {
      const broker = brokerForGuest(guest)
      tab.emulationLease ??= broker.acquire('emulation')
      await broker.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: emulation.touch, maxTouchPoints: emulation.touch ? 5 : 0 }).catch(() => {})
    }
  }
  designMode(window: BrowserWindow, input: {ownerKey:string;tabId:string;enabled:boolean;keep?:boolean}): void {
    const tab = this.find(window,input.ownerKey,input.tabId)
    tab.view.webContents.send(DESIGN_MODE_CHANNELS.setEnabled,input.enabled === true,input.enabled === true && input.keep === true)
  }
  setZoom(window: BrowserWindow, input: {ownerKey:string;tabId:string;zoom:number}): void {
    if (!Number.isFinite(input.zoom) || input.zoom < 50 || input.zoom > 150) throw new Error('Invalid browser zoom')
    this.find(window,input.ownerKey,input.tabId).view.webContents.setZoomFactor(input.zoom / 100)
  }
  async reload(window: BrowserWindow, input: {ownerKey:string;tabId:string}): Promise<void> {
    this.find(window,input.ownerKey,input.tabId).view.webContents.reload()
  }
  back(window: BrowserWindow, input: {ownerKey:string;tabId:string}): void {
    const guest = this.find(window,input.ownerKey,input.tabId).view.webContents
    if (guest.canGoBack()) guest.goBack()
  }
  forward(window: BrowserWindow, input: {ownerKey:string;tabId:string}): void {
    const guest = this.find(window,input.ownerKey,input.tabId).view.webContents
    if (guest.canGoForward()) guest.goForward()
  }
  async captureElement(window: BrowserWindow, input: {ownerKey:string;tabId:string;rect:{x:number;y:number;width:number;height:number}}): Promise<string | null> {
    const tab = this.find(window,input.ownerKey,input.tabId)
    const {x,y,width,height} = input.rect
    if (![x,y,width,height].every(Number.isFinite) || width < 1 || height < 1 || width * height > 4_000_000) throw new Error('Invalid element capture bounds')
    return (await tab.view.webContents.capturePage({x:Math.max(0,Math.round(x)),y:Math.max(0,Math.round(y)),width:Math.round(width),height:Math.round(height)})).toDataURL()
  }
  /** The element's capture for the confirmation sheet, also saved to the app's capture folder: an agent in a terminal is given the path. */
  async captureElementFile(window: BrowserWindow, input: {ownerKey:string;tabId:string;rect:{x:number;y:number;width:number;height:number}}): Promise<{dataUrl:string;path:string|null} | null> {
    const tab = this.find(window,input.ownerKey,input.tabId)
    const {x,y,width,height} = input.rect
    if (![x,y,width,height].every(Number.isFinite) || width < 1 || height < 1 || width * height > 4_000_000) throw new Error('Invalid element capture bounds')
    const image = await tab.view.webContents.capturePage({x:Math.max(0,Math.round(x)),y:Math.max(0,Math.round(y)),width:Math.round(width),height:Math.round(height)})
    if (image.isEmpty()) return null
    const owner = tab.threadId ?? tab.workspaceId
    const saved = await savePreviewCapture(join(app.getPath('userData'),'web-preview-captures'), owner, `element-${Date.now().toString(36)}-${randomUUID().slice(0,8)}.png`, image.toPNG()).catch(() => null)
    return {dataUrl:image.toDataURL(),path:saved?.path ?? null}
  }
  async captureClipboard(window: BrowserWindow, input: {ownerKey:string;tabId:string}): Promise<void> {
    const tab = this.find(window,input.ownerKey,input.tabId)
    if (!tab.visible) throw new Error('Open a visible browser tab before capturing it')
    const image = await tab.view.webContents.capturePage()
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
  }
  close(window: BrowserWindow, input: {ownerKey:string;tabId:string;lease?:string}): void {
    const key = this.key(window,input.ownerKey,input.tabId)
    const tab = this.tabs.get(key)
    if (!tab || tab.view.webContents.isDestroyed()) return
    if (input.lease && input.lease !== tab.lease) return
    this.tabs.delete(key)
    tab.emulationLease?.release()
    tab.emulationLease = undefined
    tab.window.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
    if (![...this.tabs.values()].some(other => other.ownerKey === tab.ownerKey)) previewGrants.endSession(this.sessionId(tab.ownerKey))
  }
  /**
   * The owner's preview has agent access but is not reported visible right now: something covers it for a moment, such
   * as the approval modal that just closed (#243). Not a grant: actions still need activeFor.
   */
  /** The owner's tabs the agent may use: one owner, workspace and thread, access on, not destroyed (the one access rule). */
  private agentTabs(workspaceId: string, owner?: ExecutionOwner): { ownerKey: string; tabs: BrowserTab[] } {
    const ownerKey = owner?.kind === 'thread' ? `thread:${owner.id}` : workspaceId
    return { ownerKey, tabs: [...this.tabs.values()].filter(tab => tab.ownerKey === ownerKey && tab.workspaceId === workspaceId && tab.threadId === (owner?.kind === 'thread' ? owner.id : undefined) && tab.agentAccess && !tab.view.webContents.isDestroyed()) }
  }
  coveredWithAccess(workspaceId: string, owner?: ExecutionOwner): boolean {
    // Only the owner's active tab: a background tab is never visible and is not "covered" (#243 security review L2).
    return this.agentTabs(workspaceId, owner).tabs.some(tab => !tab.visible && this.tabSessions.get(this.ownerKey(tab.window, tab.ownerKey))?.activeTabId === tab.tabId)
  }
  activeFor(workspaceId: string, owner?: ExecutionOwner): {guest:WebContents;window:BrowserWindow;external:boolean;tabId:string;sessionId:string;ownerKey:string} | null {
    const { ownerKey, tabs } = this.agentTabs(workspaceId, owner)
    const matches = tabs.filter(tab => tab.visible)
    if (matches.length !== 1) return null
    const tab = matches[0]
    return {guest:tab.view.webContents,window:tab.window,external:tab.allowExternal,tabId:tab.tabId,sessionId:this.sessionId(ownerKey),ownerKey}
  }

  /**
   * What a conversation's agent is told with a message while it can see the conversation's preview and Auto-verify is
   * on: the page's address and how to check a change. Null when there is no such page: no access, Auto-verify off, the
   * Browser closed or covered, or a page that is not on this machine.
   */
  autoVerifyNote(threadId: string): string | null {
    const ownerKey = `thread:${threadId}`
    const tab = [...this.tabs.values()].find(item => item.ownerKey === ownerKey && item.threadId === threadId && item.agentAccess && item.autoVerify && item.visible && !item.view.webContents.isDestroyed() && this.hasAgentAccess(item.window, ownerKey))
    if (!tab) return null
    try { return previewVerifyNote(checkedUrl(tab.view.webContents.getURL(), false)) } catch { return null }
  }
  handleDesignMessage(sender: WebContents, type: 'grab'|'cancel', payload?: DesignGrabPayload): void {
    const tab = [...this.tabs.values()].find(item => item.view.webContents === sender)
    if (!tab || !tab.visible) return
    if (type !== 'grab' || !payload) { this.emit(tab,{type:'cancel'}); return }
    // Where the element is written is asked in the page's own world (the guest preload cannot see what the frameworks
    // hang on elements). The page is not trusted: only bounded strings and numbers come back, and the window keeps a
    // file only when it exists in the project. A page that does not answer in time sends the grab without it.
    const point = payload.point
    const { probe: _fromGuest, ...grab } = payload
    void _fromGuest
    const asked = point && Number.isFinite(point.x) && Number.isFinite(point.y)
      ? Promise.race([sender.executeJavaScript(designSourceProbeScript(point.x, point.y)).then(sanitizeDesignProbe, () => null), new Promise<null>(resolve => setTimeout(() => resolve(null), DESIGN_PROBE_TIMEOUT_MS))])
      : Promise.resolve(null)
    void asked.then(probe => { if (this.tabs.get(this.key(tab.window, tab.ownerKey, tab.tabId)) === tab && tab.visible) this.emit(tab,{type:'grab',payload:{...grab,probe}}) })
  }
}

/** How long the page has to say where an element is written before the grab goes without it. */
const DESIGN_PROBE_TIMEOUT_MS = 800

export const browserPreviewService = new BrowserPreviewService()
// The conversation asks this once the Browser has been used; before that there is no page to check.
setPreviewNoteSource(threadId => browserPreviewService.autoVerifyNote(threadId))
