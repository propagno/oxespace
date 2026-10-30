import { RefreshCw, Trash2 } from 'lucide-react'
import { type FormEvent, type ReactElement, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentProfile, AgentProvider, AgentReadiness } from '../../../shared/types/agent'
import { BUILTIN_PROVIDERS, type UpdateAgentProfileInput } from '../../../shared/types/agent'
import { Button, ConfirmDialog, Dialog, IconButton, TextField, Select, TextArea } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

const PROVIDER_LABEL: Record<(typeof BUILTIN_PROVIDERS)[number], string> = {
  claude: 'Claude',
  copilot: 'Copilot',
  codex: 'Codex',
  antigravity: 'Antigravity',
  cursor: 'Cursor',
  grok: 'Grok CLI'
}

interface AgentConfigModalProps {
  profile: AgentProfile
  readiness: AgentReadiness | undefined
  isDiscovering: boolean
  onSave: (id: string, input: UpdateAgentProfileInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onHealthCheck: () => void
  onClose: () => void
}

export function AgentConfigModal({
  profile,
  readiness,
  isDiscovering,
  onSave,
  onDelete,
  onHealthCheck,
  onClose
}: AgentConfigModalProps): ReactElement {
  const { t } = useTranslation('settings')
  const isCustom = profile.provider === 'custom'
  const isNew = profile.agentProfileId === ''

  const [name, setName] = useState(profile.name)
  const [command, setCommand] = useState(profile.command)
  const [parentProvider, setParentProvider] = useState<AgentProvider>(profile.parentProvider ?? 'claude')
  const [systemPrompt, setSystemPrompt] = useState(profile.systemPrompt ?? '')
  const [isSubmitting, setSubmitting] = useState(false)
  const [isDeleting, setDeleting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    if (isCustom) {
      const trimmedPrompt = systemPrompt.trim()
      if (!trimmedPrompt) {
        setSubmitError(t('agentConfig.promptRequired'))
        return
      }
      setSubmitting(true)
      setSubmitError(null)
      try {
        await onSave(profile.agentProfileId, {
          name: name.trim() || profile.name,
          command: '',
          commandTemplate: '',
          parentProvider,
          systemPrompt: trimmedPrompt
        })
        onClose()
      } catch (err) {
        setSubmitError(humanizeError(err, t('agentConfig.saveFailed')))
      } finally {
        setSubmitting(false)
      }
      return
    }

    const nextCommand = command.trim()
    if (!nextCommand) {
      setSubmitError(t('agentConfig.commandRequired'))
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onSave(profile.agentProfileId, {
        name: name.trim() || profile.name,
        command: nextCommand
      })
      onClose()
    } catch (err) {
      setSubmitError(humanizeError(err, t('agentConfig.saveFailed')))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    setDeleting(true)
    try {
      await onDelete(profile.agentProfileId)
      onClose()
    } catch (err) {
      setSubmitError(humanizeError(err, t('agentConfig.deleteFailed')))
      setConfirmDelete(false)
      setDeleting(false)
    }
  }

  if (confirmDelete) {
    return <ConfirmDialog title={t('agentConfig.deleteTitle')} description={t('agentConfig.deleteDescription', { name: profile.name })}
      confirmLabel={t('agentConfig.delete')} danger busy={isDeleting} onCancel={() => setConfirmDelete(false)} onConfirm={() => void handleDelete()} />
  }

  return (
    <Dialog
      title={isNew ? t('providers.newCustomAgent') : t('agentConfig.configure')}
      description={isCustom ? t('agentConfig.customDescription') : t('agentConfig.description')}
      onClose={onClose}
      footer={<>
        {!profile.isBuiltin && !isNew ? (
          <Button variant="ghost" data-align="start" icon={<Trash2 size={14} aria-hidden="true" />} disabled={isDeleting} onClick={() => setConfirmDelete(true)} data-testid="btn-delete-agent">
            {t('agentConfig.delete')}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onClose}>{t('ui.cancel', { ns: 'common' })}</Button>
        <Button type="submit" form="agent-config-form" variant="primary" loading={isSubmitting} data-testid="btn-save-agent">
          {isNew ? t('agentConfig.create') : t('agentConfig.save')}
        </Button>
      </>}
    >
      {readiness && !isCustom ? (
        <div className="readiness-row agent-config-readiness">
          <span className={`agent-badge ${readiness.status}`}>{t(`providers.status.${readiness.status}`)}</span>
          {readiness.details ? <span className="agent-config-readiness-detail">{readiness.details}</span> : null}
          {readiness.version ? <span className="readiness-version">{readiness.version}</span> : null}
          <IconButton className="agent-config-health" label={t('providers.runHealthCheck')} size="sm" disabled={isDiscovering} onClick={onHealthCheck}
            icon={<RefreshCw size={12} aria-hidden="true" className={isDiscovering ? 'spin' : undefined} />} />
        </div>
      ) : null}

      <form id="agent-config-form" className="modal-form" onSubmit={(e) => void handleSubmit(e)}>
          <label className="field">
            <span>{t('agentConfig.name')}</span>
            <TextField
              type="text"
              value={name}
              disabled={profile.isBuiltin}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('agentConfig.namePlaceholder')}
              data-testid="input-agent-name"
            />
          </label>

          {isCustom ? (
            <>
              <label className="field">
                <span>{t('agentConfig.parent')}</span>
                <Select
                  value={parentProvider}
                  onChange={(e) => setParentProvider(e.target.value as AgentProvider)}
                  data-testid="select-parent-provider"
                >
                  {BUILTIN_PROVIDERS.map((provider) => (
                    <option key={provider} value={provider}>{PROVIDER_LABEL[provider]}</option>
                  ))}
                </Select>
              </label>

              <label className="field">
                <span>{t('agentConfig.prompt')}</span>
                <TextArea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder={t('agentConfig.promptPlaceholder')}
                  rows={5}
                  data-testid="textarea-system-prompt"
                />
              </label>
            </>
          ) : (
            <label className="field">
              <span>{t('agentConfig.command')}</span>
              <TextField
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="claude"
                data-testid="input-agent-command"
              />
            </label>
          )}

          {submitError ? (
            <div className="modal-error" role="alert">{submitError}</div>
          ) : null}

        </form>
    </Dialog>
  )
}
