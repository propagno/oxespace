import type { RefObject } from 'react'
import { Dialog } from 'radix-ui'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import { useThreadWorkbenchStore, type ThreadPanel } from '../../store/thread-workbench.store'
import { ThreadChangesPanel } from './ThreadChangesPanel'

/**
 * The side panel next to the conversation (changes, files, terminal…): a
 * resizable column on wide layouts, a modal drawer on narrow ones. Loaded on demand.
 */
export default function ThreadReviewHost({ snapshot, workspace, panel, drawer, availableWidth, workbench, onClose, onReturnFocus, onSendToConversation }: {
  snapshot: ThreadSnapshot
  workspace?: Workspace
  panel: ThreadPanel
  drawer: boolean
  availableWidth: number
  workbench: RefObject<HTMLDivElement | null>
  onClose: () => void
  onReturnFocus: () => void
  onSendToConversation: (prompt: string) => void
}) {
  const reviewWidth = useThreadWorkbenchStore(state => state.width)
  const content = <ThreadChangesPanel key={snapshot.thread.id} snapshot={snapshot} workspace={workspace} panel={panel} onClose={onClose} onSendToConversation={onSendToConversation} />
  if (drawer) return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}><Dialog.Portal container={workbench.current}>
    <Dialog.Overlay className="thread-review-scrim" />
    <Dialog.Content className="thread-review-host" aria-describedby={undefined} style={{ width: Math.min(reviewWidth, Math.max(280, availableWidth - 16)) }} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <Dialog.Title className="thread-review-accessible-title">Conversation review</Dialog.Title>
      {content}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
  return <>
    <div className="thread-review-resize" role="separator" aria-label="Resize review panel" aria-orientation="vertical" tabIndex={0} aria-valuemin={320} aria-valuemax={Math.min(720, availableWidth - 480)} aria-valuenow={Math.min(reviewWidth, Math.max(320, availableWidth - 480))}
      onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); useThreadWorkbenchStore.getState().setWidth(Math.min(availableWidth - 480, reviewWidth + (event.key === 'ArrowLeft' ? 24 : -24))) } }}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId) && workbench.current) useThreadWorkbenchStore.getState().setWidth(Math.min(availableWidth - 480, workbench.current.getBoundingClientRect().right - event.clientX)) }}
      onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)} />
    <div className="thread-review-host" style={{ width: Math.min(reviewWidth, Math.max(320, Math.min(availableWidth * .48, availableWidth - 640))) }}>
      {content}
    </div>
  </>
}
