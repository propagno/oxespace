import { useState, type DragEvent, type HTMLAttributes } from 'react'
import type { SectionedThread } from './sectionsContract'

/** The drag payload type: a conversation id, readable only on drop. */
export const THREAD_DRAG_TYPE = 'application/x-oxespace-thread'

export interface DropTarget { projectId: string; sectionId: string | null }
export type DropZoneProps = HTMLAttributes<HTMLElement> & { 'data-drop-target'?: 'true' }

/**
 * Native drag and drop of conversations into a section (or back to no section) of the same project.
 * Every move it makes is also in the conversation's "Move to section" menu (WCAG 2.5.7).
 */
export function useSectionDrag(threads: readonly SectionedThread[], onMove: (thread: SectionedThread, sectionId: string | null) => void) {
  const [dragging, setDragging] = useState<SectionedThread | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const keyOf = (target: DropTarget): string => `${target.projectId}\n${target.sectionId ?? ''}`
  const end = (): void => { setDragging(null); setOver(null) }

  const rowProps = (thread: SectionedThread): HTMLAttributes<HTMLDivElement> & { draggable?: boolean } => thread.parentThreadId ? {} : {
    draggable: true,
    onDragStart: (event: DragEvent<HTMLDivElement>) => {
      event.dataTransfer.setData(THREAD_DRAG_TYPE, thread.id)
      event.dataTransfer.effectAllowed = 'move'
      setDragging(thread)
    },
    onDragEnd: end
  }

  const zoneProps = (target: DropTarget): DropZoneProps => {
    const key = keyOf(target)
    const accepts = (event: DragEvent<HTMLElement>): boolean => event.dataTransfer.types.includes(THREAD_DRAG_TYPE) && (!dragging || dragging.projectId === target.projectId)
    return {
      'data-drop-target': over === key ? 'true' : undefined,
      onDragOver: event => {
        if (!accepts(event)) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
        if (over !== key) setOver(key)
      },
      onDragLeave: event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(value => value === key ? null : value) },
      onDrop: event => {
        if (!accepts(event)) return
        event.preventDefault()
        event.stopPropagation()
        const id = event.dataTransfer.getData(THREAD_DRAG_TYPE)
        const thread = threads.find(item => item.id === id)
        end()
        if (thread && thread.projectId === target.projectId) onMove(thread, target.sectionId)
      }
    }
  }

  return { dragging, rowProps, zoneProps }
}
