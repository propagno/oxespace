import { Pencil, Save, Trash2, X } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { IntegrationMember, IntegrationRole } from '../../../shared/types/integration'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { useIntegrationStore } from '../../store/integration.store'
import { Button, TextField, Select, TextArea } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

interface MemberEditorProps {
  member: IntegrationMember
  panes: WorkspacePane[]
  confirmingRemoval: boolean
  isRemoving: boolean
  onClose: () => void
  onRemove: () => void
}

const ROLES: IntegrationRole[] = ['fed', 'bff', 'srv', 'api', 'apim', 'mktapi', 'aut', 'lib', 'db', 'infra', 'docs', 'other']

/**
 * Inline editor for the four free-form member fields the schema has carried
 * since Onda 1 of Integration (alias / role / blockers / lastIntent) but
 * which the panel never surfaced. Without this, the user had to delete and
 * re-add a member just to fix a typo in the alias — a friction tax that
 * killed iterative use of the feature.
 *
 * The editor lives inside the expanded card slot under the member it
 * targets. Save calls `updateMember` (the store already wires the IPC and
 * patches the group cache); cancel discards local state. We deliberately
 * don't auto-save on blur — that confuses users who tab between fields.
 */
export function MemberEditor({ member, panes, confirmingRemoval, isRemoving, onClose, onRemove }: MemberEditorProps): ReactElement {
  const { t } = useTranslation('code')
  const updateMember = useIntegrationStore((s) => s.updateMember)
  const [alias, setAlias] = useState(member.alias)
  const [role, setRole] = useState<IntegrationRole>(member.role)
  const [blockers, setBlockers] = useState(member.blockers ?? '')
  const [lastIntent, setLastIntent] = useState(member.lastIntent ?? '')
  const [paneId, setPaneId] = useState(member.paneId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setAlias(member.alias)
    setRole(member.role)
    setBlockers(member.blockers ?? '')
    setLastIntent(member.lastIntent ?? '')
    setPaneId(member.paneId ?? '')
  }, [member.id, member.alias, member.role, member.blockers, member.lastIntent, member.paneId])

  const handleSave = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      await updateMember({
        memberId: member.id,
        alias: alias.trim() || member.alias,
        role,
        paneId: paneId || null,
        // null clears the field on the server (validation accepts undefined
        // OR a nullable string). Empty input maps to null so the user can
        // wipe a blocker by simply clearing the textarea.
        blockers: blockers.trim() ? blockers.trim() : null,
        lastIntent: lastIntent.trim() ? lastIntent.trim() : null
      })
      onClose()
    } catch (err) {
      setError(humanizeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="integration-member-editor" role="region" aria-label={t('integration.editor.label', { member: `${member.role}/${member.alias}` })}>
      {error ? <div className="integration-error">{error}</div> : null}
      <div className="integration-member-editor-row">
        <label className="integration-member-editor-field">
          <span>{t('integration.editor.alias')}</span>
          <TextField value={alias} onChange={(e) => setAlias(e.currentTarget.value)} placeholder={member.workspaceName} disabled={busy} />
        </label>
        <label className="integration-member-editor-field">
          <span>{t('integration.editor.role')}</span>
          <Select value={role} onChange={(e) => setRole(e.currentTarget.value as IntegrationRole)} disabled={busy}>
            {ROLES.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
          </Select>
        </label>
      </div>
      <label className="integration-member-editor-field">
        <span>{t('integration.editor.lastIntent')}</span>
        <TextField
          value={lastIntent}
          onChange={(e) => setLastIntent(e.currentTarget.value)}
          placeholder={t('integration.editor.lastIntentPlaceholder')}
          disabled={busy}
        />
      </label>
      <label className="integration-member-editor-field">
        <span>{t('integration.editor.terminal')}</span>
        <Select value={paneId} onChange={(e) => setPaneId(e.currentTarget.value)} disabled={busy}>
          <option value="">{t('integration.editor.noTerminal')}</option>
          {panes.map((pane) => (
            <option key={pane.id} value={pane.id}>
              {pane.displayName || pane.agentName || t('integration.terminalAt', { position: `${pane.rowIndex + 1}.${pane.columnIndex + 1}` })}
            </option>
          ))}
        </Select>
        <small className="integration-member-editor-help">{t('integration.editor.terminalHint')}</small>
      </label>
      <label className="integration-member-editor-field">
        <span>{t('integration.editor.blockers')}</span>
        <TextArea
          value={blockers}
          onChange={(e) => setBlockers(e.currentTarget.value)}
          placeholder={t('integration.editor.blockersPlaceholder')}
          rows={2}
          disabled={busy}
        />
      </label>
      <div className="integration-member-editor-actions">
        <button
          type="button"
          className={`integration-member-remove-btn${confirmingRemoval ? ' confirming' : ''}`}
          onClick={onRemove}
          disabled={busy || isRemoving}
        >
          <Trash2 size={12} aria-hidden="true" />
          {isRemoving ? t('integration.editor.removing') : confirmingRemoval ? t('integration.editor.confirmRemove') : t('integration.editor.remove')}
        </button>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          <X size={12} aria-hidden="true" />
          {t('ui.cancel', { ns: 'common' })}
        </Button>
        <Button variant="primary" size="sm" onClick={() => void handleSave()} disabled={busy}>
          <Save size={12} aria-hidden="true" />
          {busy ? t('integration.editor.saving') : t('integration.editor.save')}
        </Button>
      </div>
    </div>
  )
}

interface MemberEditButtonProps {
  onClick: (event: React.MouseEvent) => void
  isEditing: boolean
}

export function MemberEditButton({ onClick, isEditing }: MemberEditButtonProps): ReactElement {
  const { t } = useTranslation('code')
  return (
    <button
      type="button"
      className={`integration-member-edit-btn${isEditing ? ' active' : ''}`}
      onClick={onClick}
      aria-label={isEditing ? t('integration.editor.close') : t('integration.editor.edit')}
      title={isEditing ? t('ui.close', { ns: 'common' }) : t('integration.editor.edit')}
    >
      <Pencil size={12} aria-hidden="true" />
    </button>
  )
}
