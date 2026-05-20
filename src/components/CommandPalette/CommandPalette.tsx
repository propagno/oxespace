import { History, Search, X, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'

export interface CommandPaletteAction {
  id: string
  title: string
  subtitle?: string
  disabled?: boolean
  /** Lucide icon component (optional — falls back to a category-derived dot). */
  icon?: LucideIcon
  /** Group label shown as a sticky header. Defaults to "General". */
  category?: string
  /** Extra search terms (synonyms) that should match this command. */
  keywords?: string[]
  run: () => void
}

interface CommandPaletteProps {
  actions: CommandPaletteAction[]
  onClose: () => void
}

interface ScoredAction extends CommandPaletteAction {
  score: number
}

const RECENTS_KEY = 'oxe.commandPalette.recents'
const RECENTS_LIMIT = 5

// Cheap fuzzy ranker: exact match > prefix > word-prefix > substring > fuzzy
// (chars appear in order). Returns a positive score, or 0 when there is no
// match. The numbers are not normalized — we only need a total ordering.
function score(haystack: string, needle: string): number {
  if (!needle) return 1
  const hay = haystack.toLowerCase()
  const ned = needle.toLowerCase()
  if (hay === ned) return 1000
  if (hay.startsWith(ned)) return 500
  // word-prefix: any word in haystack starts with needle
  if (hay.split(/[\s:.-]+/).some((w) => w.startsWith(ned))) return 300
  if (hay.includes(ned)) return 100
  // ordered char-by-char fuzzy
  let hi = 0
  let matched = 0
  for (const ch of ned) {
    const found = hay.indexOf(ch, hi)
    if (found < 0) return 0
    matched += 1
    hi = found + 1
  }
  return matched >= ned.length ? 30 : 0
}

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, RECENTS_LIMIT)
  } catch {
    return []
  }
}

function pushRecent(id: string): void {
  try {
    const current = loadRecents().filter((v) => v !== id)
    current.unshift(id)
    localStorage.setItem(RECENTS_KEY, JSON.stringify(current.slice(0, RECENTS_LIMIT)))
  } catch {
    // localStorage may be unavailable in tests — degrade silently.
  }
}

export function CommandPalette({ actions, onClose }: CommandPaletteProps): ReactElement {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [recentIds] = useState<string[]>(() => loadRecents())

  // Build flat ordered list + a parallel index → action map for keyboard nav.
  const { groups, flatItems } = useMemo(() => {
    const needle = query.trim()
    const recentSet = new Set(recentIds)

    if (!needle) {
      // Empty query: show "Recents" group first, then groups by category.
      const recents = recentIds
        .map((id) => actions.find((a) => a.id === id))
        .filter((a): a is CommandPaletteAction => a !== undefined && !a.disabled)

      const byCategory = new Map<string, CommandPaletteAction[]>()
      for (const action of actions) {
        if (recentSet.has(action.id) && recents.length > 0) continue
        const key = action.category ?? 'General'
        const bucket = byCategory.get(key) ?? []
        bucket.push(action)
        byCategory.set(key, bucket)
      }

      const out: Array<{ label: string; items: CommandPaletteAction[] }> = []
      if (recents.length > 0) out.push({ label: 'Recent', items: recents })
      for (const [label, items] of byCategory) out.push({ label, items })
      return { groups: out, flatItems: out.flatMap((g) => g.items) }
    }

    // Score every action and keep the matches, ranked.
    const scored: ScoredAction[] = []
    for (const action of actions) {
      const haystack = [action.title, action.subtitle ?? '', ...(action.keywords ?? [])].join(' ')
      const s = score(haystack, needle)
      if (s > 0) scored.push({ ...action, score: s })
    }
    scored.sort((a, b) => b.score - a.score)
    return { groups: [{ label: 'Results', items: scored }], flatItems: scored }
  }, [actions, query, recentIds])

  // Reset highlight whenever the result set changes shape.
  useEffect(() => { setActiveIndex(0) }, [query, flatItems.length])

  // Keep the highlighted row scrolled into view on keyboard nav.
  useEffect(() => {
    if (!listRef.current) return
    const target = listRef.current.querySelector<HTMLElement>(`[data-cp-index="${activeIndex}"]`)
    // jsdom test envs leave scrollIntoView undefined — fall through silently.
    if (typeof target?.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  const runAction = (action: CommandPaletteAction): void => {
    if (action.disabled) return
    pushRecent(action.id)
    action.run()
    onClose()
  }

  const handleKey = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => Math.min(flatItems.length - 1, i + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => Math.max(0, i - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const target = flatItems[activeIndex]
      if (target) runAction(target)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  let flatIndex = 0

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="command-palette command-palette-v2"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="command-palette-search">
          <Search size={16} aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleKey}
            placeholder="Type a command or search…"
            aria-label="Command palette search"
            aria-controls="command-palette-list"
            aria-activedescendant={flatItems[activeIndex] ? `cp-item-${flatItems[activeIndex].id}` : undefined}
          />
          <button type="button" className="icon-button" aria-label="Close command palette" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </header>
        <div id="command-palette-list" className="command-palette-list command-palette-list-v2" ref={listRef} role="listbox">
          {groups.map((group) => (
            <section key={group.label} className="command-palette-group">
              <header className="command-palette-group-header">
                {group.label === 'Recent' ? <History size={10} aria-hidden="true" /> : null}
                <span>{group.label}</span>
              </header>
              {group.items.map((action) => {
                const idx = flatIndex++
                const Icon = action.icon
                return (
                  <button
                    key={action.id}
                    id={`cp-item-${action.id}`}
                    type="button"
                    role="option"
                    aria-selected={idx === activeIndex}
                    data-cp-index={idx}
                    className={`command-palette-item-v2${idx === activeIndex ? ' active' : ''}`}
                    disabled={action.disabled}
                    onClick={() => runAction(action)}
                    onMouseEnter={() => setActiveIndex(idx)}
                  >
                    <span className="cp-item-icon" aria-hidden="true">
                      {Icon ? <Icon size={14} /> : <span className="cp-item-dot" />}
                    </span>
                    <span className="cp-item-body">
                      <span className="cp-item-title">{action.title}</span>
                      {action.subtitle ? <span className="cp-item-subtitle">{action.subtitle}</span> : null}
                    </span>
                  </button>
                )
              })}
            </section>
          ))}
          {flatItems.length === 0 ? <div className="command-palette-empty">No commands match "{query}"</div> : null}
        </div>
        <footer className="command-palette-footer">
          <kbd>↑ ↓</kbd> navigate
          <kbd>↵</kbd> run
          <kbd>Esc</kbd> close
        </footer>
      </section>
    </div>
  )
}
