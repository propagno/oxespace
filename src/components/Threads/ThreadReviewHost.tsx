import type { RefObject } from 'react'
import { Dialog } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import { CONVERSATION_MIN_WIDTH, REVIEW_DEFAULT_WIDTH, REVIEW_MIN_WIDTH, useThreadWorkbenchStore, type ThreadPanel } from '../../store/thread-workbench.store'
import { Splitter } from '../../ui/Splitter'
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
  const { t } = useTranslation('thread')
  const reviewWidth = useThreadWorkbenchStore(state => state.width)
  const maximized = useThreadWorkbenchStore(state => state.maximizedId === snapshot.thread.id) && !drawer
  const content = <ThreadChangesPanel key={snapshot.thread.id} snapshot={snapshot} workspace={workspace} panel={panel} onClose={onClose} onSendToConversation={onSendToConversation}
    maximized={maximized} onToggleMaximized={drawer ? undefined : () => useThreadWorkbenchStore.getState().setMaximized(maximized ? null : snapshot.thread.id)} />
  if (drawer) return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}><Dialog.Portal container={workbench.current}>
    <Dialog.Overlay className="thread-review-scrim" />
    <Dialog.Content className="thread-review-host" aria-describedby={undefined} style={{ width: Math.min(reviewWidth, Math.max(280, availableWidth - 16)) }} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <Dialog.Title className="thread-review-accessible-title">{t('reviewHost.title')}</Dialog.Title>
      {content}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
  if (maximized) return <div className="thread-review-host is-maximized">{content}</div>
  // As wide as it was dragged, up to leaving the conversation its minimum width.
  const max = Math.max(REVIEW_MIN_WIDTH, availableWidth - CONVERSATION_MIN_WIDTH)
  const width = Math.min(Math.max(reviewWidth, REVIEW_MIN_WIDTH), max)
  return <>
    <Splitter orientation="vertical" label={t('reviewHost.resize')} value={width} min={REVIEW_MIN_WIDTH} max={max} defaultValue={REVIEW_DEFAULT_WIDTH} after step={24}
      onChange={value => useThreadWorkbenchStore.getState().setWidth(value)} />
    <div className="thread-review-host" style={{ width }}>
      {content}
    </div>
  </>
}
