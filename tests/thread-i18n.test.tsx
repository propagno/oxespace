import { afterEach, describe, expect, it } from 'vitest'
import { threadConfirmation } from '../shared/threadConfirmations'
import { changeLanguage } from '../src/i18n'
import { localizeConfirmation, threadConfirmationText } from '../src/components/Threads/threadConfirmationText'
import { threadPanelLabel, threadPanelTitle } from '../src/components/Threads/threadPanelLabels'
import { describeThreadCommand } from '../src/components/Threads/useThreadCommands'
import { failureMessage, usageWindowLabel } from '../src/components/Threads/ThreadFailureCard'

afterEach(async () => { await changeLanguage('en') })

describe('Thread in the interface language', () => {
  it('asks archive, delete and rewind in the interface language, naming the conversation when there is one', async () => {
    expect(threadConfirmationText('delete', 'Fix login')).toMatchObject({ title: 'Delete this conversation?', confirmLabel: 'Delete conversation', command: '/delete confirm', danger: true })
    expect(threadConfirmationText('delete', 'Fix login').description).toContain('“Fix login”')

    await changeLanguage('pt-BR')
    const archive = threadConfirmationText('archive', 'Fix login')
    expect(archive).toMatchObject({ title: 'Arquivar esta conversa?', confirmLabel: 'Arquivar conversa', command: '/archive confirm' })
    expect(archive.description).toContain('“Fix login”')
    // The main process sends the English wording with the slash command; the dialog shows it translated.
    expect(localizeConfirmation(threadConfirmation('rewind'))).toMatchObject({ title: 'Retroceder o último turno?', command: '/rewind 1', danger: true })
    // A confirmation the app does not know is shown as sent.
    const unknown = { title: 'Do it?', description: 'Really', confirmLabel: 'Do', command: '/other' }
    expect(localizeConfirmation(unknown)).toBe(unknown)
  })

  it('names the shared panels in the interface language, with their shortcut', async () => {
    expect(threadPanelLabel('search')).toBe('Find in files')
    await changeLanguage('pt-BR')
    expect(threadPanelLabel('changes')).toBe('Alterações')
    expect(threadPanelTitle('changes')).toMatch(/^Alterações/)
  })

  it('describes the commands OXESpace runs by what they do here, and keeps what a provider wrote', async () => {
    await changeLanguage('pt-BR')
    // Run by OXESpace: its own description, even when the provider reported the name too.
    expect(describeThreadCommand({ name: 'delete', description: 'Delete the native session', source: 'codex', execution: 'desktop' }, 'codex')).toBe('Excluir esta conversa do OXESpace; a sessão do provedor é mantida')
    expect(describeThreadCommand({ name: 'rules', description: 'Permission rules', source: 'claude', execution: 'desktop' }, 'claude')).toMatch(/^Regras de permissão/)
    // Reported by the provider in its own words: shown as written.
    expect(describeThreadCommand({ name: 'new', description: 'Clear native context', source: 'claude' }, 'claude')).toBe('Clear native context')
    // A skill or unknown command keeps its text.
    expect(describeThreadCommand({ name: 'deploy', description: 'Ship it', source: 'oxe' }, 'claude')).toBe('Ship it')
  })
})

describe('Thread failures in the interface language', () => {
  it('explains a failure by its code and keeps a message it does not know', async () => {
    await changeLanguage('pt-BR')
    expect(failureMessage({ code: 'usage', message: 'The provider reported an exhausted usage allowance.' })).toBe('O provedor informou que a cota de uso acabou.')
    expect(failureMessage({ code: 'configuration', message: 'This model is not available for your account. Choose another model.' })).toMatch(/^Este modelo não está disponível/)
    expect(failureMessage({ code: 'unknown', message: 'Something only this failure says' })).toBe('Something only this failure says')
  })

  it('names usage windows in the interface language and keeps the limit name', async () => {
    expect(usageWindowLabel('codex · Weekly')).toBe('codex · Weekly')
    await changeLanguage('pt-BR')
    expect(usageWindowLabel('Weekly')).toBe('Semanal')
    expect(usageWindowLabel('codex · Session · 5 hours')).toBe('codex · Sessão · 5 horas')
    expect(usageWindowLabel('codex · 2 hours')).toBe('codex · 2 horas')
    expect(usageWindowLabel('codex · 1 minutes')).toBe('codex · 1 minuto')
    expect(usageWindowLabel('Credits')).toBe('Credits')
  })
})
