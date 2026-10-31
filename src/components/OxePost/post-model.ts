import type { PostRequestEntry, PostResponse } from '../../../shared/oxepost/types'

export interface QueryParam { name: string; value: string }

/** The query string of a URL as written (variables like `{{id}}` stay as they are), ignoring the fragment. */
export function queryParams(url: string): QueryParam[] {
  const hash = url.indexOf('#')
  const base = hash >= 0 ? url.slice(0, hash) : url
  const mark = base.indexOf('?')
  if (mark < 0 || mark === base.length - 1) return []
  return base.slice(mark + 1).split('&').filter(Boolean).map(pair => {
    const eq = pair.indexOf('=')
    return eq < 0 ? { name: pair, value: '' } : { name: pair.slice(0, eq), value: pair.slice(eq + 1) }
  })
}

/** The URL with its query replaced by `params`. A row with no name is left out. */
export function withParams(url: string, params: readonly QueryParam[]): string {
  const hash = url.indexOf('#')
  const fragment = hash >= 0 ? url.slice(hash) : ''
  const base = hash >= 0 ? url.slice(0, hash) : url
  const mark = base.indexOf('?')
  const head = mark >= 0 ? base.slice(0, mark) : base
  const query = params.filter(param => param.name !== '').map(param => `${param.name}=${param.value}`).join('&')
  return `${head}${query ? `?${query}` : ''}${fragment}`
}

/** JSON is shown indented; anything else as it came. */
export function prettyBody(body: string, contentType: string): string {
  if (!body || !(/json/i.test(contentType) || /^\s*[[{]/.test(body))) return body
  try { return JSON.stringify(JSON.parse(body), null, 2) } catch { return body }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

export type StatusTone = 'success' | 'info' | 'warning' | 'danger'
export function statusTone(status: number): StatusTone {
  return status >= 500 ? 'danger' : status >= 400 ? 'warning' : status >= 300 ? 'info' : 'success'
}

export interface Cookie { name: string; value: string; attributes: string }
/** The `Set-Cookie` headers of a response as rows. */
export function cookiesOf(response: Pick<PostResponse, 'headers'>): Cookie[] {
  return response.headers.filter(header => header.name.toLowerCase() === 'set-cookie').map(header => {
    const [pair = '', ...rest] = header.value.split(';')
    const eq = pair.indexOf('=')
    return { name: (eq < 0 ? pair : pair.slice(0, eq)).trim(), value: eq < 0 ? '' : pair.slice(eq + 1).trim(), attributes: rest.map(part => part.trim()).filter(Boolean).join('; ') }
  })
}

export interface RequestGroup { folder: string; entries: PostRequestEntry[] }
/** Requests by folder (the root first), filtered by name, method or path. */
export function groupRequests(entries: readonly PostRequestEntry[], filter: string): RequestGroup[] {
  const needle = filter.trim().toLowerCase()
  const shown = needle ? entries.filter(entry => `${entry.name} ${entry.method ?? ''} ${entry.path}`.toLowerCase().includes(needle)) : entries
  const groups = new Map<string, PostRequestEntry[]>()
  for (const entry of shown) groups.set(entry.folder, [...(groups.get(entry.folder) ?? []), entry])
  return [...groups.entries()].sort(([a], [b]) => a === b ? 0 : a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)).map(([folder, list]) => ({ folder, entries: list.sort((x, y) => x.name.localeCompare(y.name)) }))
}
