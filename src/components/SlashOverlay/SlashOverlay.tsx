import { ChevronRight, Slash, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { SlashCommandDefinition } from '../../../shared/types/slash'
import type { SkillDefinition } from '../../../shared/types/skill'
import { filterSlashCommands } from '../../lib/slashCommands'

interface SlashOverlayProps {
  paneId: string
  paneLabel: string
  skills?: SkillDefinition[]
  onClose: () => void
  onExecute: (command: SlashCommandDefinition, argument: string) => Promise<void> | void
}

export function SlashOverlay({ paneId, paneLabel, skills = [], onClose, onExecute }: SlashOverlayProps): ReactElement {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [pendingCommand, setPendingCommand] = useState<SlashCommandDefinition | null>(null)
  const [argument, setArgument] = useState('')
  const [executing, setExecuting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => filterSlashCommands(query, skills), [query, skills])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    if (pendingCommand && !pendingCommand.requiresArgument) {
      void runCommand(pendingCommand, '')
    } else if (pendingCommand) {
      inputRef.current?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommand])

  useEffect(() => {
    const item = listRef.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const runCommand = async (cmd: SlashCommandDefinition, arg: string): Promise<void> => {
    if (executing) return
    setExecuting(true)
    try {
      await onExecute(cmd, arg)
    } finally {
      setExecuting(false)
      onClose()
    }
  }

  const handleSelect = (cmd: SlashCommandDefinition): void => {
    if (cmd.requiresArgument) {
      setPendingCommand(cmd)
      setArgument('')
    } else {
      void runCommand(cmd, '')
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (pendingCommand) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setPendingCommand(null)
        setArgument('')
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (argument.trim()) void runCommand(pendingCommand, argument.trim())
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((i) => Math.min(filtered.length - 1, i + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((i) => Math.max(0, i - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const cmd = filtered[selectedIndex]
      if (cmd) handleSelect(cmd)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'Tab') {
      event.preventDefault()
      const cmd = filtered[selectedIndex]
      if (cmd) setQuery(cmd.label)
    }
  }

  return (
    <div className="slash-overlay-backdrop" role="presentation" onMouseDown={onClose} data-pane-id={paneId}>
      <section
        className="slash-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={`Comandos para ${paneLabel}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="slash-overlay-header">
          <div className="slash-overlay-pane-tag">
            <Slash size={11} aria-hidden="true" />
            <span>{paneLabel}</span>
          </div>
          <button type="button" className="icon-button" aria-label="Fechar" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        {pendingCommand ? (
          <div className="slash-overlay-argument">
            <div className="slash-overlay-argument-header">
              <strong>{pendingCommand.label}</strong>
              <span>{pendingCommand.description}</span>
            </div>
            <input
              ref={inputRef}
              autoFocus
              className="slash-overlay-input"
              placeholder={pendingCommand.argumentPlaceholder ?? 'argumento'}
              value={argument}
              onChange={(event) => setArgument(event.currentTarget.value)}
              onKeyDown={handleKeyDown}
            />
            <div className="slash-overlay-hint">
              <span>Enter para executar</span>
              <span>Esc para voltar</span>
            </div>
          </div>
        ) : (
          <>
            <div className="slash-overlay-search">
              <Slash size={14} aria-hidden="true" />
              <input
                ref={inputRef}
                autoFocus
                className="slash-overlay-input"
                placeholder="Digite um comando…"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={handleKeyDown}
              />
            </div>

            <div className="slash-overlay-list" ref={listRef} role="listbox">
              {filtered.map((cmd, index) => (
                <button
                  type="button"
                  key={cmd.id}
                  data-index={index}
                  className={`slash-overlay-item${index === selectedIndex ? ' active' : ''}${cmd.destructive ? ' destructive' : ''}`}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => handleSelect(cmd)}
                  role="option"
                  aria-selected={index === selectedIndex}
                >
                  <div className="slash-overlay-item-main">
                    <strong>{cmd.label}</strong>
                    <span>{cmd.description}</span>
                  </div>
                  <div className="slash-overlay-item-aside">
                    <span className="slash-overlay-hint-chip">{cmd.hint}</span>
                    {cmd.requiresArgument ? <ChevronRight size={12} aria-hidden="true" /> : null}
                  </div>
                </button>
              ))}
              {filtered.length === 0 ? (
                <div className="slash-overlay-empty">Nenhum comando encontrado para “{query}”</div>
              ) : null}
            </div>

            <footer className="slash-overlay-footer">
              <span>↑↓ navegar</span>
              <span>↵ executar</span>
              <span>Tab autocompletar</span>
              <span>Esc fechar</span>
            </footer>
          </>
        )}
      </section>
    </div>
  )
}
