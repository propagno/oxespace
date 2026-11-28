/**
 * Structured context items attached to the OxeChat composer (OXE-478):
 * dropped files/folders, auto-collapsed long pastes (>10k chars), and
 * first-class @changes / @terminal / @folder / @thread context sources.
 */

export type ComposerContextKind = 'file' | 'folder' | 'pasted-text' | 'changes' | 'terminal' | 'thread'

export type ComposerContextItem =
  | {
      id: string
      kind: 'file'
      path: string
      label: string
      isRelative: boolean
    }
  | {
      id: string
      kind: 'folder'
      path: string
      label: string
      isRelative: boolean
    }
  | {
      id: string
      kind: 'pasted-text'
      label: string
      content: string
      lineCount: number
      charCount: number
    }
  | {
      id: string
      kind: 'changes'
      label: string
    }
  | {
      id: string
      kind: 'terminal'
      label: string
      paneId?: string
    }
  | {
      id: string
      kind: 'thread'
      targetThreadId: string
      label: string
    }

export const MAX_COMPOSER_CONTEXT_ITEMS = 16

/** Strips surrounding quotes, decodes file:// URIs, and unifies slashes cleanly. */
export function cleanRawPath(raw: string): string {
  let value = raw.trim()
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    value = value.slice(1, -1).trim()
  }
  if (/^file:\/\//i.test(value)) {
    value = value.replace(/^file:\/\/(?:localhost)?/i, '')
    try { value = decodeURIComponent(value) } catch { /* keep raw URI text */ }
  }
  return value
    .replace(/\\/g, '/')
    .replace(/^\/\/\?\/(?=[A-Za-z]:(?:\/|$))/, '')
    .replace(/^\/+(?=[A-Za-z]:(?:\/|$))/, '')
}

function isCaseInsensitivePath(path: string): boolean {
  return /^[a-z]:\//i.test(path) || /^[a-z]:$/i.test(path) || path.startsWith('//')
}

function compareKey(path: string): string {
  return isCaseInsensitivePath(path) ? path.toLowerCase() : path
}

function isAbsoluteNormalized(path: string): boolean {
  return path.startsWith('/') || /^[a-z]:\//i.test(path) || /^[a-z]:$/i.test(path)
}

function trimTrailingSlashes(path: string): string {
  if (path === '/' || /^[a-z]:\/$/i.test(path)) return path
  return path.replace(/\/+$/, '')
}

export interface NormalizedDroppedPath {
  path: string
  isRelative: boolean
  label: string
}

/**
 * Normalizes a dropped OS or explorer path relative to the thread's checkout root when inside it,
 * or keeps a clean normalized absolute path when outside the workspace.
 */
export function normalizeDroppedPath(rawPath: string, rootPath?: string): NormalizedDroppedPath | null {
  if (!rawPath || rawPath.includes('\0')) return null
  const cleaned = trimTrailingSlashes(cleanRawPath(rawPath))
  if (!cleaned) return null

  const normalizedRoot = rootPath ? trimTrailingSlashes(cleanRawPath(rootPath)) : ''
  if (normalizedRoot && isAbsoluteNormalized(cleaned)) {
    const cleanKey = compareKey(cleaned)
    const rootKey = compareKey(normalizedRoot)
    if (cleanKey === rootKey) {
      return { path: '.', isRelative: true, label: '.' }
    }
    const prefix = rootKey.endsWith('/') ? rootKey : `${rootKey}/`
    if (cleanKey.startsWith(prefix)) {
      const rel = cleaned.slice(normalizedRoot.endsWith('/') ? normalizedRoot.length : normalizedRoot.length + 1)
      if (rel) {
        const base = rel.slice(rel.lastIndexOf('/') + 1) || rel
        return { path: rel, isRelative: true, label: base }
      }
    }
    const base = cleaned.slice(cleaned.lastIndexOf('/') + 1) || cleaned
    return { path: cleaned, isRelative: false, label: base }
  }

  if (isAbsoluteNormalized(cleaned)) {
    const base = cleaned.slice(cleaned.lastIndexOf('/') + 1) || cleaned
    return { path: cleaned, isRelative: false, label: base }
  }

  const rel = cleaned.replace(/^\.\//, '')
  if (!rel || rel === '.') return { path: '.', isRelative: true, label: '.' }
  const base = rel.slice(rel.lastIndexOf('/') + 1) || rel
  return { path: rel, isRelative: true, label: base }
}

/** Parses RFC 2483 `text/uri-list` payload into local file paths/URIs. */
export function parseUriList(raw: string): string[] {
  if (!raw) return []
  const out: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (/^file:\/\//i.test(trimmed)) out.push(trimmed)
  }
  return out
}

export function createFileContextItem(
  rawPath: string,
  rootPath?: string,
  kind: 'file' | 'folder' = 'file'
): Extract<ComposerContextItem, { kind: 'file' | 'folder' }> | null {
  const normalized = normalizeDroppedPath(rawPath, rootPath)
  if (!normalized) return null
  const dedupeKey = compareKey(normalized.path)
  const label = kind === 'folder' && normalized.label !== '.' ? `${normalized.label}/` : normalized.label
  return {
    id: `${kind}:${dedupeKey}`,
    kind,
    path: normalized.path,
    label,
    isRelative: normalized.isRelative
  }
}

let pasteCounter = 0

export function countTextLines(text: string): number {
  if (!text) return 0
  return text.split(/\r\n|\r|\n/).length
}

export function createPastedTextItem(content: string, id?: string): Extract<ComposerContextItem, { kind: 'pasted-text' }> {
  pasteCounter += 1
  const lineCount = countTextLines(content)
  return {
    id: id ?? `paste:${Date.now()}:${pasteCounter}`,
    kind: 'pasted-text',
    label: 'Pasted text',
    content,
    lineCount,
    charCount: content.length
  }
}

export function createChangesContextItem(): Extract<ComposerContextItem, { kind: 'changes' }> {
  return {
    id: 'context:changes',
    kind: 'changes',
    label: '@changes'
  }
}

export function createTerminalContextItem(paneId?: string, paneLabel?: string): Extract<ComposerContextItem, { kind: 'terminal' }> {
  const cleanPane = paneId?.trim() || undefined
  return {
    id: cleanPane ? `context:terminal:${cleanPane}` : 'context:terminal:active',
    kind: 'terminal',
    label: paneLabel?.trim() ? `@terminal · ${paneLabel.trim()}` : '@terminal',
    ...(cleanPane ? { paneId: cleanPane } : {})
  }
}

export function createThreadContextItem(targetThreadId: string, title: string): Extract<ComposerContextItem, { kind: 'thread' }> {
  const cleanTitle = title.trim() || targetThreadId
  return {
    id: `context:thread:${targetThreadId}`,
    kind: 'thread',
    targetThreadId,
    label: cleanTitle
  }
}

const SIMPLE_FILE_MENTION = /^(?:[\w.-]+\/)*[\w.-]+\.[\w-]+$/
const SIMPLE_FOLDER_MENTION = /^(?:\.|(?:[\w.-]+\/)*[\w.-]+)$/
const SAFE_ID_TOKEN = /^[A-Za-z0-9_.:/-]+$/

/** Formats one composer context item into its deterministic outgoing directive or delimited block. */
export function formatContextDirective(item: ComposerContextItem): string {
  switch (item.kind) {
    case 'file': {
      if (!item.isRelative) return `[File: ${item.path}]`
      if (SIMPLE_FILE_MENTION.test(item.path)) return `@${item.path}`
      return `@"${item.path.replace(/"/g, '')}"`
    }
    case 'folder': {
      if (!item.isRelative) return `[Folder: ${item.path}]`
      if (SIMPLE_FOLDER_MENTION.test(item.path)) return `@folder:${item.path}`
      return `@folder:"${item.path.replace(/"/g, '')}"`
    }
    case 'changes':
      return '@changes'
    case 'terminal':
      return item.paneId && SAFE_ID_TOKEN.test(item.paneId) ? `@terminal:${item.paneId}` : '@terminal'
    case 'thread':
      return SAFE_ID_TOKEN.test(item.targetThreadId) ? `@thread:${item.targetThreadId}` : `[Thread: ${item.label}]`
    case 'pasted-text':
      return `<pasted_text lines="${item.lineCount}" chars="${item.charCount}">\n${item.content}\n</pasted_text>`
  }
}

/**
 * Serializes attached composer context chips together with the prompt text at send time.
 * Keeps inline directives deduplicated against text already typed by the user and preserves
 * pasted-text attachments in order with clear delimiters.
 */
export function composeMessageWithContext(text: string, items: readonly ComposerContextItem[]): string {
  if (items.length === 0) return text
  const trimmed = text.trim()
  const directives: string[] = []
  const pastedBlocks: string[] = []
  const seen = new Set<string>()

  for (const item of items) {
    if (item.kind === 'pasted-text') {
      pastedBlocks.push(formatContextDirective(item))
      continue
    }
    const token = formatContextDirective(item)
    if (seen.has(token)) continue
    seen.add(token)
    if (trimmed && containsDirectiveToken(trimmed, token)) continue
    directives.push(token)
  }

  const sections: string[] = []
  if (trimmed) sections.push(trimmed)
  if (directives.length > 0) sections.push(directives.join(' '))
  if (pastedBlocks.length > 0) sections.push(pastedBlocks.join('\n\n'))
  return sections.join('\n\n')
}

function containsDirectiveToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\s)${escaped}(?=$|[\\s,;:!?)\\]])`).test(text)
}

/** Computes the total character count of the outgoing message including pasted-text attachments. */
export function composerContentLength(draft: string, items: readonly ComposerContextItem[]): number {
  if (items.length === 0) return draft.length
  return composeMessageWithContext(draft, items).length
}

/** Extracts sorted unique ancestor directories from a tracked file list (always includes '.' when non-empty). */
export function extractWorkspaceFolders(files: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '')
    let slash = normalized.indexOf('/')
    while (slash > 0) {
      seen.add(normalized.slice(0, slash))
      slash = normalized.indexOf('/', slash + 1)
    }
  }
  const sorted = [...seen].sort((a, b) => a.localeCompare(b))
  return ['.', ...sorted]
}
