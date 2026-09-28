import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Search } from 'lucide-react'
import type { SessionSummary } from '../../../shared/types/session'
import { DesktopDialog } from '../Navigation/DesktopDialog'

export function ProviderSessionFinder({ workspaceId, rootPath, onClose }: { workspaceId: string; rootPath: string; onClose: () => void }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void Promise.allSettled(['codex', 'claude'].map(provider => window.oxe.session.list({ workspaceId, workspaceRootPath: rootPath, provider: provider as 'codex' | 'claude' })))
      .then(results => {
        if (!active) return
        setSessions(results.flatMap(result => result.status === 'fulfilled' ? result.value : []).sort((a, b) => b.lastUpdatedMs - a.lastUpdatedMs))
        if (results.some(result => result.status === 'rejected')) setError('Não foi possível carregar todas as sessões. Verifique se Codex e Claude estão instalados.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [workspaceId, rootPath])

  const matches = useMemo(() => sessions.filter(session => `${session.provider} ${session.sessionId} ${session.modelId ?? ''} ${session.firstMessagePreview ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())), [sessions, query])
  const copy = async (value: string, key: string) => {
    try {
      if (!(await window.oxe.clipboard.writeText(value))) throw Error('Clipboard unavailable')
      setCopied(key)
      setError('')
    } catch { setError('Não foi possível copiar o ID da sessão.') }
  }

  return <DesktopDialog className="desktop-provider-sessions-dialog" title="Sessões do Codex e Claude" description="Conversas nativas salvas neste diretório. Identifique a sessão pelo início da conversa e pelo horário." onClose={onClose}>
    <p className="terminal-session-identity-note">IDs do terminal (PTY), painel e workspace não retomam uma conversa do provedor. Um terminal pode ter aberto várias sessões nativas.</p>
    <label className="desktop-provider-session-search"><Search size={14} aria-hidden="true" /><input type="search" aria-label="Buscar sessão nativa" placeholder="Buscar mensagem, modelo ou ID da sessão" value={query} onChange={event => setQuery(event.target.value)} /></label>
    {error && <p className="desktop-provider-session-error" role="alert">{error}</p>}
    {loading ? <p role="status">Carregando sessões nativas…</p> : matches.length ? <div className="desktop-provider-session-list">
      {matches.map(session => <article key={`${session.provider}:${session.sessionId}`} className="desktop-provider-session-card">
        <div className="desktop-provider-session-heading"><strong>{session.firstMessagePreview || `${session.provider === 'codex' ? 'Codex' : 'Claude'} session`}</strong><span>{session.provider === 'codex' ? 'Codex' : 'Claude'}</span></div>
        <p>{session.modelId || 'Modelo desconhecido'} · Atualizada em {new Date(session.lastUpdatedMs).toLocaleString()} · {session.requestCount} {session.requestCount === 1 ? 'pedido' : 'pedidos'}</p>
        <div className="desktop-provider-session-id"><code>{session.sessionId}</code><div><button type="button" aria-label={`Copiar ID da sessão ${session.provider} ${session.sessionId}`} onClick={() => void copy(session.sessionId, `id:${session.sessionId}`)}>{copied === `id:${session.sessionId}` ? <Check size={13} /> : <Copy size={13} />}{copied === `id:${session.sessionId}` ? 'Copiado' : 'Copiar ID'}</button><button type="button" aria-label={`Copiar comando para retomar ${session.provider} ${session.sessionId}`} onClick={() => void copy(`${session.provider === 'claude' ? 'claude --resume' : 'codex resume'} ${session.sessionId}`, `command:${session.sessionId}`)}>{copied === `command:${session.sessionId}` ? <Check size={13} /> : <Copy size={13} />}{copied === `command:${session.sessionId}` ? 'Copiado' : 'Copiar comando'}</button></div></div>
      </article>)}
    </div> : <p className="desktop-provider-session-empty">{query ? 'Nenhuma sessão corresponde à busca.' : 'Nenhuma sessão do Codex ou Claude encontrada neste diretório.'}</p>}
    <p className="desktop-provider-session-help">No Thread, use <code>/resume &lt;ID da sessão nativa&gt;</code> para abrir a mesma conversa neste projeto.</p>
  </DesktopDialog>
}
