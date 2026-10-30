import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** WCAG 2.0, 2.1 and 2.2 A and AA: the level the 1.4 accessibility claim is made against (2.2 adds target size, 2.5.8). */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

export interface Violation {
  surface: string
  rule: string
  impact: string | null | undefined
  /** CSS selector of each failing node, trimmed. */
  nodes: string[]
  help: string
  /** Why the first node fails, in axe's words (which part of the rule, which neighbour), trimmed. */
  why?: string
}

export interface ScanOptions {
  /** Selectors axe should not look inside (third-party widgets that have their own accessibility model). */
  exclude?: string[]
}

/**
 * Things that may sit over a target at one scroll position without failing target size (WCAG 2.5.8): each floats
 * above a scrolling list on purpose, the list scrolls the target out from under it, and keyboard focus never lands
 * beneath it (scroll-padding). axe measures one scroll position, so a target half under one of these is reported as
 * obscured; the node is dropped only when this is the one thing covering it. Documented in docs/validation/wcag-2.2.md.
 */
const SCROLL_OVERLAYS = ['.thread-sticky-prompt']

type AxeNode = { target: unknown[]; failureSummary?: string; any?: Array<{ relatedNodes?: Array<{ target: unknown[] }> }> }
const coveredOnlyByOverlay = (node: AxeNode): boolean => {
  const related = (node.any ?? []).flatMap(check => check.relatedNodes ?? []).map(item => item.target.join(' '))
  return related.length > 0 && related.every(target => SCROLL_OVERLAYS.some(selector => target.includes(selector)))
}

/**
 * Scans the current page and returns its violations. Terminals and the Monaco editor are
 * excluded by default: xterm draws to a canvas and Monaco ships its own screen-reader mode,
 * so axe's DOM rules say nothing useful about either.
 */
export async function scanSurface(page: Page, surface: string, options: ScanOptions = {}): Promise<Violation[]> {
  // Legacy mode runs axe in the page itself. The default mode finishes the run in a blank page
  // opened with context.newPage(), which Electron does not support. Only the main frame is
  // analysed, which is what is wanted here: the preview webviews are third-party content.
  let builder = new AxeBuilder({ page }).setLegacyMode(true).withTags(TAGS).exclude('.xterm').exclude('.monaco-editor').exclude('.monaco-diff-editor')
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector)
  // OXE_A11Y_STEPS=<file> records when each scan starts and ends. A clean surface writes nothing to the
  // report, so without this a test that stalls cannot be told apart from one that found nothing.
  const steps = process.env.OXE_A11Y_STEPS
  const note = (what: string): void => {
    if (!steps) return
    mkdirSync(dirname(steps), { recursive: true })
    appendFileSync(steps, `${new Date().toISOString().slice(11, 23)} ${what} ${surface}\n`)
  }
  note('start')
  const result = await builder.analyze()
  note(`end(${result.violations.length})`)
  return result.violations.flatMap(violation => {
    const nodes = violation.id === 'target-size' ? violation.nodes.filter(node => !coveredOnlyByOverlay(node as AxeNode)) : violation.nodes
    return nodes.length ? [{ ...violation, nodes }] : []
  }).map(violation => ({
    surface,
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map(node => node.target.join(' ').slice(0, 160)),
    why: violation.nodes[0]?.failureSummary?.replace(/\s+/g, ' ').slice(0, 300)
  }))
}

/** Appends violations as JSON lines to a report file (the test console is silenced). */
export function writeReport(path: string, violations: Violation[]): void {
  mkdirSync(dirname(path), { recursive: true })
  for (const violation of violations) appendFileSync(path, `${JSON.stringify(violation)}\n`)
}
