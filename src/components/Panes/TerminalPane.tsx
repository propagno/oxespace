import { Play } from 'lucide-react'
import { useCallback, useEffect, type ReactElement } from 'react'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { useAgentStore } from '../../store/agent.store'
import { useTerminalStore } from '../../store/terminal.store'
import { TerminalView } from '../Terminal/TerminalView'

interface TerminalPaneProps {
  pane: WorkspacePane
  workspaceId: string
  autoStart: boolean
}

export function TerminalPane({ autoStart, pane, workspaceId }: TerminalPaneProps): ReactElement {
  const { getStatus, setStatus, consumePendingCommand } = useTerminalStore()
  const allProfiles = useAgentStore((s) => s.allProfiles)
  const state = getStatus(pane.id)
  const isRunning = state.status === 'running' || state.status === 'starting'

  const resolveAgentInfo = useCallback((): { command: string | undefined; initialPrompt: string | undefined } => {
    const pending = consumePendingCommand(pane.id)
    if (pending) return { command: pending, initialPrompt: undefined }
    if (!pane.agentProfileId) return { command: undefined, initialPrompt: undefined }
    const profile = allProfiles.find((p) => p.agentProfileId === pane.agentProfileId)
    if (!profile) return { command: undefined, initialPrompt: undefined }
    if (profile.parentProvider) {
      const parent = allProfiles.find((p) => p.provider === profile.parentProvider)
      return { command: parent?.command, initialPrompt: profile.systemPrompt }
    }
    return { command: profile.command, initialPrompt: undefined }
  }, [consumePendingCommand, pane.id, pane.agentProfileId, allProfiles])

  const start = useCallback(async (): Promise<void> => {
    setStatus(pane.id, 'starting')
    try {
      const { command: agentCommand, initialPrompt } = resolveAgentInfo()
      await window.oxe.terminal.start({ paneId: pane.id, workspaceId, agentCommand, initialPrompt })
      setStatus(pane.id, 'running')
    } catch (error) {
      setStatus(pane.id, 'error', toMessage(error))
    }
  }, [resolveAgentInfo, pane.id, setStatus, workspaceId])

  useEffect(() => {
    if (autoStart && state.status === 'idle') {
      void start()
    }
  }, [autoStart, start, state.status])

  const stop = async (): Promise<void> => {
    await window.oxe.terminal.stop({ paneId: pane.id })
    setStatus(pane.id, 'idle')
  }

  const restart = async (): Promise<void> => {
    setStatus(pane.id, 'starting')
    try {
      const { command: agentCommand, initialPrompt } = resolveAgentInfo()
      await window.oxe.terminal.stop({ paneId: pane.id })
      await window.oxe.terminal.start({ paneId: pane.id, workspaceId, agentCommand, initialPrompt })
      setStatus(pane.id, 'running')
    } catch (error) {
      setStatus(pane.id, 'error', toMessage(error))
    }
  }

  const statusDotClass = state.status === 'running' ? 'green'
    : state.status === 'starting' ? 'yellow'
    : state.status === 'error' ? 'red'
    : ''

  return (
    <div className="terminal-pane" data-testid="terminal-pane">
      {state.error ? <div className="terminal-error-bar">{state.error}</div> : null}

      {isRunning ? (
        <div className="terminal-content">
          <TerminalView
            paneId={pane.id}
            isRunning={isRunning}
            onInput={(data) => {
              if (isRunning) void window.oxe.terminal.write({ paneId: pane.id, data })
            }}
            onResize={(cols, rows) => {
              if (isRunning) void window.oxe.terminal.resize({ paneId: pane.id, cols, rows })
            }}
            onExit={(exitCode) => {
              setStatus(pane.id, 'exited', exitCode === null ? undefined : `Exited with code ${exitCode}`)
            }}
          />
        </div>
      ) : (
        <div className="terminal-idle">
          <button
            type="button"
            className="btn-start-terminal"
            aria-label="Start terminal"
            onClick={() => void start()}
            disabled={state.status === 'starting'}
          >
            <Play size={14} aria-hidden="true" />
            {state.status === 'starting' ? 'Starting…' : 'Start Terminal'}
          </button>
        </div>
      )}

      <div className="terminal-statusbar">
        <span className={`statusbar-dot ${statusDotClass}`} aria-hidden="true" />
        <span className="statusbar-text">{state.status}</span>
        {isRunning ? (
          <button
            type="button"
            className="statusbar-action"
            aria-label="Stop terminal"
            onClick={() => void stop()}
          >
            stop
          </button>
        ) : state.status === 'exited' ? (
          <button
            type="button"
            className="statusbar-action"
            aria-label="Restart terminal"
            onClick={() => void restart()}
          >
            restart
          </button>
        ) : null}
      </div>
    </div>
  )
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Terminal error'
}
