import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CornerDownLeft, TerminalSquare } from 'lucide-react'
import type { ConversationThread, ThreadCliState } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import { TerminalView } from '../Terminal/TerminalView'
import { useResolvedTerminalPrefs } from '../../store/terminal-prefs.store'

export function ThreadCliPanel({ thread, workspace, onReturn, onError, error }: {
  thread: ConversationThread; workspace?: Workspace; onReturn: () => Promise<void>; onError: (message: string) => void; error?: string
}) {
  const api = window.oxe.thread?.cli
  const [state, setState] = useState<ThreadCliState>({ running: Boolean(thread.cliActive), nativeSessionId: thread.nativeSessionId })
  const [pending, setPending] = useState(false)
  const [linkId, setLinkId] = useState('')
  const prefs = useResolvedTerminalPrefs(thread.workspaceId)
  const transport = useMemo(() => api ? {
    onData: api.onData, onExit: api.onExit,
    attach: ({ paneId }: { paneId: string }) => api.attach(paneId),
    detach: ({ paneId }: { paneId: string }) => api.detach(paneId)
  } : undefined, [api])
  useEffect(() => {
    let active = true
    void api?.state(thread.id).then(value => { if (active) setState(value) }).catch(() => { if (active) onError('Could not connect to the native CLI.') })
    return () => { active = false }
  }, [api, thread.id, onError])
  const action = async (run: () => Promise<void>) => {
    setPending(true)
    try { await run() } catch (error) { onError(error instanceof Error ? error.message : 'Native CLI action failed.') }
    finally { setPending(false) }
  }
  return <div className="thread-native-cli" aria-label="Native CLI">
    <div className="thread-native-toolbar"><TerminalSquare size={15} /><strong>{thread.provider === 'claude' ? 'Claude Code' : 'Codex'} CLI</strong><span title={thread.rootPath}>{thread.rootPath.split(/[\\/]/).filter(Boolean).at(-1)}</span><small>{state.running ? 'Native session' : 'Session ended'}</small><button type="button" disabled={pending} title="Close the CLI process and return to the conversation" onClick={() => void action(onReturn)}><ArrowLeft size={13} />Return to thread</button></div>
    {state.pendingCommand && <div className="thread-native-command"><code>{state.pendingCommand}</code><span>Complete any sign-in or project trust prompt first.</span><button type="button" disabled={pending || !state.running} onClick={() => void action(async () => {
      await api!.insertCommand(thread.id); setState(await api!.state(thread.id))
      window.dispatchEvent(new CustomEvent('oxe:focus-pane', { detail: { paneId: thread.id } }))
    })}><CornerDownLeft size={13} />Insert command</button></div>}
    {error && <div role="alert" className="thread-action-error">{error}</div>}
    <div className="thread-native-surface">{api && <TerminalView paneId={thread.id} isRunning={state.running} transport={transport} themeId={workspace?.themeId ?? 'one-dark'} prefs={prefs}
      onInput={data => { void api.write(thread.id, data).catch(() => onError('Could not send input to the CLI.')) }}
      onResize={(cols, rows) => { void api.resize(thread.id, Math.max(2, Math.min(500, cols)), Math.max(2, Math.min(500, rows))).catch(() => {}) }}
      onExit={() => setState(value => ({ ...value, running: false }))} />}</div>
    <footer><div><span>The CLI handles commands, tools and approvals.</span><span>{state.pendingCommand ? 'Insert the command, then press Enter in the CLI.' : 'Exit with /quit to save the session before returning.'}</span></div>
      <details className="thread-native-link"><summary>Saved session</summary><form onSubmit={event => { event.preventDefault(); void action(async () => { await api!.linkSession(thread.id, linkId.trim()); setState(await api!.state(thread.id)); setLinkId('') }) }}><p>If you changed sessions inside the CLI, link the saved session ID to import it when returning.</p><label>Session ID<input aria-label="Native session ID" value={linkId} placeholder={state.nativeSessionId ?? 'UUID from the CLI session'} onChange={event => setLinkId(event.target.value)} /></label><button type="submit" disabled={pending || !linkId.trim()}>Link session</button>{state.nativeSessionId && <small>Linked: {state.nativeSessionId}</small>}</form></details>
    </footer>
  </div>
}
