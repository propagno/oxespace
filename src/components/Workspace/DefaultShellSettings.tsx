import { Bot, Check, SquareTerminal } from 'lucide-react'
import type { ShellProfile } from '../../../shared/types/workspace'

const AGENT_LABELS: Record<string, string> = {
  'builtin-claude': 'Claude Code', 'builtin-codex': 'Codex', 'builtin-cursor': 'Cursor',
  'builtin-antigravity': 'Antigravity', 'builtin-grok': 'Grok'
}
const label = (profile: ShellProfile) => AGENT_LABELS[profile.id] ?? (profile.id === 'builtin-copilot' ? 'Copilot shell' : profile.name)

export function DefaultShellSettings({ profiles, selectedId, onSelect, applyToIdle, onApplyToIdle, rootPath }: {
  profiles: ShellProfile[]; selectedId: string; onSelect(id: string): void
  applyToIdle: boolean; onApplyToIdle(value: boolean): void; rootPath: string
}) {
  const selected = profiles.find(profile => profile.id === selectedId)
  return <section className="ws-settings-section default-shell-settings" aria-labelledby="ws-section-shell">
    <header className="ws-settings-section-header"><SquareTerminal size={16} aria-hidden="true" /><h3 id="ws-section-shell">Default shell & startup</h3></header>
    <p className="shell-intro">Choose the launch profile used by workspace layout defaults. Select a command-line shell or open directly into an agent.</p>
    {!profiles.length && <p role="status">No launch profiles available. Restart OXESpace to reload the profiles.</p>}
    {!!profiles.length && !selected && <p role="alert">The saved profile is unavailable. Select a profile below before saving.</p>}
    <div role="radiogroup" aria-label="Default shell profile">
      {['shell', 'agent'].map(kind => {
        const items = profiles.filter(profile => Boolean(AGENT_LABELS[profile.id]) === (kind === 'agent'))
        if (!items.length) return null
        const Icon = kind === 'agent' ? Bot : SquareTerminal
        return <div key={kind} className="shell-profile-group">
          <div className="ws-settings-field-label">{kind === 'agent' ? 'Agent launchers' : 'Command-line shells'} <span className="shell-count">{items.length}</span></div>
          <div className="shell-card-grid">{items.map(profile => <label key={profile.id} className={`shell-choice${selectedId === profile.id ? ' selected' : ''}`}>
            <input type="radio" name="workspace-default-shell" value={profile.id} checked={selectedId === profile.id} onChange={() => onSelect(profile.id)} aria-label={label(profile)} />
            <Icon size={19} className="shell-choice-icon" aria-hidden="true" />
            <span className="shell-card-content"><strong>{label(profile)}</strong><code title={profile.executable}>{profile.executable}</code>
              <small>{profile.id === 'builtin-copilot' ? 'Shell only · start Copilot manually' : kind === 'agent' ? 'Uses your installed CLI' : 'Interactive terminal'}</small></span>
            {selectedId === profile.id && <Check size={15} className="shell-choice-check" aria-hidden="true" />}
          </label>)}</div>
        </div>
      })}
    </div>
    {selected && <div className="shell-launch-summary" aria-label="Selected launch profile">
      <div><strong>On launch</strong><span>{label(selected)}</span></div>
      <dl><dt>Executable</dt><dd><code>{selected.executable}</code></dd>
        <dt>Arguments</dt><dd>{selected.args.length ? selected.args.map((arg, index) => <code className="shell-argument" key={index}>{arg}</code>) : 'No additional arguments'}</dd>
        <dt>Directory</dt><dd><code>{rootPath}</code><small>Pane worktree paths take precedence.</small></dd></dl>
      <p>The executable must already be installed and accessible. Selecting a profile does not install or start it.</p>
    </div>}
    <fieldset className="shell-apply-scope"><legend>Apply when saving</legend>
      <label><input type="radio" name="shell-apply-scope" checked={!applyToIdle} onChange={() => onApplyToIdle(false)} /><span><strong>Keep existing panes</strong><small>Save the default without changing their assigned profiles.</small></span></label>
      <label><input type="radio" name="shell-apply-scope" checked={applyToIdle} onChange={() => onApplyToIdle(true)} /><span><strong>Also update idle and exited panes</strong><small>Use this profile the next time those terminals are started.</small></span></label>
    </fieldset>
    <p className="shell-safety-note">Running sessions are never restarted. Explicit agent assignments take precedence. Manual splits continue to open a neutral shell.</p>
  </section>
}
