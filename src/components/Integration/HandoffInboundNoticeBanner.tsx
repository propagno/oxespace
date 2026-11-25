import { X } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { HandoffInboundNotice } from '../../../shared/types/handoff-notice'
import { IconButton, Notice } from '../../ui'

export interface HandoffInboundNoticeBannerProps {
  notices: readonly HandoffInboundNotice[]
  onDismiss?: (id: string) => void
}

/**
 * OXE-298 (CA-1): Passive inbound handoff notice for a consumer pane.
 * Uses `Notice` (`intent="info"`, `role="status"`) and never calls `.focus()`
 * or renders autofocused controls so typing focus in the pane is never stolen.
 */
export function HandoffInboundNoticeBanner({ notices, onDismiss }: HandoffInboundNoticeBannerProps): ReactElement | null {
  const { t } = useTranslation('code')
  if (notices.length === 0) return null
  return (
    <div data-testid="handoff-inbound-notices" aria-live="polite">
      {notices.map(notice => {
        const file = notice.relativePath ?? notice.filePath
        const title = notice.kind === 'peer-reply'
          ? t('integration.handoff.inboundReplyTitle', { origin: notice.origin.label })
          : t('integration.handoff.inboundUpdatedTitle', { origin: notice.origin.label })
        return (
          <Notice
            key={notice.id}
            intent="info"
            title={title}
            actions={onDismiss ? (
              <IconButton
                size="sm"
                variant="ghost"
                label={t('integration.handoff.dismissNotice')}
                icon={<X size={12} aria-hidden="true" />}
                onClick={() => onDismiss(notice.id)}
              />
            ) : undefined}
          >
            {file ? <span>{file}</span> : null}
            {notice.summary ? <span>{file ? ` — ${notice.summary}` : notice.summary}</span> : null}
          </Notice>
        )
      })}
    </div>
  )
}
