import { AlertTriangle, ArrowRight, Download, ExternalLink, FolderPlus, LayoutDashboard, PackagePlus, RotateCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { OxeAgentSkill } from '../../../shared/types/oxe'
import type { Workspace } from '../../../shared/types/workspace'
import { selectOxe, selectOxeSummary, useOxeStore } from '../../store/oxe.store'
import { useTerminalStore } from '../../store/terminal.store'

interface OxePanelBodyProps {
  workspace: Workspace
}

// Friendly label + the `oxe install` flag that installs that agent's skills.
const AGENT_INSTALL: Record<string, { label: string; cmd: string }> = {
  'copilot-cli': { label: 'Copilot CLI', cmd: 'oxe install --copilot-cli' },
  'copilot-vscode': { label: 'Copilot (VS Code)', cmd: 'oxe install --copilot' },
  copilot: { label: 'Copilot', cmd: 'oxe install --copilot' },
  codex: { label: 'Codex', cmd: 'oxe install --codex' },
  cursor: { label: 'Cursor', cmd: 'oxe install --cursor' }
}

/**
 * Native, opt-in OXE (oxe-cc) panel. Reads the cheap `status --json --summary`
 * live (re-fetched whenever the workspace's .oxe/ changes) and surfaces
 * phase/health + the next step + per-agent skill gaps. Next-step / install
 * actions INJECT a command into the active terminal (reusing the existing
 * `oxe:terminal-insert-text` channel) — the vibe coder confirms with Enter,
 * keeping control. The dashboard is embedded in an iframe. oxe-cc stays an
 * external tool; everything degrades on older versions.
 */
export function OxePanelBody({ workspace }: OxePanelBodyProps): ReactElement {
  const rootPath = workspace.rootPath
  const summaryResult = useOxeStore(useMemo(() => selectOxeSummary(rootPath), [rootPath]))
  const fullResult = useOxeStore(useMemo(() => selectOxe(rootPath), [rootPath]))
  const summaryLoading = useOxeStore((s) => s.summaryLoading[rootPath] === true)
  const lastUpdatedAt = useOxeStore((s) => s.lastUpdatedAt[rootPath])
  const dashboard = useOxeStore((s) => s.dashboardByRoot[rootPath])
  const subscribe = useOxeStore((s) => s.subscribe)
  const unsubscribe = useOxeStore((s) => s.unsubscribe)
  const refresh = useOxeStore((s) => s.refresh)
  const refreshSummary = useOxeStore((s) => s.refreshSummary)
  const startDashboard = useOxeStore((s) => s.startDashboard)
  const stopDashboard = useOxeStore((s) => s.stopDashboard)
  const activePaneId = useTerminalStore((s) => s.activePaneId)

  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [pulse, setPulse] = useState(false)

  // React to .oxe/ changes while the panel is mounted; also pull the full
  // status once for the diagnostics detail. Tear down on unmount.
  useEffect(() => {
    void subscribe(rootPath)
    void refresh(rootPath)
    return () => { void unsubscribe(rootPath) }
  }, [rootPath, subscribe, unsubscribe, refresh])

  // Brief "live" pulse whenever a fresh summary lands.
  useEffect(() => {
    if (!lastUpdatedAt) return
    setPulse(true)
    const t = setTimeout(() => setPulse(false), 1200)
    return () => clearTimeout(t)
  }, [lastUpdatedAt])

  // Stop the embedded dashboard server when the panel closes / workspace changes.
  useEffect(() => () => { void stopDashboard(rootPath) }, [rootPath, stopDashboard])

  const targetPaneId = useMemo(() => {
    const terminals = workspace.panes.filter((p) => p.type === 'terminal')
    if (activePaneId && terminals.some((p) => p.id === activePaneId)) return activePaneId
    return terminals[0]?.id ?? null
  }, [workspace.panes, activePaneId])

  const inject = useCallback((text: string): void => {
    if (!targetPaneId) return
    window.dispatchEvent(new CustomEvent('oxe:terminal-insert-text', { detail: { paneId: targetPaneId, text } }))
  }, [targetPaneId])

  const toggleDashboard = useCallback((): void => {
    if (dashboardOpen) {
      setDashboardOpen(false)
      void stopDashboard(rootPath)
    } else {
      setDashboardOpen(true)
      void startDashboard(rootPath)
    }
  }, [dashboardOpen, rootPath, startDashboard, stopDashboard])

  // Prefer the cheap summary; fall back to the full status fields when an older
  // oxe-cc doesn't support --summary.
  const summary = summaryResult?.summary ?? null
  const full = fullResult?.status ?? null
  const installed = summaryResult?.installed ?? fullResult?.installed ?? false
  const version = summaryResult?.version ?? fullResult?.version ?? null
  const isOxeProject = summaryResult?.isOxeProject ?? fullResult?.isOxeProject ?? false
  const error = summaryResult?.error ?? fullResult?.error ?? null

  const onRetry = useCallback(() => { void refreshSummary(rootPath, true); void refresh(rootPath, true) }, [rootPath, refreshSummary, refresh])

  if (!summaryResult && !fullResult && summaryLoading) {
    return <div className="oxe-panel-empty"><RotateCw size={16} className="usage-spin" aria-hidden="true" /><span>Carregando OXE…</span></div>
  }
  if (!summaryResult && !fullResult) {
    return <div className="oxe-panel-empty"><span>—</span></div>
  }

  // ── Onboarding: oxe-cc not installed ──────────────────────────────
  if (!installed) {
    return (
      <div className="oxe-panel">
        <OxeOnboarding
          icon={<Download size={20} aria-hidden="true" />}
          title="OXE não detectado"
          body="O CLI oxe-cc não foi encontrado. Instale-o globalmente para ativar a disciplina OXE (spec → plan → execute → verify) neste workspace."
          actionLabel="Instalar OXE no terminal"
          onAction={() => inject('npm install -g oxe-cc')}
          disabled={!targetPaneId}
          hint={!targetPaneId ? 'Abra um terminal para receber o comando.' : 'O comando será inserido no terminal ativo — confirme com Enter.'}
          link="https://www.npmjs.com/package/oxe-cc"
          onRetry={onRetry}
          retryBusy={summaryLoading}
        />
      </div>
    )
  }

  // ── Onboarding: installed, but this workspace isn't an OXE project ─
  if (!isOxeProject) {
    return (
      <div className="oxe-panel">
        <div className="oxe-panel-version">oxe-cc v{version ?? '?'}</div>
        <OxeOnboarding
          icon={<FolderPlus size={20} aria-hidden="true" />}
          title="Este workspace ainda não usa OXE"
          body="Inicialize o OXE para criar a pasta .oxe/ e os comandos do ciclo neste projeto."
          actionLabel="Inicializar OXE no terminal"
          onAction={() => inject('oxe install')}
          disabled={!targetPaneId}
          hint={!targetPaneId ? 'Abra um terminal para receber o comando.' : 'O comando será inserido no terminal ativo — confirme com Enter.'}
          onRetry={onRetry}
          retryBusy={summaryLoading}
        />
      </div>
    )
  }

  const health = (summary?.healthStatus ?? full?.healthStatus ?? 'unknown').toLowerCase()
  const phase = summary?.phase ?? full?.phase ?? null
  const activeSession = summary?.activeSession ?? full?.activeSession ?? null
  const cursorCmd = summary?.cursorCmd ?? full?.cursorCmd ?? null
  const reason = summary?.reason ?? full?.reason ?? null

  const agentSkills: OxeAgentSkill[] = summary?.agentSkills
    ?? full?.agentSkills?.map((a) => ({ agent: a.agent, skillsInstalled: a.skillsInstalled }))
    ?? []
  const missingSkills = agentSkills.filter((a) => !a.skillsInstalled && a.agent in AGENT_INSTALL)

  const warnings = [
    ...(full?.criticalExecutionGaps ?? []),
    ...(full?.planSelfEvaluation?.warnings ?? [])
  ].slice(0, 5)
  const warningsCount = summary?.warningsCount ?? warnings.length

  return (
    <div className="oxe-panel">
      {/* Header: version + live indicator + refresh */}
      <div className="oxe-panel-header">
        <span className="oxe-panel-version">oxe-cc v{version ?? '?'}</span>
        <span className={`oxe-live-dot${pulse ? ' live' : ''}`} title="Atualiza ao vivo conforme o agente progride" aria-hidden="true" />
        <button type="button" className="tile-btn oxe-panel-refresh" aria-label="Atualizar status do OXE" title="Atualizar" disabled={summaryLoading} onClick={onRetry}>
          <RotateCw size={12} className={summaryLoading ? 'usage-spin' : ''} aria-hidden="true" />
        </button>
      </div>
      <div className="oxe-panel-state">
        <span className={`oxe-health-dot oxe-health-${health}`} aria-hidden="true" />
        <strong className="oxe-health-label">{health}</strong>
        <span className="oxe-panel-meta">
          {phase ? `Fase: ${phase}` : 'Fase: —'}
          {activeSession ? ` · ${activeSession}` : ''}
        </span>
      </div>

      {/* Skills onboarding — unblock agents before launching them */}
      {missingSkills.length > 0 ? (
        <section className="oxe-panel-section">
          <div className="oxe-panel-kicker">Skills do OXE</div>
          <ul className="oxe-skills">
            {missingSkills.map((a) => {
              const meta = AGENT_INSTALL[a.agent]
              return (
                <li key={a.agent} className="oxe-skill-card">
                  <div className="oxe-skill-info">
                    <span className="oxe-skill-badge missing" aria-hidden="true" />
                    <span>Skills <code>/oxe-*</code> ausentes para <strong>{meta.label}</strong></span>
                  </div>
                  <button
                    type="button"
                    className="oxe-panel-action"
                    onClick={() => inject(meta.cmd)}
                    disabled={!targetPaneId}
                    title={targetPaneId ? `Inserir "${meta.cmd}" no terminal (confirme com Enter)` : 'Abra um terminal primeiro'}
                  >
                    <PackagePlus size={12} aria-hidden="true" />
                    Instalar skills
                  </button>
                </li>
              )
            })}
          </ul>
          {!targetPaneId ? <p className="oxe-panel-hint">Abra um terminal para enviar o comando de instalação.</p> : null}
        </section>
      ) : null}

      {/* Next step — the core of the flow */}
      {cursorCmd ? (
        <section className="oxe-panel-section">
          <div className="oxe-panel-kicker">Próximo passo</div>
          <button
            type="button"
            className="oxe-nextstep"
            onClick={() => inject(cursorCmd)}
            disabled={!targetPaneId}
            title={targetPaneId ? 'Inserir no terminal ativo (confirme com Enter)' : 'Abra um terminal primeiro'}
          >
            <code>{cursorCmd}</code>
            <ArrowRight size={14} aria-hidden="true" />
          </button>
          {reason ? <p className="oxe-nextstep-reason">{reason}</p> : null}
          {!targetPaneId ? <p className="oxe-panel-hint">Abra um terminal para enviar o comando.</p> : null}
        </section>
      ) : null}

      {/* Diagnostics — detail from the full status, count stays live */}
      {warningsCount > 0 ? (
        <section className="oxe-panel-section">
          <div className="oxe-panel-kicker">Diagnóstico {warningsCount > warnings.length ? `(${warningsCount})` : ''}</div>
          {warnings.length > 0 ? (
            <ul className="oxe-diagnostics">
              {warnings.map((w, i) => (
                <li key={i}><AlertTriangle size={11} aria-hidden="true" /><span>{w}</span></li>
              ))}
            </ul>
          ) : (
            <p className="oxe-panel-hint">{warningsCount} aviso(s) — atualize para ver os detalhes.</p>
          )}
        </section>
      ) : null}

      {error ? <p className="oxe-panel-error">{error}</p> : null}

      {/* Embedded dashboard */}
      {dashboardOpen ? (
        <section className="oxe-panel-section oxe-dashboard-section">
          <div className="oxe-dashboard-bar">
            <span className="oxe-panel-kicker">Dashboard</span>
            <button type="button" className="tile-btn" aria-label="Fechar dashboard" title="Fechar" onClick={toggleDashboard}>
              <X size={12} aria-hidden="true" />
            </button>
          </div>
          {dashboard?.busy ? (
            <div className="oxe-panel-empty"><RotateCw size={14} className="usage-spin" aria-hidden="true" /><span>Iniciando dashboard…</span></div>
          ) : dashboard?.mode === 'embedded' && dashboard.url ? (
            <iframe className="oxe-dashboard-frame" src={dashboard.url} title="OXE dashboard" />
          ) : dashboard?.mode === 'external' ? (
            <p className="oxe-panel-hint">Dashboard aberto no navegador (oxe-cc &lt; 1.14 não suporta embed). Atualize o oxe-cc para incorporar aqui.</p>
          ) : (
            <p className="oxe-panel-error">{dashboard?.error ?? 'Não foi possível iniciar o dashboard.'}</p>
          )}
        </section>
      ) : null}

      {/* Actions */}
      <div className="oxe-panel-actions">
        <button type="button" className="oxe-panel-action" onClick={toggleDashboard}>
          <LayoutDashboard size={12} aria-hidden="true" />
          {dashboardOpen ? 'Ocultar dashboard' : 'Abrir dashboard'}
        </button>
      </div>
    </div>
  )
}

function OxeOnboarding({ icon, title, body, actionLabel, onAction, disabled, hint, link, onRetry, retryBusy }: {
  icon: ReactElement
  title: string
  body: string
  actionLabel: string
  onAction: () => void
  disabled: boolean
  hint: string
  link?: string
  onRetry: () => void
  retryBusy: boolean
}): ReactElement {
  return (
    <div className="oxe-onboarding">
      <div className="oxe-onboarding-icon">{icon}</div>
      <strong>{title}</strong>
      <p>{body}</p>
      <button type="button" className="oxe-panel-action primary" onClick={onAction} disabled={disabled}>{actionLabel}</button>
      <button type="button" className="oxe-onboarding-retry" onClick={onRetry} disabled={retryBusy}>
        <RotateCw size={11} className={retryBusy ? 'usage-spin' : ''} aria-hidden="true" />
        Já instalei — verificar novamente
      </button>
      <p className="oxe-panel-hint">{hint}</p>
      {link ? <a className="oxe-onboarding-link" href={link} target="_blank" rel="noreferrer">npmjs.com/package/oxe-cc <ExternalLink size={10} aria-hidden="true" /></a> : null}
    </div>
  )
}
