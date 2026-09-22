import { useEffect, useState } from 'react'
import { Check, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import type { AgentAccountContext, AgentAccountSnapshot } from '../../../shared/types/agentAuth'
import type { ThreadProvider } from '../../../shared/types/thread'
import { useAccountStore, selectAccount } from '../../store/account.store'
import { useThreadStore } from '../../store/thread.store'
import { DesktopDialog } from '../Navigation/DesktopDialog'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { useUIStore } from '../../store/ui.store'

export function accountMessage(status?: AgentAccountSnapshot): string {
  if (!status) return 'Checking connection…'
  if (status.errorCode === 'active-turn') return 'Stop the active turn before reconnecting.'
  if (status.errorCode === 'timeout') return 'Sign-in timed out. Try connecting again.'
  if (status.errorCode === 'cancelled') return 'Sign-in cancelled.'
  if (status.errorCode === 'configuration') return 'Another sign-in is active, or the native configuration needs attention.'
  if (status.state === 'missing-cli') return 'Install the native agent or update its executable in Agents.'
  if (status.state === 'error') return 'Could not verify the connection. Check your native agent and try again.'
  if (status.state === 'connected') return status.method === 'subscription' ? `${status.planLabel ? `${status.planLabel} · ` : ''}Subscription connected` : 'Another authentication method is active. Connect with your subscription.'
  if (status.state === 'awaiting-code') return 'Finish in your browser, or paste the code shown there.'
  if (status.state === 'awaiting-browser') return 'Complete sign-in in your browser.'
  if (status.state === 'connecting' || status.state === 'checking') return 'Connecting…'
  return 'Connect your subscription to send messages.'
}
export function accountContext(provider: ThreadProvider, workspaceId: string, thread?: { id: string; provider: ThreadProvider }): AgentAccountContext {
  return { provider, workspaceId, ...(thread?.provider === provider ? { threadId: thread.id } : {}) }
}
function AccountCard({ context }: { context: AgentAccountContext }) {
  const status = useAccountStore(selectAccount(context))
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [code, setCode] = useState('')
  const busy = Boolean(status?.attemptId)
  const connected = status?.state === 'connected' && status.method === 'subscription'
  const run = async (action: () => Promise<unknown>) => { setPending(true); setError(''); try { await action() } catch { setError('Could not complete this action. Try again.') } finally { setPending(false) } }
  return <section className="thread-account-card"><div className="thread-account-heading"><AgentProviderIcon provider={context.provider} size={28} /><div><strong>{context.provider === 'claude' ? 'Claude Code' : 'Codex'}</strong><small>{context.provider === 'claude' ? 'Claude subscription' : 'ChatGPT subscription'}</small></div>{connected ? <Check size={16} /> : busy ? <Loader2 size={16} className="thread-spin" /> : null}</div>
    <p>{accountMessage(status)}</p>{status?.accountLabel && <small>{status.accountLabel}</small>}
    {status?.state === 'awaiting-code' && <form className="thread-auth-code" onSubmit={e => { e.preventDefault(); void run(async () => { await window.oxe!.agentAccount!.submitCode(status.attemptId!, code); setCode('') }) }}><label>Sign-in code<input autoComplete="off" type="password" value={code} onChange={e => setCode(e.target.value)} /></label><button type="submit" disabled={!code || pending}>Continue</button></form>}
    <div className="thread-account-actions">{busy ? <><button type="button" disabled={pending} onClick={() => void run(() => window.oxe!.agentAccount!.cancel(status!.attemptId!))}>Cancel sign-in</button>{status?.canOpenBrowser && <button type="button" disabled={pending} onClick={() => void run(() => window.oxe!.agentAccount!.openBrowser(status.attemptId!))}><ExternalLink size={12} />Open browser</button>}</> : <><button type="button" className={connected ? '' : 'thread-primary'} disabled={pending || !window.oxe?.agentAccount} onClick={() => void run(() => useAccountStore.getState().login(context))}>{connected ? 'Reconnect' : 'Connect'}</button>{connected && <button type="button" disabled={pending || !window.oxe?.agentAccount} onClick={() => void run(() => useAccountStore.getState().logout(context))}>Sign out</button>}<button type="button" disabled={pending || !window.oxe?.agentAccount} onClick={() => void run(() => useAccountStore.getState().read(context))}><RefreshCw size={12} />Verify</button></>}</div>
    {error && <p role="alert">{error}</p>}
  </section>
}
export function ProviderAccountsPanel({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const thread = useThreadStore(state => state.snapshot?.thread)
  const threadId = thread?.id, threadProvider = thread?.provider
  useEffect(() => {
    const refresh = () => {
      for (const provider of ['claude', 'codex'] as const) void useAccountStore.getState().read(accountContext(provider, workspaceId, threadId && threadProvider ? { id: threadId, provider: threadProvider } : undefined))
    }
    refresh()
    let lastFocus = Date.now()
    const focus = () => { if (Date.now() - lastFocus > 5000) { lastFocus = Date.now(); refresh() } }
    window.addEventListener('focus', focus)
    return () => { window.removeEventListener('focus', focus) }
  }, [workspaceId, threadId, threadProvider])
  return <DesktopDialog className="thread-accounts-dialog" title="Agent accounts" description="Use your subscription with the native agent." onClose={onClose}>
    {(['claude', 'codex'] as const).map(provider => <AccountCard key={provider} context={accountContext(provider, workspaceId, thread)} />)}
    <p className="thread-account-note">Credentials stay with Claude Code and Codex. Reconnecting changes the native account also used by your CLI sessions.</p>
    <footer><button type="button" onClick={() => { onClose(); useUIStore.getState().openAgentSettings() }}>Agents</button><button type="button" onClick={onClose}>Done</button></footer>
  </DesktopDialog>
}
