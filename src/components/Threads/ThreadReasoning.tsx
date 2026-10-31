import { useEffect, useRef, useState } from 'react'
import { Brain, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadEvent } from '../../../shared/types/thread'
import { i18n } from '../../i18n'

type Reasoning = Extract<ThreadEvent, { type: 'reasoning' }>

/** "Thought for 12s", or "Thinking…" while the block still streams. */
export function reasoningLabel(event: Reasoning, streaming: boolean): string {
  if (streaming) return i18n.t('thread:reasoning.thinking')
  if (event.completedAt === undefined) return i18n.t('thread:reasoning.thought')
  const seconds = Math.max(1, Math.round((event.completedAt - event.startedAt) / 1000))
  const duration = seconds >= 60 ? i18n.t('thread:reasoning.minutes', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 }) : i18n.t('thread:reasoning.seconds', { seconds })
  return i18n.t('thread:reasoning.thoughtFor', { duration })
}

/**
 * The agent's reasoning, open while it streams so the person can follow it and
 * collapsed once done; a choice the person makes by toggling it is kept.
 */
export function ThreadReasoning({ event, running }: { event: Reasoning; running: boolean }) {
  // Subscribes to the language, so the label follows a switch.
  useTranslation('thread')
  const streaming = running && event.completedAt === undefined
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? streaming
  const body = useRef<HTMLPreElement>(null)
  useEffect(() => {
    // Follows the latest thought while it streams, unless the person scrolled up to read.
    const element = body.current
    if (streaming && element && element.scrollHeight - element.scrollTop - element.clientHeight < 48) element.scrollTop = element.scrollHeight
  }, [event.text, streaming])
  return <details className={`thread-reasoning${streaming ? ' is-streaming' : ''}`} open={open} data-testid="thread-reasoning"
    onToggle={element => { const next = (element.currentTarget as HTMLDetailsElement).open; if (next !== open) setChosen(next) }}>
    <summary><ChevronDown size={12} aria-hidden="true" /><Brain size={12} aria-hidden="true" />{reasoningLabel(event, streaming)}</summary>
    <pre ref={body}>{event.text}</pre>
  </details>
}
