import { Pencil, Save, X } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { IntegrationMember, IntegrationRole } from '../../../shared/types/integration'
import { useIntegrationStore } from '../../store/integration.store'

interface MemberEditorProps {
  member: IntegrationMember
  onClose: () => void
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
export function MemberEditor({ member, onClose }: MemberEditorProps): ReactElement {
  const updateMember = useIntegrationStore((s) => s.updateMember)
  const [alias, setAlias] = useState(member.alias)
  const [role, setRole] = useState<IntegrationRole>(member.role)
  const [blockers, setBlockers] = useState(member.blockers ?? '')
  const [lastIntent, setLastIntent] = useState(member.lastIntent ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setAlias(member.alias)
    setRole(member.role)
    setBlockers(member.blockers ?? '')
    setLastIntent(member.lastIntent ?? '')
  }, [member.id, member.alias, member.role, member.blockers, member.lastIntent])

  const handleSave = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      await updateMember({
        memberId: member.id,
        alias: alias.trim() || member.alias,
        role,
        // null clears the field on the server (validation accepts undefined
        // OR a nullable string). Empty input maps to null so the user can
        // wipe a blocker by simply clearing the textarea.
        blockers: blockers.trim() ? blockers.trim() : null,
        lastIntent: lastIntent.trim() ? lastIntent.trim() : null
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="integration-member-editor" role="region" aria-label={`Edit ${member.role}/${member.alias}`}>
      {error ? <div className="integration-error">{error}</div> : null}
      <div className="integration-member-editor-row">
        <label className="integration-member-editor-field">
          <span>Alias</span>
          <input value={alias} onChange={(e) => setAlias(e.currentTarget.value)} placeholder={member.workspaceName} disabled={busy} />
        </label>
        <label className="integration-member-editor-field">
          <span>Role</span>
          <select value={role} onChange={(e) => setRole(e.currentTarget.value as IntegrationRole)} disabled={busy}>
            {ROLES.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
          </select>
        </label>
      </div>
      <label className="integration-member-editor-field">
        <span>Last intent</span>
        <input
          value={lastIntent}
          onChange={(e) => setLastIntent(e.currentTarget.value)}
          placeholder="What this member is currently working on"
          disabled={busy}
        />
      </label>
      <label className="integration-member-editor-field">
        <span>Blockers</span>
        <textarea
          value={blockers}
          onChange={(e) => setBlockers(e.currentTarget.value)}
          placeholder="Something else has to land first, missing creds, etc."
          rows={2}
          disabled={busy}
        />
      </label>
      <div className="integration-member-editor-actions">
        <button type="button" className="ghost-btn small" onClick={onClose} disabled={busy}>
          <X size={11} aria-hidden="true" />
          Cancel
        </button>
        <button type="button" className="primary-btn small" onClick={() => void handleSave()} disabled={busy}>
          <Save size={11} aria-hidden="true" />
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

interface MemberEditButtonProps {
  onClick: (event: React.MouseEvent) => void
  isEditing: boolean
}

export function MemberEditButton({ onClick, isEditing }: MemberEditButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={`integration-member-edit-btn${isEditing ? ' active' : ''}`}
      onClick={onClick}
      aria-label={isEditing ? 'Close member editor' : 'Edit member'}
      title={isEditing ? 'Close' : 'Edit member'}
    >
      <Pencil size={11} aria-hidden="true" />
    </button>
  )
}
