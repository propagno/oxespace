import { useEffect, useMemo, useRef, useState, type UIEvent, type WheelEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadEvent } from '../../../shared/types/thread'
import { i18n } from '../../i18n'
import { useThreadPrefs, type ThinkingStyle } from '../../store/thread-prefs.store'
import { Button } from '../../ui'
import { ThreadMarkdown } from './ThreadMarkdown'
import './ThreadReasoning.css'

type Reasoning = Extract<ThreadEvent, { type: 'reasoning' }>

export const REASONING_HEADING_MAX_CHARS = 72
export const REASONING_PREVIEW_BOTTOM_THRESHOLD_PX = 16

const FENCE_LINE = /^\s*(`{3,}|~{3,})/
const ATX_HEADING_LINE = /^\s*#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?\s*$/
const STANDALONE_BOLD_LINE = /^\s*(?:\*\*([^*\n]+?)\*\*|__([^_\n]+?)__)\s*[:;.,!?…—–-]*\s*$/
const TRAILING_PUNCTUATION = /[\s:;.,!?…—–-]+$/u

function cleanHeadingText(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TRAILING_PUNCTUATION, '')
    .trim()
}

function capHeadingLength(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const slice = text.slice(0, Math.max(1, maxChars - 1))
  const lastSpace = slice.lastIndexOf(' ')
  const cut = lastSpace >= Math.floor(maxChars * 0.6) ? slice.slice(0, lastSpace) : slice
  const trimmed = cut.replace(TRAILING_PUNCTUATION, '').trim()
  return `${trimmed || slice.trim()}…`
}

/**
 * Extracts the latest editorial heading (`**Checking migration lock**`, `### Analyzing auth`, or standalone `__...__`)
 * from streaming or completed reasoning text, skipping fenced code blocks, trimming trailing punctuation/colons,
 * and capping length cleanly. Zero LLM calls.
 */
export function extractActiveReasoningHeading(
  text: string,
  maxChars: number = REASONING_HEADING_MAX_CHARS
): string | null {
  if (!text) return null
  let activeFence: { char: string; length: number } | null = null
  let latest: string | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const fence = FENCE_LINE.exec(rawLine)
    if (fence) {
      const marker = fence[1]
      const char = marker[0]
      if (!activeFence) {
        activeFence = { char, length: marker.length }
      } else if (activeFence.char === char && marker.length >= activeFence.length && rawLine.trim() === marker) {
        activeFence = null
      }
      continue
    }
    if (activeFence) continue

    const line = rawLine.trim()
    if (!line) continue

    const atx = ATX_HEADING_LINE.exec(line)
    const bold = atx ? null : STANDALONE_BOLD_LINE.exec(line)
    const candidate = atx?.[1] ?? bold?.[1] ?? bold?.[2]
    if (!candidate) continue

    const cleaned = cleanHeadingText(candidate)
    if (cleaned) latest = capHeadingLength(cleaned, maxChars)
  }

  return latest
}

/** True when a scrollable reasoning preview is at or within `threshold` px of its bottom edge. */
export function isNearReasoningBottom(
  metrics: { scrollTop: number; clientHeight: number; scrollHeight: number },
  threshold: number = REASONING_PREVIEW_BOTTOM_THRESHOLD_PX
): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= threshold
}

function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-motion') === 'reduce') return true
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }
  return false
}

/** "Thought for 12s", or "Thinking…" while the block still streams. */
export function reasoningLabel(event: Reasoning, streaming: boolean): string {
  if (streaming) return i18n.t('thread:reasoning.thinking')
  if (event.completedAt === undefined) return i18n.t('thread:reasoning.thought')
  const seconds = Math.max(1, Math.round((event.completedAt - event.startedAt) / 1000))
  const duration = seconds >= 60 ? i18n.t('thread:reasoning.minutes', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 }) : i18n.t('thread:reasoning.seconds', { seconds })
  return i18n.t('thread:reasoning.thoughtFor', { duration })
}

export interface ThreadReasoningProps {
  event: Reasoning
  running: boolean
  thinkingStyle?: ThinkingStyle
}

/**
 * The agent's reasoning block (OXE-475):
 * - Streams inside a bounded 160px auto-scrolling Markdown preview (pausing if the user scrolls up, resuming near bottom)
 *   with a quiet active heading subtitle extracted from `**...**` / `### ...` lines.
 * - Expands into compact, muted editorial Markdown (`ThreadMarkdown`) instead of raw paragraphs.
 * - Honors `thinkingStyle` (`preview` | `collapsed` | `expanded`) from prop or `useThreadPrefs`, while preserving any
 *   explicit toggle the person makes on the `<details>` root.
 */
export function ThreadReasoning({ event, running, thinkingStyle }: ThreadReasoningProps) {
  // Subscribes to the language, so the label follows a switch.
  useTranslation('thread')
  const prefThinkingStyle = useThreadPrefs(state => state.thinkingStyle)
  const style: ThinkingStyle = thinkingStyle ?? prefThinkingStyle
  const streaming = running && event.completedAt === undefined
  const [chosen, setChosen] = useState<boolean | null>(null)
  const defaultOpen = style === 'expanded' ? true : style === 'collapsed' ? false : streaming
  const open = chosen ?? defaultOpen
  const showPreview = open && streaming && style !== 'expanded'
  const showBody = open && (!streaming || style === 'expanded')

  const activeHeading = useMemo(
    () => (streaming ? extractActiveReasoningHeading(event.text) : null),
    [streaming, event.text]
  )

  const previewRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const lastScrollTopRef = useRef(0)

  useEffect(() => {
    if (showPreview) {
      autoScrollRef.current = true
      lastScrollTopRef.current = 0
    }
  }, [showPreview])

  useEffect(() => {
    if (!showPreview || !autoScrollRef.current) return
    const element = previewRef.current
    if (!element) return
    const target = Math.max(0, element.scrollHeight - element.clientHeight)
    if (target <= 0) return
    if (typeof element.scrollTo === 'function') {
      element.scrollTo({ top: target, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    } else {
      element.scrollTop = target
      lastScrollTopRef.current = target
    }
  }, [event.text, showPreview])

  const handlePreviewWheel = (wheel: WheelEvent<HTMLDivElement>): void => {
    if (wheel.deltaY < 0) autoScrollRef.current = false
  }

  const handlePreviewScroll = (scroll: UIEvent<HTMLDivElement>): void => {
    const element = scroll.currentTarget
    if (isNearReasoningBottom(element)) {
      autoScrollRef.current = true
    } else if (element.scrollTop < lastScrollTopRef.current - 1) {
      autoScrollRef.current = false
    }
    lastScrollTopRef.current = element.scrollTop
  }

  return (
    <details
      className={`thread-reasoning${streaming ? ' is-streaming' : ''}`}
      open={open}
      data-testid="thread-reasoning"
      data-ui="reasoning"
      data-state={streaming ? 'streaming' : 'done'}
      data-thinking-style={style}
      onToggle={element => {
        const next = (element.currentTarget as HTMLDetailsElement).open
        if (next !== open) setChosen(next)
      }}
    >
      <summary onClick={click => click.preventDefault()}>
        {streaming && <span className="thread-reasoning-pulse" data-ui="reasoning-pulse" aria-hidden="true" />}
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={click => {
            click.preventDefault()
            setChosen(!open)
          }}
        >
          {(!streaming || !open) && <ChevronRight size={12} aria-hidden="true" className="thread-reasoning-chevron" />}
          <span className="thread-reasoning-label">{reasoningLabel(event, streaming)}</span>
          {streaming && activeHeading && (
            <>
              <span className="thread-reasoning-sep" aria-hidden="true">·</span>
              <span className="thread-reasoning-subtitle" data-ui="reasoning-subtitle" title={activeHeading}>{activeHeading}</span>
            </>
          )}
        </Button>
      </summary>
      {showPreview && (
        <div
          ref={previewRef}
          className="thread-reasoning-preview"
          data-ui="reasoning-preview"
          onWheel={handlePreviewWheel}
          onScroll={handlePreviewScroll}
        >
          <ThreadMarkdown text={event.text} streaming className="thread-reasoning-markdown" />
        </div>
      )}
      {showBody && (
        <ThreadMarkdown
          text={event.text}
          streaming={streaming}
          className="thread-reasoning-body thread-reasoning-markdown"
        />
      )}
    </details>
  )
}
