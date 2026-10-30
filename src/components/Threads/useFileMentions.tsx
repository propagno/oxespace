import { File } from 'lucide-react'
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

/** Matches the `@partial/path` the caret is currently inside. */
const MENTION = /(^|\s)@([^\s@]*)$/
const MAX_RESULTS = 8
const CACHE_MS = 60_000
const cache = new Map<string, { at: number; files: string[] }>()

/** Ranks basename prefix matches first, then path substring matches. Pure, so it is testable. */
export function rankMentionFiles(files: string[], query: string, limit = MAX_RESULTS): string[] {
  const needle = query.trim().toLowerCase().replace(/\\/g, '/')
  if (!needle) return files.slice(0, limit)
  const scored: Array<{ file: string; score: number }> = []
  for (const file of files) {
    const lower = file.toLowerCase()
    const base = lower.slice(lower.lastIndexOf('/') + 1)
    const score = base.startsWith(needle) ? 0 : base.includes(needle) ? 1 : lower.includes(needle) ? 2 : -1
    if (score >= 0) scored.push({ file, score })
    if (scored.length > 400) break
  }
  return scored.sort((a, b) => a.score - b.score || a.file.length - b.file.length).slice(0, limit).map(entry => entry.file)
}

export function activeMention(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret)
  const match = MENTION.exec(before)
  return match ? { query: match[2], start: before.length - match[2].length - 1 } : null
}

/** `@` file mentions for the Thread composer: a small autocomplete over the project's tracked files. */
export function useFileMentions({ workspaceId, rootPath, draft, caret, enabled, onApply }: {
  workspaceId?: string; rootPath?: string; draft: string; caret: number; enabled: boolean
  /** Receives the new text and the caret position that should follow it. */
  onApply(text: string, caret: number): void
}): { popup: ReactElement | null; onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean } {
  const { t } = useTranslation('thread')
  const mention = enabled ? activeMention(draft, caret) : null
  const [files, setFiles] = useState<string[]>([])
  const [selected, setSelected] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const key = workspaceId && rootPath ? `${workspaceId}:${rootPath}` : null

  useEffect(() => {
    if (!mention || !key || !workspaceId || !rootPath) return
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < CACHE_MS) { setFiles(hit.files); return }
    let active = true
    void window.oxe.search?.listFiles({ workspaceId, rootPath }).then(result => {
      const list = Array.isArray(result?.files) ? result.files : []
      cache.set(key, { at: Date.now(), files: list })
      if (active) setFiles(list)
    }, () => undefined)
    return () => { active = false }
  }, [Boolean(mention), key, workspaceId, rootPath])

  const results = useMemo(() => mention ? rankMentionFiles(files, mention.query) : [], [files, mention?.query])
  useEffect(() => { setSelected(0) }, [mention?.query])
  const open = Boolean(mention && results.length && dismissed !== `${mention.start}:${draft.length}`)

  const pick = (file: string): void => {
    if (!mention) return
    const insert = `@${file} `
    const next = draft.slice(0, mention.start) + insert + draft.slice(caret)
    onApply(next, mention.start + insert.length)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(value => (value + 1) % results.length); return true }
    if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(value => (value - 1 + results.length) % results.length); return true }
    if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); pick(results[selected] ?? results[0]); return true }
    if (event.key === 'Escape' && mention) { event.preventDefault(); setDismissed(`${mention.start}:${draft.length}`); return true }
    return false
  }

  const popup = open ? <div className="thread-mention-menu" role="listbox" aria-label={t('composer.files')}>
    {results.map((file, index) => {
      const slash = file.lastIndexOf('/')
      return <button key={file} type="button" role="option" aria-selected={index === selected} className={index === selected ? 'is-selected' : undefined}
        onMouseDown={event => { event.preventDefault(); pick(file) }} onMouseEnter={() => setSelected(index)}>
        <File size={14} aria-hidden="true" /><strong>{file.slice(slash + 1)}</strong><small>{slash > 0 ? file.slice(0, slash) : ''}</small>
      </button>
    })}
  </div> : null

  return { popup, onKeyDown }
}
