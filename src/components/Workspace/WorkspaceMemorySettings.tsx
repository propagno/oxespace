import { useEffect, useState, type ReactElement } from 'react'
import type { MemorySettings, MemoryRuntimeSettings, MemoryWorkspaceStatus } from '../../../shared/types/memory'

export function WorkspaceMemorySettings({ workspaceId }: { workspaceId: string }): ReactElement {
  const [status, setStatus] = useState<MemoryWorkspaceStatus | null>(null)
  const [settings, setSettings] = useState<MemorySettings>({ enabled: false, automaticCapture: false, automaticContext: false })
  const [runtime, setRuntime] = useState<MemoryRuntimeSettings>({ mode: 'managed', executable: 'ai-memory', url: 'http://127.0.0.1:49374' })
  const [token, setToken] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [memories, setMemories] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    setStatus(null)
    setMemories([])
    setMessage('')
    if (!window.oxe?.memory) return
    void window.oxe.memory.status(workspaceId).then(value => {
      if (alive) { setStatus(value); setSettings(value.settings); setRuntime(value.runtime) }
    }).catch(() => { if (alive) setMessage('Memory service is unavailable') })
    return () => { alive = false }
  }, [workspaceId])
  const act = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true); setMessage('')
    try { await fn() } catch (error) { setMessage(error instanceof Error ? error.message : 'Memory operation failed') }
    finally { setBusy(false) }
  }
  return <section className="ws-settings-section" aria-labelledby="ws-memory-title">
    <header className="ws-settings-section-header"><h3 id="ws-memory-title">Shared Project Memory</h3></header>
    <p>AI Memory · {status?.health.status ?? 'disabled'} {status?.health.message}</p>
    <p>Local knowledge shared across this repository’s worktrees. Each agent keeps its own session.</p>
    <fieldset disabled={busy || !status} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <label><input type="checkbox" checked={settings.enabled} disabled={busy} onChange={e => setSettings({ ...settings, enabled: e.target.checked })} /> Enabled</label>
    <br />
    <label><input type="checkbox" checked={settings.automaticCapture} disabled={busy} onChange={e => setSettings({ ...settings, automaticCapture: e.target.checked })} /> Capture project activity through native hooks</label>
    <br />
    <label><input type="checkbox" checked={settings.automaticContext} disabled={busy} onChange={e => setSettings({ ...settings, automaticContext: e.target.checked })} /> Supply relevant context to new agent sessions</label>
    <p>Captured prompts, tool activity and supported Claude assistant excerpts stay in the local memory service. Context supplied to a cloud agent can be sent to that agent’s vendor. No cloud model is configured for the managed memory service.</p>
    <label>Runtime <select value={runtime.mode} disabled={busy} onChange={e => setRuntime({ ...runtime, mode: e.target.value as MemoryRuntimeSettings['mode'] })}>
      <option value="managed">Managed local service</option><option value="connected">Existing local service</option>
    </select></label>
    <br />
    <label>AI Memory executable <input value={runtime.executable} disabled={busy} onChange={e => setRuntime({ ...runtime, executable: e.target.value })} /></label>
    <br />
    <label>Local service URL <input value={runtime.url} disabled={busy} onChange={e => setRuntime({ ...runtime, url: e.target.value })} /></label>
    {runtime.mode === 'connected' && <><p>Existing service configuration controls external model calls. Connect only after reviewing its privacy settings.</p><label>Bearer token <input type="password" autoComplete="off" value={token} disabled={busy} onChange={e => setToken(e.target.value)} /></label></>}
    <p>Native Windows support is experimental. Agent terminals continue working when memory is unavailable.</p>
    <div>
      <button type="button" disabled={busy} onClick={() => void act(async () => { const executable = await window.oxe.memory.install(); setRuntime({ ...runtime, executable }); setMessage('Verified AI Memory 2.1.0 downloaded. Apply settings to use it.') })}>Download local runtime</button>{' '}
      <button type="button" disabled={busy} onClick={() => void act(async () => { const value = await window.oxe.memory.configure({ workspaceId, settings, runtime, ...(token ? { token } : {}) }); setStatus(value); setToken(''); setMessage('Memory settings applied. Configure agents, then start a new terminal.') })}>Apply memory settings</button>{' '}
      <button type="button" disabled={busy || !status?.settings.enabled} onClick={() => void act(async () => setMessage(await window.oxe.memory.setupAgents(workspaceId)))}>Configure Claude / Codex</button>{' '}
      <button type="button" disabled={busy} onClick={() => void act(async () => { setStatus(await window.oxe.memory.status(workspaceId)); const result = await window.oxe.memory.recent(workspaceId); setMemories(result.status === 'ok' ? result.value.map(item => item.text) : []); if (result.status !== 'ok') setMessage(result.message) })}>Refresh</button>
    </div>
    </fieldset>
    {status && <p>Project: {status.projectId} · Connected sessions: {status.sessions.filter(s => !s.ended).length}</p>}
    {message && <p role="status">{message}</p>}
    {memories.length > 0 && <details><summary>Recent memories</summary>{memories.map((item, index) => <pre key={index} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item}</pre>)}</details>}
  </section>
}
