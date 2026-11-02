import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ConfirmDialog, Dialog, TextField } from '../../../ui'
import { normalizeSectionName, SECTION_NAME_MAX, SectionError } from './sectionsContract'
import { sectionErrorText, type ThreadSectionsController } from './useThreadSections'

/** Create, rename and delete dialogs for the sections of the conversation list. */
export function ThreadSectionDialogs({ controller }: { controller: ThreadSectionsController }): ReactElement | null {
  const { dialog, setDialog } = controller
  if (!dialog) return null
  const close = (): void => setDialog(null)
  if (dialog.kind === 'delete') return <DeleteSectionDialog key={dialog.section.id} controller={controller} name={dialog.section.name} count={dialog.count} onClose={close} />
  return <SectionNameDialog key={dialog.kind === 'rename' ? dialog.section.id : `new-${dialog.projectId}`} controller={controller} onClose={close} />
}

function SectionNameDialog({ controller, onClose }: { controller: ThreadSectionsController; onClose: () => void }): ReactElement {
  const { t } = useTranslation('thread')
  const dialog = controller.dialog!
  const renaming = dialog.kind === 'rename'
  const [value, setValue] = useState(renaming ? dialog.section.name : '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    // Same rules as the main process, checked here so the field explains them before anything is sent.
    if (!normalizeSectionName(value)) { setError(sectionErrorText(new SectionError('thread.section.invalidName', { max: SECTION_NAME_MAX }))); return }
    setBusy(true); setError('')
    try {
      if (dialog.kind === 'rename') await controller.rename(dialog.section, value)
      else if (dialog.kind === 'create') await controller.create(dialog.projectId, value, dialog.threadId)
      onClose()
    } catch (cause) { setError(sectionErrorText(cause)) }
    finally { setBusy(false) }
  }
  return <Dialog closeLabel={t('common.close')} size="sm" title={renaming ? t('sections.renameTitle') : t('sections.newTitle')} description={renaming ? undefined : t('sections.newDescription')}
    onClose={() => { if (!busy) onClose() }}
    footer={<>
      <Button disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" type="submit" form="thread-section-form" loading={busy} disabled={busy || !value.trim() || (renaming && value.trim() === dialog.section.name)}>
        {renaming ? busy ? t('sections.saving') : t('sections.save') : busy ? t('sections.creating') : t('sections.create')}
      </Button>
    </>}>
    <form id="thread-section-form" noValidate onSubmit={event => { event.preventDefault(); void submit() }}>
      <TextField label={t('sections.name')} hint={error ? undefined : t('sections.nameHint', { max: SECTION_NAME_MAX })} error={error || undefined} autoFocus value={value}
        onChange={event => { setValue(event.target.value); if (error) setError('') }} />
    </form>
  </Dialog>
}

function DeleteSectionDialog({ controller, name, count, onClose }: { controller: ThreadSectionsController; name: string; count: number; onClose: () => void }): ReactElement {
  const { t } = useTranslation('thread')
  const dialog = controller.dialog
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return <ConfirmDialog title={t('sections.deleteTitle')} description={t('sections.deleteDescription', { name, count })} confirmLabel={busy ? t('sections.deleting') : t('sections.deleteConfirm')}
    cancelLabel={t('common.cancel')} danger busy={busy} error={error} onCancel={onClose}
    onConfirm={() => {
      if (dialog?.kind !== 'delete') return
      setBusy(true); setError('')
      void controller.remove(dialog.section, dialog.count).then(onClose, cause => { setError(sectionErrorText(cause)); setBusy(false) })
    }} />
}
