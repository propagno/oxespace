import { useEffect, useState, type ReactElement } from 'react'
import { RefreshCw } from 'lucide-react'
import type { PolicyLayer, PolicyView } from '../../../shared/policy'
import { Button } from '../../ui'

const LAYERS: Record<PolicyLayer, { label: string; hint: string }> = {
  project: { label: 'Project', hint: 'Applies to this project only' },
  user: { label: 'User', hint: 'Applies to you on this computer' },
  managed: { label: 'Managed', hint: 'Installed by an administrator; has the final word' }
}

/** Read only: shows which policy files apply and what they block. Nothing here writes a policy. */
export function PolicySettings({ workspaceId }: { workspaceId?: string }): ReactElement {
  const [view, setView] = useState<PolicyView | null>(null)
  const [error, setError] = useState('')
  const [reloads, setReloads] = useState(0)
  useEffect(() => {
    let current = true
    window.oxe.policy.get(workspaceId).then(
      next => { if (current) { setView(next); setError('') } },
      (cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { current = false }
  }, [workspaceId, reloads])

  return <section className="settings-general" data-testid="policy-settings"><h2>Policy</h2>
    <p>Rules that block what agents may use: providers, tools, MCP servers, skills, databases and shared memory.
      They only block; they never grant anything. To change a rule, edit the file. The last matching rule decides,
      so the managed file wins.</p>
    {error ? <div className="settings-callout" role="alert">{error}</div> : null}
    {view?.problems.map(problem => <div key={problem} className="settings-callout" role="alert">Not applied: {problem}</div>)}
    {(view?.locations ?? []).map(({ layer, path }) => {
      const source = view?.sources.find(item => item.path === path)
      return <div key={path}>
        <h3>{LAYERS[layer].label}{source?.organization ? ` · ${source.organization}` : ''}</h3>
        <div className="settings-general-card"><div>
          <p title={path}>{LAYERS[layer].hint}. <code>{path}</code></p>
          {!source ? <p>{view?.problems.some(problem => problem.startsWith(path)) ? 'This file has an error and is ignored.' : 'No file.'}</p>
            : source.rules.length === 0 ? <p>No rules.</p>
              : <ul className="diagnostics-checks" aria-label={`${LAYERS[layer].label} rules`}>
                {source.rules.map((rule, index) => <li key={index} className={`diagnostics-check tone-${rule.effect === 'deny' ? 'warning' : 'ok'}`}>
                  <span className="diagnostics-check-dot" aria-hidden="true" />
                  <span className="diagnostics-check-label">{rule.effect}</span>
                  <span className="diagnostics-check-detail">{rule.action} · {rule.resource}</span>
                </li>)}
              </ul>}
        </div></div>
      </div>
    })}
    <div className="settings-inline-actions">
      <Button variant="ghost" onClick={() => setReloads(count => count + 1)}><RefreshCw size={14} aria-hidden="true" /> Reload policy</Button>
    </div>
  </section>
}
