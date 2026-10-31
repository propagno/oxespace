import { CornerUpLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useEffect, useState, type RefObject } from 'react'
import type { ThreadTimelineItem } from './threadTimelineModel'

/** Offset below the top edge where a jump places its row and where the turn being read is measured. */
const READING_LINE_PX = 48

/** Indexes of the rows that hold a person's prompt, in timeline order. */
export function promptRowIndexes(rows: Pick<ThreadTimelineItem, 'event'>[]): number[] {
  return rows.flatMap((row, index) => row.event.type === 'message' && row.event.role === 'user' ? [index] : [])
}

/** The prompt to move to from `current` (the prompt of the turn in view), in `direction`. */
export function adjacentPrompt(prompts: number[], current: number | undefined, direction: -1 | 1): number | undefined {
  if (!prompts.length) return undefined
  if (current === undefined) return direction < 0 ? prompts.at(-1) : prompts[0]
  const position = prompts.indexOf(current)
  if (position < 0) return direction < 0 ? [...prompts].reverse().find(index => index < current) : prompts.find(index => index > current)
  return prompts[position + direction]
}

/**
 * Keeps the prompt of the turn being read in view: when that prompt has scrolled above the top of the
 * conversation, it is shown in a strip there; clicking it scrolls back to it. Alt+Up and Alt+Down move to
 * the previous or next prompt from anywhere in the conversation, the composer included.
 */
export function ThreadPromptNavigator({ rows, scrollRef, scrollTo }: {
  rows: ThreadTimelineItem[]
  scrollRef: RefObject<HTMLElement | null>
  scrollTo: (index: number) => void
}) {
  const { t } = useTranslation('thread')
  const [inView, setInView] = useState<{ turnId: string; hidden: boolean } | null>(null)
  const prompts = promptRowIndexes(rows)

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    let frame = 0
    const update = (): void => {
      frame = 0
      const top = scroller.getBoundingClientRect().top
      // The turn being read is the one crossing the reading line, which sits where a jump places a prompt
      // (48 px below the edge, see useThreadVirtualizer.scrollToIndex); a sliver of the previous turn above it
      // does not count, or Alt+Down would land on the prompt already in view.
      const line = top + READING_LINE_PX
      const first = [...scroller.querySelectorAll<HTMLElement>('[data-turn-id]')].find(node => node.getBoundingClientRect().bottom > line)
      const turnId = first?.dataset.turnId
      if (!turnId) { setInView(null); return }
      const promptNode = scroller.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(turnId)}"].is-turn-start`)
      const hidden = !promptNode || promptNode.getBoundingClientRect().bottom < top + 4
      setInView(current => current?.turnId === turnId && current.hidden === hidden ? current : { turnId, hidden })
    }
    const schedule = (): void => { if (!frame) frame = requestAnimationFrame(update) }
    schedule()
    scroller.addEventListener('scroll', schedule, { passive: true })
    return () => { scroller.removeEventListener('scroll', schedule); if (frame) cancelAnimationFrame(frame) }
  }, [scrollRef, rows])

  const current = inView ? rows.findIndex(row => row.turnId === inView.turnId && row.event.type === 'message' && row.event.role === 'user') : -1
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.altKey || event.ctrlKey || event.metaKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      if (!scrollRef.current?.closest('.thread-workbench')?.contains(document.activeElement)) return
      const target = adjacentPrompt(prompts, current < 0 ? undefined : current, event.key === 'ArrowUp' ? -1 : 1)
      if (target === undefined) return
      event.preventDefault()
      scrollTo(target)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prompts, current, scrollTo, scrollRef])

  const prompt = current >= 0 ? rows[current].event : undefined
  if (!inView?.hidden || prompt?.type !== 'message') return null
  return <button type="button" className="thread-sticky-prompt" data-testid="thread-sticky-prompt" onClick={() => scrollTo(current)}
    title={t('navigator.back')}>
    <CornerUpLeft size={13} aria-hidden="true" />
    <span>{prompt.text.trim().split(/\r?\n/)[0]}</span>
  </button>
}
