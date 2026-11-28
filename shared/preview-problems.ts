/**
 * What went wrong in the previewed page since it last loaded: console errors and requests that failed. The Browser
 * shows the count after a change and hands the list to an agent in one click, so "it broke" arrives with the evidence.
 */
import type { BrowserPreviewConsoleRow, BrowserPreviewNetworkRow } from './types/browser-preview'

export interface PreviewProblems {
  console: BrowserPreviewConsoleRow[]
  network: BrowserPreviewNetworkRow[]
}

export const NO_PREVIEW_PROBLEMS: PreviewProblems = { console: [], network: [] }
/** Enough to show a pattern; a page that logs an error per frame does not get to fill the prompt. */
export const MAX_PREVIEW_PROBLEMS = 20

/** Recognizes local development / LAN / file preview URLs (as opposed to public external websites). */
export function isLocalPreviewUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'file:') return true
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    return true
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!ipv4) return false
  const [a, b, c, d] = ipv4.slice(1).map(Number)
  if (a > 255 || b > 255 || c > 255 || d > 255) return false
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 0 && b === 0 && c === 0 && d === 0)
}

function isExternalSubresourceFailure(row: BrowserPreviewNetworkRow, pageUrl: string): boolean {
  if (isLocalPreviewUrl(pageUrl)) return false
  const resourceType = (row.type ?? '').toLowerCase()
  if (resourceType !== 'document' && resourceType !== 'mainframe') return true
  try {
    const pageOrigin = new URL(pageUrl).origin
    const rowOrigin = new URL(row.url).origin
    return rowOrigin !== pageOrigin
  } catch {
    return false
  }
}

/** A request the page asked for and did not get: a network error, or an answer of 400 and above. A cancelled one is not a problem. */
export function isFailedRequest(row: BrowserPreviewNetworkRow): boolean {
  return row.failed === 'error' || (typeof row.status === 'number' && row.status >= 400)
}

/** Adds what is a problem and drops what is not; the same message or request is kept once. */
export function addPreviewProblem(problems: PreviewProblems, row: BrowserPreviewConsoleRow | BrowserPreviewNetworkRow, pageUrl?: string): PreviewProblems {
  if ('level' in row) {
    if (row.level !== 'error' || problems.console.length >= MAX_PREVIEW_PROBLEMS) return problems
    if (problems.console.some(item => item.message === row.message && item.source === row.source && item.line === row.line)) return problems
    return { ...problems, console: [...problems.console, row] }
  }
  if (!isFailedRequest(row) || problems.network.length >= MAX_PREVIEW_PROBLEMS) return problems
  if (pageUrl && isExternalSubresourceFailure(row, pageUrl)) return problems
  if (problems.network.some(item => item.method === row.method && item.url === row.url && item.status === row.status)) return problems
  return { ...problems, network: [...problems.network, row] }
}

export const previewProblemCount = (problems: PreviewProblems): number => problems.console.length + problems.network.length

const oneLine = (text: string, max: number): string => { const flat = text.replace(/\s+/g, ' ').trim(); return flat.length > max ? `${flat.slice(0, max)}…` : flat }

/** The prompt block handed to the agent: where, what the console said, which requests failed. */
export function formatPreviewProblems(pageUrl: string, problems: PreviewProblems, note = ''): string {
  const lines = [`The web preview at ${pageUrl} shows problems since the page last loaded.`]
  if (problems.console.length > 0) {
    lines.push('', 'Console errors:')
    for (const row of problems.console) lines.push(`- ${oneLine(row.message, 400)}${row.source ? ` (${oneLine(row.source, 160)}${row.line ? `:${row.line}` : ''})` : ''}`)
  }
  if (problems.network.length > 0) {
    lines.push('', 'Failed requests:')
    for (const row of problems.network) {
      const detail = row.failed === 'error'
        ? (row.errorText?.trim() ? oneLine(row.errorText, 120) : 'network error')
        : row.status
      lines.push(`- ${row.method} ${oneLine(row.url, 300)} → ${detail}`)
    }
  }
  const request = note.trim()
  const defaultInstruction = isLocalPreviewUrl(pageUrl)
    ? 'Find the cause in the project and fix it.'
    : 'Inspect the errors above and explain what failed.'
  lines.push('', request ? `User request:\n${request}` : defaultInstruction)
  return lines.join('\n')
}

/**
 * What an agent that can see the preview is told with each message while "Auto-verify" is on: where the page is and
 * how to check its own change before it answers. The address is this machine's; nothing of the page goes in.
 */
export function previewVerifyNote(pageUrl: string): string {
  return [
    '',
    '',
    '<oxespace-preview>',
    `The app's preview is open at ${pageUrl} and you can see it. After you edit files that change the page, check the result before you finish: call oxespace_capture_web_preview for a screenshot and oxespace_preview_interact with action "console" for errors. Skip the check when your change cannot affect the page.`,
    '</oxespace-preview>'
  ].join('\n')
}
