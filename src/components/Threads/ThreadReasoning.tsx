import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadEvent } from '../../../shared/types/thread'
import { i18n } from '../../i18n'
import { Button } from '../../ui'

type Reasoning = Extract<ThreadEvent, { type: 'reasoning' }>

/** "Thought for 12s", or "Thinking…" while the block still streams. */
export function reasoningLabel(event: Reasoning, streaming: boolean): string {
  if (streaming) return i18n.t('thread:reasoning.thinking')
  if (event.completedAt === undefined) return i18n.t('thread:reasoning.thought')
  const seconds = Math.max(1, Math.round((event.completedAt - event.startedAt) / 1000))
  const duration = seconds >= 60 ? i18n.t('thread:reasoning.minutes', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 }) : i18n.t('thread:reasoning.seconds', { seconds })
  return i18n.t('thread:reasoning.thoughtFor', { duration })
}

/** The latest lines of a thought, the ones still on screen while it streams. */
function previewLines(text: string): string {
  return text.split('\n').filter(line => line.trim()).slice(-3).join('\n')
}

/**
 * The agent's reasoning, open while it streams so the person can follow it and
 * collapsed once done; a choice the person makes by toggling it is kept.
 * The root stays a details element so a saved choice (the toggle event) is kept.
 */
export function ThreadReasoning({ event, running }: { event: Reasoning; running: boolean }) {
  // Subscribes to the language, so the label follows a switch.
  useTranslation('thread')
  const streaming = running && event.completedAt === undefined
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? streaming
  const paragraphs = event.text.split('\n').map(line => line.trim()).filter(Boolean)
  return <details className={`thread-reasoning${streaming ? ' is-streaming' : ''}`} open={open} data-testid="thread-reasoning" data-ui="reasoning" data-state={streaming ? 'streaming' : 'done'}
    onToggle={element => { const next = (element.currentTarget as HTMLDetailsElement).open; if (next !== open) setChosen(next) }}>
    <summary onClick={event => event.preventDefault()}>
      {streaming && <span className="thread-reasoning-pulse" data-ui="reasoning-pulse" aria-hidden="true" />}
      <Button variant="ghost" size="sm" aria-expanded={open} onClick={click => { click.preventDefault(); setChosen(!open) }}>{reasoningLabel(event, streaming)}</Button>
    </summary>
    {streaming && <div className="thread-reasoning-preview">{previewLines(event.text)}</div>}
    {open && !streaming && <div className="thread-reasoning-body">{paragraphs.map((line, index) => <p key={index}>{line}</p>)}</div>}
  </details>
}
