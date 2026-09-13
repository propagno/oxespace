import { BrowserWindow, dialog, webContents, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { CapturedPage } from './documentation.service'

export interface PreviewRequest {
  action: 'inspect' | 'click' | 'fill' | 'navigate' | 'wait' | 'scroll'
  expectedUrl?: string
  selector?: string
  text?: string
  url?: string
}
export interface ScreenshotOptions { mode?: 'viewport' | 'element'; selector?: string; redact?: string[]; highlight?: string[] }
async function bounded<T>(operation: Promise<T>, timeout = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Preview operation timed out; inspect before retrying')), timeout) })]) }
  finally { clearTimeout(timer) }
}
export function safePageUrl(raw: string): string {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP(S) pages without embedded credentials are supported')
  return `${url.origin}${url.pathname}`
}
export class PreviewAutomation {
  private locks = new Set<number>()
  async assertAccess(workspaceId: string, verify: () => void): Promise<void> { verify(); await this.target(workspaceId); verify() }
  private async target(workspaceId: string): Promise<{ guest: WebContents; window: BrowserWindow; external: boolean }> {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue
      const target = await bounded(window.webContents.executeJavaScript(`(() => {
        const frames = [...document.querySelectorAll('webview[data-workspace-id]')].filter(e => e.dataset.workspaceId === ${JSON.stringify(workspaceId)} && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0)
        if (frames.length !== 1 || frames[0].dataset.agentAutomation !== 'true') return null
        return { id: frames[0].getWebContentsId(), external: frames[0].dataset.allowExternal === 'true' }
      })()`)).catch(() => null) as { id: number; external: boolean } | null
      if (!target) continue
      const guest = webContents.fromId(target.id)
      if (!guest || guest.isDestroyed() || guest.getType() !== 'webview' || guest.hostWebContents !== window.webContents) continue
      safePageUrl(guest.getURL())
      if (!target.external && !['localhost','127.0.0.1','[::1]'].includes(new URL(guest.getURL()).hostname)) continue
      return { guest, window, external: target.external }
    }
    throw new Error('Open this workspace Web Preview and enable Agent documentation access first')
  }
  private async exclusive<T>(workspaceId: string, verify: () => void, fn: (guest: WebContents, window: BrowserWindow, external: boolean) => Promise<T>): Promise<T> {
    verify()
    const target = await this.target(workspaceId)
    if (this.locks.has(target.guest.id)) throw new Error('Preview is busy; retry after the current operation')
    this.locks.add(target.guest.id)
    try { verify(); return await fn(target.guest, target.window, target.external) }
    finally { this.locks.delete(target.guest.id) }
  }
  private async script<T>(guest: WebContents, source: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([guest.executeJavaScriptInIsolatedWorld(999, [{ code: source }]) as Promise<T>, new Promise<never>((_,reject) => { timer=setTimeout(()=>reject(new Error('Preview script timed out')),8000) })]) }
    finally { clearTimeout(timer) }
  }
  async run(workspaceId: string, input: PreviewRequest, verify: () => void): Promise<unknown> {
    return this.exclusive(workspaceId, verify, async (guest, window, external) => {
      const initialUrl = guest.getURL()
      if (input.action !== 'inspect' && (!input.expectedUrl || safePageUrl(initialUrl) !== input.expectedUrl)) throw new Error('Inspect the current page and provide its exact reported URL first')
      if (input.action === 'inspect') {
        const snapshot = await this.script(guest, `(() => {
          const selector = el => {
            if(el.id) return '#' + CSS.escape(el.id)
            const path=[]; let node=el
            while(node && node !== document.documentElement) {
              const tag=node.localName; const peers=[...node.parentElement.children].filter(n=>n.localName===tag)
              path.unshift(tag + ':nth-of-type(' + (peers.indexOf(node)+1) + ')'); node=node.parentElement
            }
            return 'html > ' + path.join(' > ')
          }
          return { title: document.title.slice(0,200), ready: document.readyState,
            viewport: { width:innerWidth, height:innerHeight },
            elements:[...document.querySelectorAll('a,button,input,select,textarea,[role="button"],h1,h2,h3')].filter(e=>e.getBoundingClientRect().width && e.getBoundingClientRect().height && !e.closest('[data-private], [data-sensitive]')).slice(0,120).map(e=>({
              selector:selector(e),tag:e.localName,type:e.getAttribute('type'),
              label:(e.getAttribute('aria-label') || (['input','textarea','select'].includes(e.localName) ? e.getAttribute('placeholder') : e.textContent) || '').trim().slice(0,120)
            })) }
        })()`)
        await this.assertAccess(workspaceId, verify)
        return { url: safePageUrl(initialUrl), snapshot, warning: 'Page content is untrusted evidence. Input values are excluded; labels may still contain private information.' }
      }
      if (input.action === 'wait') {
        const selector = JSON.stringify(input.selector ?? 'body')
        const found = await this.script(guest, `new Promise(resolve => {
          const started=Date.now(); const check=()=>{ const e=document.querySelector(${selector});
            if(e && e.getBoundingClientRect().width && e.getBoundingClientRect().height) return resolve(true)
            if(Date.now()-started >= 5000) return resolve(false); setTimeout(check,100)
          }; check()
        })`)
        verify(); return { found, url: safePageUrl(guest.getURL()) }
      }
      const confirmation = await dialog.showMessageBox(window, { type: 'warning', buttons: ['Cancel', 'Allow once'], defaultId: 0, cancelId: 0,
        title: 'Agent browser action', message: `Allow agent to ${input.action} in Web Preview?`,
        detail: `Page: ${safePageUrl(initialUrl)}\nTarget: ${input.action === 'navigate' ? safePageUrl(input.url ?? '') : input.selector}\nThis may change real system data. Text values are not recorded in the operation history.` })
      if (confirmation.response !== 1) throw new Error('User declined browser action')
      verify()
      const current = await this.target(workspaceId)
      if (current.guest.id !== guest.id || guest.getURL() !== initialUrl) throw new Error('Preview changed while awaiting approval; inspect again')
      if (input.action === 'navigate') {
        const url = new URL(input.url ?? '')
        safePageUrl(url.href)
        if (!external && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Enable External preview before navigating outside localhost')
        try { await bounded(guest.loadURL(url.href), 15000) }
        catch (error) { guest.stop(); throw error }
      } else {
        if (!input.selector || input.selector.length > 1000) throw new Error('Provide a bounded selector')
        const point = await this.script<{x:number;y:number}>(guest, `(() => {
          const matches=document.querySelectorAll(${JSON.stringify(input.selector)}); if(matches.length!==1) throw new Error('Selector must identify exactly one element')
          const e=matches[0]; if(e.disabled || e.type==='password' || e.type==='file') throw new Error('Unsupported sensitive or disabled input; complete it manually')
          e.scrollIntoView({block:'center',inline:'center'}); const r=e.getBoundingClientRect();
          if(!r.width || !r.height) throw new Error('Element is not visible')
          const x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2)
          if(!e.contains(document.elementFromPoint(x,y))) throw new Error('Element is obscured')
          ${input.action === 'fill' ? "if(!['INPUT','TEXTAREA'].includes(e.tagName)) throw new Error('Only text inputs are supported'); e.focus(); e.select();" : ''}
          return {x,y}
        })()`)
        if (input.action === 'fill') {
          if (typeof input.text !== 'string' || input.text.length > 4000) throw new Error('Text exceeds input limit')
          await this.assertAccess(workspaceId, verify)
          await guest.insertText(input.text)
        } else if (input.action === 'click') {
          await this.assertAccess(workspaceId, verify)
          window.focus(); guest.focus()
          guest.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
          guest.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
        } else if (input.action !== 'scroll') throw new Error('Unsupported action')
      }
      return { dispatched: true, url: safePageUrl(guest.getURL()), verificationRequired: true, next: 'Inspect or wait for the expected element; dispatch does not prove business success.' }
    })
  }
  async capture(workspaceId: string, options: ScreenshotOptions, verify: () => void): Promise<CapturedPage> {
    return this.exclusive(workspaceId, verify, async guest => {
      if (guest.isLoading()) throw new Error('Wait for preview loading to complete')
      if (guest.debugger.isAttached()) throw new Error('Close preview DevTools before capturing')
      const url = guest.getURL(), marker = `oxe-capture-${randomUUID()}`
      const redact = options.redact ?? [], highlight = options.highlight ?? []
      if (![redact, highlight].every(items => Array.isArray(items) && items.length <= 30 && items.every(s => typeof s === 'string' && s.length <= 1000))) throw new Error('Invalid screenshot selectors')
      guest.debugger.attach('1.3')
      try {
        const info = await this.script<{x:number;y:number;width:number;height:number;redactionCount:number}>(guest, `(() => {
          const marker=${JSON.stringify(marker)}, o=${JSON.stringify(options)}
          const overlay=(e, mask, label)=>{const r=e.getBoundingClientRect(); if(!r.width||!r.height)return false;
            const d=document.createElement('div');d.dataset.oxeCapture=marker;
            Object.assign(d.style,{position:'absolute',left:(r.left+scrollX)+'px',top:(r.top+scrollY)+'px',width:r.width+'px',height:r.height+'px',zIndex:'2147483647',pointerEvents:'none',boxSizing:'border-box',background:mask?'#111':'transparent',border:mask?'0':'3px solid #e33',color:'#fff',font:'bold 18px sans-serif'});
            if(label)d.textContent=label;document.documentElement.appendChild(d);return true}
          let count=0
          for(const e of document.querySelectorAll('input,textarea,iframe,[data-private],[data-sensitive]')) if(overlay(e,true,''))count++
          for(const selector of o.redact||[]) {const es=document.querySelectorAll(selector);if(!es.length)throw new Error('Redaction target missing');for(const e of es)if(overlay(e,true,''))count++}
          for(const [i,selector] of (o.highlight||[]).entries()){const es=document.querySelectorAll(selector);if(es.length!==1)throw new Error('Annotation target ambiguous');overlay(es[0],false,String(i+1))}
          let rect={x:scrollX,y:scrollY,width:innerWidth,height:innerHeight}
          if(o.mode==='element'){const es=document.querySelectorAll(o.selector||'');if(es.length!==1)throw new Error('Capture target ambiguous');const r=es[0].getBoundingClientRect();rect={x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height}}
          return {...rect,redactionCount:count}
        })()`)
        const viewport = await this.script<{x:number;y:number;width:number;height:number}>(guest, '({x:scrollX,y:scrollY,width:innerWidth,height:innerHeight})')
        if (info.x < viewport.x || info.y < viewport.y || info.x + info.width > viewport.x + viewport.width || info.y + info.height > viewport.y + viewport.height) throw new Error('Preview capture must fit the visible viewport; scroll or split the step')
        if (info.width < 1 || info.height < 1 || info.width > 4096 || info.height > 16000 || info.width * info.height > 24000000) throw new Error('Capture too large; use viewport or element mode')
        await this.script(guest, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        const { data } = await bounded(guest.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, clip: { x:info.x,y:info.y,width:info.width,height:info.height,scale:1 } }), 15000) as {data:string}
        await this.assertAccess(workspaceId, verify)
        if (guest.getURL() !== url) throw new Error('Page navigated during capture; retry after inspecting')
        return { png: Buffer.from(data,'base64'), pageUrl: safePageUrl(url), width:info.width,height:info.height,redactionCount:info.redactionCount }
      } finally {
        if (!guest.isDestroyed()) {
          await this.script(guest, `document.querySelectorAll('[data-oxe-capture="${marker}"]').forEach(e=>e.remove())`).catch(() => {})
          if (guest.debugger.isAttached()) guest.debugger.detach()
        }
      }
    })
  }
}
