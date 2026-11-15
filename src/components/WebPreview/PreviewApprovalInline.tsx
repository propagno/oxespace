import { useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Notice } from '../../ui'
import { previewApprovalFor, type PreviewOwner } from '../../app/agentPreview'
import { useApprovalsStore } from '../Approvals/approvals.store'
import { approvalsApi } from '../Approvals/approvalsApi'
import { approvalButtons, holdsAllow, requestWeight, visibleOptions } from '../Approvals/approvalsRules'
import { formatMainMessage } from '../Approvals/approvalText'
import { HoldToApprove } from '../Approvals/HoldToApprove'
import { useAllowHold } from '../Approvals/useAllowHold'

/**
 * The approval center's own record for a page this Browser's agent asked to open (OXE-109/Q-4: one approval, one
 * audit trail). Shown inline with the record's own options; answering here answers that record, as the center would.
 * It needs the person, it is not a warning: an attention Notice (neutral card, the sun only in its header), said once
 * per record, with the center's buttons (approvalButtons: Deny first, one main action last, the other allows quiet).
 */
export function PreviewApprovalInline({ owner }: { owner: PreviewOwner }): ReactElement | null {
  const { t } = useTranslation('code')
  const { t: tThread } = useTranslation('thread')
  const queue = useApprovalsStore(state => state.queue)
  const busy = useApprovalsStore(state => state.busy)
  const record = previewApprovalFor(owner, queue)
  const recordId = record?.id
  const generation = record?.generation
  // Main refuses an allow before its pacing ends (critical): the allows wait for it, as in the center's dialog.
  const holdLeft = useAllowHold(record ? holdsAllow(record) : false, `${recordId}:${generation}`, record?.allowDelayMs)

  // Shown here is shown to the person: main counts the record as seen.
  useEffect(() => {
    const api = approvalsApi()
    if (!api || recordId === undefined || generation === undefined) return
    const visible = document.visibilityState === 'visible'
    void api.ack({ id: recordId, generation, visible, focused: visible && document.hasFocus() }).catch(() => undefined)
  }, [recordId, generation])

  if (!record) return null
  const url = record.target ?? record.agentText.text
  const answer = (optionId: string): void => {
    const api = approvalsApi()
    if (!api) return
    void useApprovalsStore.getState().respond(api, record, optionId)
  }
  const buttons = approvalButtons(visibleOptions(record), requestWeight(record))
  return (
    <div data-testid="preview-approval-inline">
      <Notice intent="attention" label={t('preview.approval.label', { url })} announceKey={`${record.id}:${record.generation}`}
        title={t('preview.approval.title')} actions={buttons.map(({ option, variant, hold }) => {
          const disabled = Boolean(busy) || (option.intent !== 'deny' && holdLeft > 0)
          // Critical and irreversible: hold to confirm, and no shortcut drawn on it (the center's rule).
          return hold
            ? <HoldToApprove key={option.id} label={tThread('f7.preview.holdToApprove')} disabled={disabled} onComplete={() => answer(option.id)} />
            : <Button key={option.id} size="sm" variant={variant} data-intent={option.intent} disabled={disabled} onClick={() => answer(option.id)}>
              {formatMainMessage(option.label)}
            </Button>
        })}>
        <code>{url}</code>
        <span> {t('preview.approval.hint')}</span>
      </Notice>
    </div>
  )
}
