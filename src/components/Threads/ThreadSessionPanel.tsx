import { useRef, useState, type PointerEvent, type ReactElement } from 'react'
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, GripVertical, MoreHorizontal, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton, Menu, Panel } from '../../ui'
import { moveSection, readSectionOrder, SESSION_SECTIONS, writeSectionOrder, type SessionSectionId } from './threadSessionModel'
import { SessionBackground, SessionContextSection, SessionEnvironment, SessionOutputs, SessionTools, type SessionSectionProps } from './ThreadSessionSections'
import styles from './ThreadSessionPanel.module.css'

const BODIES: Record<SessionSectionId, (props: SessionSectionProps) => ReactElement> = {
  environment: SessionEnvironment, context: SessionContextSection, tools: SessionTools, outputs: SessionOutputs, background: SessionBackground
}

/**
 * Everything about the conversation in the side panel: environment, context, tools and MCP, outputs and
 * background work. Sections are reordered by dragging their grip or, without dragging (WCAG 2.5.7),
 * from each section's menu; the order is kept per viewer.
 */
export function ThreadSessionPanel(props: SessionSectionProps): ReactElement {
  const { t } = useTranslation('thread')
  const [order, setOrder] = useState<SessionSectionId[]>(readSectionOrder)
  const [announcement, setAnnouncement] = useState('')
  const [dragging, setDragging] = useState<SessionSectionId | null>(null)
  const [drop, setDrop] = useState<{ id: SessionSectionId; after: boolean } | null>(null)
  const triggers = useRef(new Map<SessionSectionId, HTMLButtonElement>())
  const title = (id: SessionSectionId): string => t(`sessionPanel.sections.${id}`)

  const commit = (next: SessionSectionId[], moved?: SessionSectionId, refocus = false): void => {
    if (next.join() === order.join()) return
    setOrder(next)
    writeSectionOrder(next)
    setAnnouncement(moved ? t('sessionPanel.reorder.moved', { section: title(moved), position: next.indexOf(moved) + 1, total: next.length }) : t('sessionPanel.reorder.wasReset'))
    // The menu gives focus back to its trigger; after the move that button sits elsewhere, so it is found again.
    if (refocus && moved) requestAnimationFrame(() => triggers.current.get(moved)?.focus())
  }
  const move = (id: SessionSectionId, index: number): void => commit(moveSection(order, id, index), id, true)

  // Dragging is done with pointer events on the grip (captured), not HTML drag and drop: it behaves the same with
  // a mouse, a pen or a finger, and the target is the section under the pointer.
  const sections = useRef(new Map<SessionSectionId, HTMLLIElement>())
  const endDrag = (): void => { setDragging(null); setDrop(null) }
  const targetAt = (y: number, source: SessionSectionId): { id: SessionSectionId; after: boolean } | null => {
    for (const id of order) {
      const box = sections.current.get(id)?.getBoundingClientRect()
      if (!box || id === source || y < box.top || y > box.top + box.height) continue
      return { id, after: y > box.top + box.height / 2 }
    }
    return null
  }
  const grip = (id: SessionSectionId) => ({
    onPointerDown: (event: PointerEvent<HTMLSpanElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      setDragging(id)
    },
    onPointerMove: (event: PointerEvent<HTMLSpanElement>) => {
      if (dragging !== id) return
      const next = targetAt(event.clientY, id)
      if (next?.id !== drop?.id || next?.after !== drop?.after) setDrop(next)
    },
    onPointerUp: (event: PointerEvent<HTMLSpanElement>) => {
      if (dragging !== id) return
      const target = targetAt(event.clientY, id)
      if (target) {
        const rest = order.filter(item => item !== id)
        commit(moveSection(order, id, rest.indexOf(target.id) + (target.after ? 1 : 0)), id)
      }
      endDrag()
    },
    onPointerCancel: endDrag
  })

  return <div className={styles.panel} data-testid="thread-session-panel">
    <ol className={styles.sections} aria-label={t('sessionPanel.reorder.list')}>
      {order.map((id, index) => {
        const Body = BODIES[id]
        const name = title(id)
        return <li key={id} ref={node => { if (node) sections.current.set(id, node); else sections.current.delete(id) }} className={styles.section} data-section={id}
          data-dragging={dragging === id ? 'true' : undefined} data-drop={drop?.id === id && dragging !== id ? (drop.after ? 'after' : 'before') : undefined}>
          <Panel title={name} label={name} actions={<>
            {/* Pointer only; the menu beside it moves the section from the keyboard (WCAG 2.5.7). */}
            <span className={styles.grip} title={t('sessionPanel.reorder.handle', { section: name })} aria-hidden="true" {...grip(id)}><GripVertical size={14} /></span>
            <Menu label={t('sessionPanel.reorder.menu', { section: name })} align="end" items={[
              { label: t('sessionPanel.reorder.up'), icon: <ArrowUp size={14} aria-hidden="true" />, disabled: index === 0, onSelect: () => move(id, index - 1) },
              { label: t('sessionPanel.reorder.down'), icon: <ArrowDown size={14} aria-hidden="true" />, disabled: index === order.length - 1, onSelect: () => move(id, index + 1) },
              { label: t('sessionPanel.reorder.top'), icon: <ArrowUpToLine size={14} aria-hidden="true" />, disabled: index === 0, onSelect: () => move(id, 0) },
              { label: t('sessionPanel.reorder.bottom'), icon: <ArrowDownToLine size={14} aria-hidden="true" />, disabled: index === order.length - 1, onSelect: () => move(id, order.length - 1) },
              { type: 'separator' },
              { label: t('sessionPanel.reorder.reset'), icon: <RotateCcw size={14} aria-hidden="true" />, disabled: order.join() === SESSION_SECTIONS.join(), onSelect: () => commit([...SESSION_SECTIONS]) }
            ]} trigger={<IconButton ref={node => { if (node) triggers.current.set(id, node); else triggers.current.delete(id) }} size="sm" label={t('sessionPanel.reorder.menu', { section: name })} icon={<MoreHorizontal size={14} />} />} />
          </>}><Body {...props} /></Panel>
        </li>
      })}
    </ol>
    <p className="sr-only" role="status">{announcement}</p>
  </div>
}
