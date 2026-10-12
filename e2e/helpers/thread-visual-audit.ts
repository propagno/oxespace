import type { Page } from '@playwright/test'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** Optional measurements at existing visual checkpoints; no provider inference. */
export async function recordThreadVisualAudit(page: Page, checkpoint: string): Promise<void> {
  const output = process.env.OXESPACE_VISUAL_AUDIT_OUTPUT
  if (!output) return
  const metrics = await page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && s.visibility !== 'hidden' && s.display !== 'none'
    }
    const foreground = document.querySelector('[role="dialog"]') ?? document.body
    const box = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
    const rgb = (value: string) => {
      const components = value.match(/[\d.]+/g)?.map(Number) ?? []
      if (value.startsWith('color(srgb ')) return components.map((number, index) => index < 3 ? number * 255 : number)
      return value.startsWith('rgb') ? components : []
    }
    const luminance = (c: number[]) => c.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
    const contrast: Array<{ text: string; ratio: number; fontSize: string; color: string; background: string }> = []
    for (const el of foreground.querySelectorAll('p,small,label,button,span,h1,h2,h3')) {
      if (!visible(el) || !el.textContent?.trim() || el.children.length || el.closest('[disabled]')) continue
      const style = getComputedStyle(el), color = rgb(style.color)
      let node: Element | null = el, background = ''
      // Only opaque text on an opaque ancestor is measured. Layered alpha needs manual review.
      while (node) { const value = getComputedStyle(node).backgroundColor, components = rgb(value); if (components.length === 3 || components[3] === 1) { background = value; break }; if (components[3] > 0) break; node = node.parentElement }
      if (!background || color.length < 3 || color.length === 4 && color[3] !== 1) continue
      const a = luminance(color), b = luminance(rgb(background)), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
      const large = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 700
      if (ratio < (large ? 3 : 4.5)) contrast.push({ text: el.textContent.trim().slice(0, 70), ratio: Math.round(ratio * 100) / 100, fontSize: style.fontSize, color: style.color, background })
    }
    const controls = [...foreground.querySelectorAll('button,input,select,[role="separator"]')].filter(visible).map(el => ({ name: el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim().slice(0, 70), tag: el.tagName, ...box(el), disabled: el.hasAttribute('disabled') }))
    return { viewport: { width: innerWidth, height: innerHeight }, theme: document.documentElement.dataset.theme, pageOverflow: document.documentElement.scrollWidth > innerWidth,
      geometry: Object.fromEntries(['.thread-heading','.thread-timeline','.thread-composer','.thread-workbench','.thread-navigation-item','[role="dialog"]'].map(selector => { const el = document.querySelector(selector); return [selector, el ? box(el) : null] })),
      smallControls: controls.filter(c => !c.disabled && (c.width < 28 || c.height < 28)), unnamedControlCandidates: controls.filter(c => !c.name), contrastCandidates: contrast.slice(0, 40),
      nativeSelects: [...foreground.querySelectorAll('select')].filter(visible).map(el => ({ label: el.getAttribute('aria-label'), ...box(el) })), mountedRows: document.querySelectorAll('.thread-virtual-row').length }
  })
  mkdirSync(dirname(output), { recursive: true })
  appendFileSync(output, JSON.stringify({ checkpoint, ...metrics }) + '\n')
}
