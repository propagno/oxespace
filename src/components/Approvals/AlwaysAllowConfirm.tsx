import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadAlwaysAllowReasonKind, ThreadAlwaysAllowRule } from '../../../shared/types/thread'
import { Dialog, dismissToast, toast } from '../../ui'

let lastAlwaysAllowToastId: number | null = null

export function clearAlwaysAllowToast(): void {
  if (lastAlwaysAllowToastId !== null) {
    dismissToast(lastAlwaysAllowToastId)
    lastAlwaysAllowToastId = null
  }
}

export function showAlwaysAllowToast(title: string, openLabel: string, onOpen: () => void): void {
  clearAlwaysAllowToast()
  lastAlwaysAllowToastId = toast({
    title,
    intent: 'info',
    action: {
      label: openLabel,
      run: onOpen
    }
  })
}

export function AlwaysAllowReason({
  reasonKind,
  className
}: {
  reasonKind: ThreadAlwaysAllowReasonKind
  className?: string
}): ReactElement {
  const { t } = useTranslation('thread')
  const message =
    reasonKind === 'destructive' ? t('f7.alwaysAllow.reason.destructive')
      : reasonKind === 'network' ? t('f7.alwaysAllow.reason.network')
        : reasonKind === 'push' ? t('f7.alwaysAllow.reason.push')
          : reasonKind === 'compound' ? t('f7.alwaysAllow.reason.compound')
            : reasonKind === 'code' ? t('f7.alwaysAllow.reason.code')
              : reasonKind === 'elevation' ? t('f7.alwaysAllow.reason.elevation')
                : reasonKind === 'broad' ? t('f7.alwaysAllow.reason.broad')
                  : t('f7.alwaysAllow.reason.redirect')
  return <p className={className}>{message}</p>
}

export interface AlwaysAllowConfirmProps {
  rule: ThreadAlwaysAllowRule
  runsProjectCode?: boolean
  definedIn?: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function AlwaysAllowConfirm({
  rule,
  runsProjectCode = false,
  definedIn,
  busy = false,
  onCancel,
  onConfirm
}: AlwaysAllowConfirmProps): ReactElement {
  const { t } = useTranslation('thread')

  const intro = rule.scope === 'session'
    ? t('f7.alwaysAllow.codexSession')
    : t('f7.alwaysAllow.claudeRule')

  const projectCodeNotice = runsProjectCode
    ? definedIn
      ? t('f7.alwaysAllow.runsProjectCode', { definedIn })
      : t('f7.alwaysAllow.runsProjectCodeGeneric')
    : null

  return (
    <Dialog
      size="sm"
      title={t('f7.alwaysAllow.title')}
      onClose={onCancel}
      actions={{
        cancel: {
          focus: true,
          disabled: busy,
          onClick: onCancel
        },
        primary: {
          label: t('f7.alwaysAllow.confirm'),
          danger: true,
          loading: busy,
          onClick: onConfirm
        }
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <p style={{ margin: 0 }}>{intro}</p>
        <pre style={{ margin: 0, overflowX: 'auto' }}>
          <code>{rule.text}</code>
        </pre>
        {projectCodeNotice ? (
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
            {projectCodeNotice}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
