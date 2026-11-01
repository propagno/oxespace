import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { BrowserPreviewMount, BrowserPreviewMountResult } from '../../../shared/types/browser-preview'
import { useTranslation } from 'react-i18next'

/** How long a re-measure waits for an animation frame before running anyway. */
const REMEASURE_FALLBACK_MS = 120

export function NativePreviewHost({ mount, active, zoom }: { mount: BrowserPreviewMount; active: boolean; zoom: number }): ReactElement {
  const { t } = useTranslation('code')
  const ref = useRef<HTMLDivElement>(null)
  const leasePromise = useRef<Promise<BrowserPreviewMountResult> | null>(null)
  const [mounted, setMounted] = useState(false)
  const {ownerKey,tabId,url,workspaceId,threadId,allowExternal,agentAccess} = mount
  useEffect(() => {
    let cancelled = false
    const promise = window.oxe.browserPreview.mount({ownerKey,tabId,url,workspaceId,threadId,allowExternal,agentAccess})
    leasePromise.current = promise
    void promise.then(() => { if (!cancelled) setMounted(true) }).catch(() => { if (!cancelled) setMounted(false) })
    return () => { cancelled = true }
  },[ownerKey,tabId,url,workspaceId,threadId,allowExternal,agentAccess])
  useEffect(() => () => {
    const promise = leasePromise.current
    if (promise) void promise.then(({lease}) => window.oxe.browserPreview.close({ownerKey,tabId,lease})).catch(() => {})
  },[ownerKey,tabId])
  useEffect(() => { if (mounted) void window.oxe.browserPreview.setZoom({ownerKey,tabId,zoom}).catch(() => {}) },[ownerKey,tabId,zoom,mounted])
  useEffect(() => {
    if (!mounted) return
    const api = window.oxe.browserPreview
    let frame = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastBounds = ''
    const measure = (): void => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      clearTimeout(timer)
      timer = undefined
      const element = ref.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      const panel = element.closest('.web-preview-panel')
      const covered = [...document.querySelectorAll('[role="dialog"]')].some(dialog => dialog !== panel && !dialog.contains(element) && dialog.getBoundingClientRect().width > 0)
      const next = {ownerKey,tabId,x:rect.x,y:rect.y,width:rect.width,height:rect.height,visible:active && !covered && element.checkVisibility() && rect.width > 0 && rect.height > 0}
      const signature = JSON.stringify(next)
      if (signature !== lastBounds) {
        lastBounds = signature
        void api.bounds(next).catch(() => {})
      }
    }
    // A frame, or a short timer when frames are paused (a window without the system's focus, right after a native
    // dialog): a dialog that closed must report the preview visible again, or main keeps it covered (#243).
    const schedule = (): void => { if (frame || timer) return; frame = requestAnimationFrame(measure); timer = setTimeout(measure, REMEASURE_FALLBACK_MS) }
    const resize = new ResizeObserver(schedule)
    if (ref.current) resize.observe(ref.current)
    const mutation = new MutationObserver(schedule)
    mutation.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class','aria-hidden']})
    window.addEventListener('resize',schedule)
    window.addEventListener('scroll',schedule,true)
    schedule()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      clearTimeout(timer)
      void api.bounds({ownerKey,tabId,x:0,y:0,width:0,height:0,visible:false}).catch(() => {})
      resize.disconnect(); mutation.disconnect()
      window.removeEventListener('resize',schedule)
      window.removeEventListener('scroll',schedule,true)
    }
  },[ownerKey,tabId,active,mounted])
  return <div ref={ref} className="web-preview-native-host" data-testid="browser-preview-native" data-browser-tab-id={tabId} data-workspace-id={workspaceId} data-thread-id={threadId} aria-label={t('preview.page')} />
}
