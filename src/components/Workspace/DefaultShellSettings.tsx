import { Bot, Check, SquareTerminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ShellProfile } from '../../../shared/types/workspace'
import { i18n } from '../../i18n'
import { Notice } from '../../ui'

/** Agent product names, the same in every language. */
const AGENT_LABELS: Record<string, string> = {
  'builtin-claude': 'Claude Code', 'builtin-codex': 'Codex', 'builtin-cursor': 'Cursor',
  'builtin-antigravity': 'Antigravity', 'builtin-grok': 'Grok'
}
const label = (profile: ShellProfile) => AGENT_LABELS[profile.id] ?? (profile.id === 'builtin-copilot' ? i18n.t('workspace.shell.copilot', { ns: 'code' }) : profile.name)

export function DefaultShellSettings({ profiles, selectedId, onSelect, applyToIdle, onApplyToIdle, rootPath }: {
  profiles: ShellProfile[]; selectedId: string; onSelect(id: string): void
  applyToIdle: boolean; onApplyToIdle(value: boolean): void; rootPath: string
}) {
  const { t } = useTranslation('code')
  const selected = profiles.find(profile => profile.id === selectedId)
  return <section className="ws-settings-section default-shell-settings" aria-labelledby="ws-section-shell">
    <header className="ws-settings-section-header"><SquareTerminal size={16} aria-hidden="true" /><h3 id="ws-section-shell">{t('workspace.shell.title')}</h3></header>
    <p className="shell-intro">{t('workspace.shell.intro')}</p>
    {!profiles.length && <p role="status">{t('workspace.shell.none')}</p>}
    {!!profiles.length && !selected && <Notice intent="warning">{t('workspace.shell.missing')}</Notice>}
    <div role="radiogroup" aria-label={t('workspace.shell.group')}>
      {(['shell', 'agent'] as const).map(kind => {
        const items = profiles.filter(profile => Boolean(AGENT_LABELS[profile.id]) === (kind === 'agent'))
        if (!items.length) return null
        const Icon = kind === 'agent' ? Bot : SquareTerminal
        return <div key={kind} className="shell-profile-group">
          <div className="ws-settings-field-label">{kind === 'agent' ? t('workspace.shell.agents') : t('workspace.shell.shells')} <span className="shell-count">{items.length}</span></div>
          <div className="shell-card-grid">{items.map(profile => <label key={profile.id} className={`shell-choice${selectedId === profile.id ? ' selected' : ''}`}>
            <input type="radio" name="workspace-default-shell" value={profile.id} checked={selectedId === profile.id} onChange={() => onSelect(profile.id)} aria-label={label(profile)} />
            <Icon size={16} className="shell-choice-icon" aria-hidden="true" />
            <span className="shell-card-content"><strong>{label(profile)}</strong><code title={profile.executable}>{profile.executable}</code>
              <small>{profile.id === 'builtin-copilot' ? t('workspace.shell.copilotHint') : kind === 'agent' ? t('workspace.shell.agentHint') : t('workspace.shell.shellHint')}</small></span>
            {selectedId === profile.id && <Check size={14} className="shell-choice-check" aria-hidden="true" />}
          </label>)}</div>
        </div>
      })}
    </div>
    {selected && <div className="shell-launch-summary" role="group" aria-label={t('workspace.shell.selected')}>
      <div><strong>{t('workspace.shell.onLaunch')}</strong><span>{label(selected)}</span></div>
      <dl><dt>{t('workspace.shell.executable')}</dt><dd><code>{selected.executable}</code></dd>
        <dt>{t('workspace.shell.arguments')}</dt><dd>{selected.args.length ? selected.args.map((arg, index) => <code className="shell-argument" key={index}>{arg}</code>) : t('workspace.shell.noArguments')}</dd>
        <dt>{t('workspace.shell.directory')}</dt><dd><code>{rootPath}</code><small>{t('workspace.shell.directoryHint')}</small></dd></dl>
      <p>{t('workspace.shell.installed')}</p>
    </div>}
    <fieldset className="shell-apply-scope"><legend>{t('workspace.shell.apply')}</legend>
      <label><input type="radio" name="shell-apply-scope" checked={!applyToIdle} onChange={() => onApplyToIdle(false)} /><span><strong>{t('workspace.shell.keep')}</strong><small>{t('workspace.shell.keepHint')}</small></span></label>
      <label><input type="radio" name="shell-apply-scope" checked={applyToIdle} onChange={() => onApplyToIdle(true)} /><span><strong>{t('workspace.shell.update')}</strong><small>{t('workspace.shell.updateHint')}</small></span></label>
    </fieldset>
    <p className="shell-safety-note">{t('workspace.shell.safety')}</p>
  </section>
}
