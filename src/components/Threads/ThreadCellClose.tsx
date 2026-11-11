import type { ReactElement } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useThreadStore } from '../../store/thread.store'
import { IconButton } from '../../ui'

export function ThreadCellClose(props: {
  cell: 'primary' | 'secondary'
  onClose?: () => void
}): ReactElement {
  const { cell, onClose } = props
  const { t } = useTranslation('thread')

  const handleClose = (): void => {
    if (onClose) {
      onClose()
      return
    }
    const store = useThreadStore.getState()
    if (cell === 'secondary') {
      store.closeSecondary()
      return
    }
    if (store.secondaryId) {
      void store.select(store.secondaryId)
    } else {
      void store.select(null)
    }
  }

  return (
    <IconButton
      size="sm"
      className="thread-icon-action"
      label={t('header.closeSide')}
      icon={<X size={14} />}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation()
        handleClose()
      }}
    />
  )
}
