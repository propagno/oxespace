import { app, BrowserWindow, clipboard, ClipboardItem, ipcMain, WebContentsView, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { DESIGN_MODE_CHANNELS, type DesignGrabPayload } from '../../../shared/types/design-mode'
import type { BrowserPreviewBounds, BrowserPreviewEvent, BrowserPreviewMount, BrowserPreviewMountResult, BrowserPreviewSessionState } from '../../../shared/types/browser-preview'
import type { ExecutionOwner } from './execution-registry'
import { previewSessionFor, securePreviewGuest } from './browser-preview-security'

interface BrowserTab {
  window: BrowserWindow
  view: WebContentsView
  ownerKey: string
  workspaceId: string
  threadId?: string
  tabId: string
  allowExternal: boolean
  agentAccess: boolean
  visible: boolean
  lease: string
}

function checkedUrl(raw: string, allowExternal: boolean): string {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Preview accepts HTTP(S) URLs without embedded credentials')
  if (!allowExternal && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Enable External preview to open this site')
  return url.href
}

/** Main-process owner of the embedded Chromium views and their live opt-in state. */
export class BrowserPreviewService {
  private tabs = new Map<string, BrowserTab>()
  private sessions = new Map<string, string>()
  private tabSessions = new Map<string, BrowserPreviewSessionState>()
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
      window.once('closed',() => this.tabSessions.delete(key))
    }
    if (input.action === 'new') {
      const id = randomUUID()
      state.tabs.push({id,url:null,title:'New tab',loading:false,error:null,canGoBack:false,canGoForward:false})
      state.activeTabId = id
    } else if (input.action === 'navigate') {
      const meta = state.tabs.find(tab => tab.id === input.tabId && tab.id === state.activeTabId)
      if (!meta || typeof input.url !== 'string') throw new Error('Browser tab changed; select it before navigating')
      const nextUrl = checkedUrl(input.url,input.allowExternal === true)
      // A failed guest may still report the requested URL. Replace it before
      // retrying so mount cannot mistake that URL for a successful load.
      if (meta.error) this.close(window,{ownerKey:input.ownerKey,tabId:meta.id})
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
      const view = new WebContentsView({webPreferences:{session:previewSessionFor(input.ownerKey),preload:join(app.getAppPath(),'out','preload','design-guest.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}})
      view.setBackgroundColor('#07080e')
      tab = {window,view,ownerKey:input.ownerKey,workspaceId:input.workspaceId,threadId:input.threadId,tabId:input.tabId,allowExternal:input.allowExternal === true,agentAccess:input.agentAccess === true,visible:false,lease:randomUUID()}
      this.tabs.set(key,tab)
      window.contentView.addChildView(view)
      view.setVisible(false)
      securePreviewGuest(view.webContents)
      const current = tab
      view.webContents.on('will-navigate', (event, next) => { try { checkedUrl(next,current.allowExternal) } catch { event.preventDefault() } })
      view.webContents.on('will-redirect', (event, next) => { try { checkedUrl(next,current.allowExternal) } catch { event.preventDefault() } })
      const emitNavigation = (next: string): void => {
        meta.url = next
        meta.canGoBack = view.webContents.canGoBack()
        meta.canGoForward = view.webContents.canGoForward()
        this.emit(current,{type:'navigation',url:next,canGoBack:meta.canGoBack,canGoForward:meta.canGoForward})
      }
      view.webContents.on('did-navigate', (_event,next) => emitNavigation(next))
      view.webContents.on('did-navigate-in-page', (_event,next) => emitNavigation(next))
      view.webContents.on('page-title-updated', (_event,title) => { meta.title = title.slice(0,100); this.emit(current,{type:'title',title:meta.title}) })
      view.webContents.on('did-start-loading', () => { meta.loading = true; meta.error = null; this.emit(current,{type:'loading',loading:true}) })
      view.webContents.on('did-stop-loading', () => { meta.loading = false; this.emit(current,{type:'loading',loading:false}) })
      view.webContents.on('did-fail-load', (_event,code,description,_url,isMainFrame) => { if(code !== -3 && isMainFrame) { meta.loading = false; meta.error = description.slice(0,200); this.emit(current,{type:'failed',message:meta.error}) } })
      view.webContents.on('dom-ready', () => this.emit(current,{type:'ready'}))
      view.webContents.once('destroyed', () => { if (this.tabs.get(key) === current) this.tabs.delete(key) })
    }
    tab.allowExternal = input.allowExternal === true
    tab.agentAccess = input.agentAccess === true
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
  setAccess(window: BrowserWindow, input: {ownerKey:string;tabId:string;agentAccess:boolean;allowExternal:boolean}): void {
    const tab = this.find(window,input.ownerKey,input.tabId)
    tab.agentAccess = input.agentAccess === true
    tab.allowExternal = input.allowExternal === true
  }
  designMode(window: BrowserWindow, input: {ownerKey:string;tabId:string;enabled:boolean}): void {
    const tab = this.find(window,input.ownerKey,input.tabId)
    tab.view.webContents.send(DESIGN_MODE_CHANNELS.setEnabled,input.enabled === true)
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
    tab.window.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
    this.tabs.delete(key)
  }
  activeFor(workspaceId: string, owner?: ExecutionOwner): {guest:WebContents;window:BrowserWindow;external:boolean;tabId:string;sessionId:string} | null {
    const ownerKey = owner?.kind === 'thread' ? `thread:${owner.id}` : workspaceId
    const matches = [...this.tabs.values()].filter(tab => tab.ownerKey === ownerKey && tab.workspaceId === workspaceId && tab.threadId === (owner?.kind === 'thread' ? owner.id : undefined) && tab.visible && tab.agentAccess && !tab.view.webContents.isDestroyed())
    if (matches.length !== 1) return null
    const tab = matches[0]
    return {guest:tab.view.webContents,window:tab.window,external:tab.allowExternal,tabId:tab.tabId,sessionId:this.sessionId(ownerKey)}
  }
  handleDesignMessage(sender: WebContents, type: 'grab'|'cancel', payload?: DesignGrabPayload): void {
    const tab = [...this.tabs.values()].find(item => item.view.webContents === sender)
    if (!tab || !tab.visible) return
    this.emit(tab,type === 'grab' ? {type,payload} : {type})
  }
}

export const browserPreviewService = new BrowserPreviewService()

export function registerBrowserPreviewIpc(): void {
  const service = browserPreviewService
  const windowFor = (sender: WebContents): BrowserWindow => {
    const window = BrowserWindow.fromWebContents(sender)
    if (!window || window.isDestroyed()) throw new Error('Browser window unavailable')
    return window
  }
  ipcMain.handle(IPC_CHANNELS.browserPreview.mount,(event,input:BrowserPreviewMount) => service.mount(windowFor(event.sender),input))
  ipcMain.handle(IPC_CHANNELS.browserPreview.session,(event,input) => service.session(windowFor(event.sender),input))
  ipcMain.handle(IPC_CHANNELS.browserPreview.bounds,(event,input:BrowserPreviewBounds) => service.bounds(windowFor(event.sender),input))
  ipcMain.handle(IPC_CHANNELS.browserPreview.setAccess,(event,input) => service.setAccess(windowFor(event.sender),input))
  ipcMain.handle(IPC_CHANNELS.browserPreview.designMode,(event,input) => service.designMode(windowFor(event.sender),input))
  ipcMain.handle(IPC_CHANNELS.browserPreview.setZoom,(event,input) => service.setZoom(windowFor(event.sender),input))
  ipcMain.handle(IPC_CHANNELS.browserPreview.reload,(event,input) => service.reload(windowFor(event.sender),input))
  ipcMain.handle(IPC_CHANNELS.browserPreview.back,(event,input) => service.back(windowFor(event.sender),input))
  ipcMain.handle(IPC_CHANNELS.browserPreview.forward,(event,input) => service.forward(windowFor(event.sender),input))
  ipcMain.handle(IPC_CHANNELS.browserPreview.captureElement,(event,input) => service.captureElement(windowFor(event.sender),input))
  ipcMain.handle(IPC_CHANNELS.browserPreview.captureClipboard,(event,input) => service.captureClipboard(windowFor(event.sender),input))
  ipcMain.handle(IPC_CHANNELS.browserPreview.close,(event,input) => service.close(windowFor(event.sender),input))
  ipcMain.on(DESIGN_MODE_CHANNELS.grab,(event,payload:DesignGrabPayload) => service.handleDesignMessage(event.sender,'grab',payload))
  ipcMain.on(DESIGN_MODE_CHANNELS.cancel,event => service.handleDesignMessage(event.sender,'cancel'))
}
