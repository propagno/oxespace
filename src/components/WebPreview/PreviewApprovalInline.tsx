import { useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Notice } from '../../ui'
import { previewApprovalFor, type PreviewOwner } from '../../app/agentPreview'
import { useApprovalsStore } from '../Approvals/approvals.store'
import { approvalsApi } from '../Approvals/approvalsApi'
import { formatMainMessage } from '../Approvals/approvalText'

/**
 * The approval center's own record for a page this Browser's agent asked to open (OXE-109/Q-4: one approval, one
 * audit trail). Shown inline with the record's own options; answering here answers that record, as the center would.
 */
export function PreviewApprovalInline({ owner }: { owner: PreviewOwner }): ReactElement | null {
  const { t } = useTranslation('code')
  const queue = useApprovalsStore(state => state.queue)
  const busy = useApprovalsStore(state => state.busy)
  const record = previewApprovalFor(owner, queue)
  const recordId = record?.id
  const generation = record?.generation

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
  return (
    <div data-testid="preview-approval-inline">
      <Notice intent="warning" title={t('preview.approval.title')} actions={record.options.map(option => (
        <Button key={option.id} size="sm" variant={option.intent === 'deny' ? 'secondary' : 'primary'} disabled={Boolean(busy)} onClick={() => answer(option.id)}>
          {formatMainMessage(option.label)}
        </Button>
      ))}>
        <code>{url}</code>
        <span> {t('preview.approval.hint')}</span>
      </Notice>
    </div>
  )
}
