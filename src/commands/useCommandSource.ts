import { useEffect, useLayoutEffect, useRef } from 'react'
import { registerCommands, type ContributedCommand } from '../utils/commandRegistry'

/**
 * Registers commands built from component state. They are registered again only
 * when what the palette shows changes (ids, labels, disabled state, shortcuts),
 * never on every render, and `run` always calls the latest handler.
 */
export function useCommandSource(source: string, commands: ContributedCommand[]): void {
  const latest = useRef(commands)
  useLayoutEffect(() => { latest.current = commands })
  const signature = commands.map(command => `${command.id}\u0000${command.label}\u0000${command.detail ?? ''}\u0000${command.disabled ? 1 : 0}\u0000${command.shortcut ?? ''}\u0000${command.category}`).join('\u0001')
  useEffect(() => {
    registerCommands(source, latest.current.map(command => ({
      ...command,
      run: () => latest.current.find(item => item.id === command.id)?.run()
    })))
  }, [source, signature])
  useEffect(() => () => { registerCommands(source, []) }, [source])
}
