import { afterEach, describe, expect, it, vi } from 'vitest'
import { changeLanguage } from '../../src/i18n'
import { findControl, performOxeQueryAction } from '../../src/components/OxeQuery/oxequery-bridge'
import { oxeQueryCommands } from '../../src/components/OxeQuery/oxequery.commands'
import { describeQueryError } from '../../src/components/OxeQuery/QueryError'
import { formatBytes, formatMs } from '../../src/components/OxeQuery/catalog'

const toast = vi.hoisted(() => vi.fn())
vi.mock('../../src/ui/Toast', () => ({ toast }))

afterEach(async () => {
  document.body.innerHTML = ''
  toast.mockClear()
  vi.useRealTimers()
  await changeLanguage('en')
})

describe('palette bridge', () => {
  it('finds a control by its hook only in the visible panel, and never a disabled one', () => {
    document.body.innerHTML = `
      <div class="oq-panel" hidden><button data-oq-action="runAll" id="hidden"></button></div>
      <div class="oq-panel"><button data-oq-action="runAll" id="disabled" disabled></button><button data-oq-action="runAll" id="shown"></button></div>`
    expect(findControl('runAll')?.id).toBe('shown')
    expect(findControl('newTable')).toBeNull()
  })

  it('clicks the control, or says what is needed when the panel on screen has none', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<div class="oq-panel"><button data-oq-action="newQuery"></button></div>'
    const click = vi.fn()
    document.querySelector('button')!.addEventListener('click', click)
    performOxeQueryAction('newQuery')
    expect(click).toHaveBeenCalledOnce()

    performOxeQueryAction('runAll')
    await vi.advanceTimersByTimeAsync(2200)
    vi.useRealTimers()
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Nothing to do here yet', description: 'Open a PostgreSQL connection to run statements.' })))
  })
})

describe('palette commands', () => {
  it('are labelled in the language on screen', async () => {
    expect(oxeQueryCommands().find(command => command.id === 'oxequery.runAll')?.label).toBe('Run all statements')
    await changeLanguage('pt-BR')
    const commands = oxeQueryCommands()
    expect(commands.find(command => command.id === 'oxequery.runAll')?.label).toBe('Executar todas as instruções')
    expect(commands.find(command => command.id === 'oxequery.exportConnections')?.detail).toBe('Sem senhas')
  })
})

describe('query errors and numbers', () => {
  it('explains a known SQLSTATE and an unknown one in the language on screen', async () => {
    expect(describeQueryError({ message: 'x', sqlState: '42P01' }).headline).toMatch(/does not exist/)
    await changeLanguage('pt-BR')
    const known = describeQueryError({ message: 'relation "nope" does not exist', sqlState: '42P01' })
    expect(known.headline).not.toMatch(/does not exist/)
    expect(known.headline).not.toContain('queryError.')
    expect(describeQueryError({ message: 'x', sqlState: '99999' }).headline).not.toContain('queryError.')
    expect(describeQueryError({ message: 'x', code: 'read-only' }).headline).toBe('Esta conexão é somente leitura')
  })

  it('formats bytes and milliseconds with the separators of the language on screen', async () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatMs(1234.5, 1)).toBe('1,234.5 ms')
    await changeLanguage('pt-BR')
    expect(formatBytes(1536)).toBe('1,5 KB')
    expect(formatMs(1234.5, 1)).toBe('1.234,5 ms')
  })
})
