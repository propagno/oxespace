import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { languageFor, resolveLanguage } from '../shared/i18n'
import { AppearanceSettings } from '../src/components/Settings/AppearanceSettings'
import { describeAttention } from '../src/hooks/useAttentionSummary'
import { changeLanguage, i18n } from '../src/i18n'
import { RichText } from '../src/i18n/RichText'
import { useSettingsStore } from '../src/store/settings.store'
import { formatDate, formatNumber, formatRelative } from '../src/utils/formatTime'

afterEach(async () => {
  await act(async () => { useSettingsStore.getState().setLanguage('system') })
  await changeLanguage('en')
})

describe('interface language', () => {
  it('opens in Brazilian Portuguese for any Portuguese locale and in English otherwise', () => {
    for (const locale of ['pt', 'pt-BR', 'pt_BR', 'pt-PT', 'PT-br']) expect(resolveLanguage(locale)).toBe('pt-BR')
    for (const locale of ['en-US', 'es-ES', 'fr', 'ptx', '', null, undefined]) expect(resolveLanguage(locale)).toBe('en')
    expect(languageFor('system', 'pt-BR')).toBe('pt-BR')
    expect(languageFor('en', 'pt-BR')).toBe('en')
  })

  it('translates, pluralizes and formats in the chosen language', async () => {
    expect(i18n.t('nav.settings')).toBe('Settings')
    expect(describeAttention({ needsYou: 3, failed: 1, working: 0 })).toBe('3 need you, 1 failed')
    expect(formatNumber(1234.5)).toBe('1,234.5')

    await changeLanguage('pt-BR')
    expect(document.documentElement.lang).toBe('pt-BR')
    expect(i18n.t('nav.settings')).toBe('Configurações')
    expect(describeAttention({ needsYou: 1, failed: 2, working: 0 })).toBe('1 precisa de você, 2 falharam')
    expect(describeAttention({ needsYou: 0, failed: 0, working: 4 })).toBe('4 em andamento')
    expect(formatNumber(1234.5)).toBe('1.234,5')
    expect(formatDate(Date.UTC(2026, 9, 14, 12), { timeZone: 'UTC' })).toBe('14/10/2026')
    expect(formatRelative(Date.now() - 3 * 60_000)).toBe('há 3 minutos')
  })

  it('renders the <strong> markup of a translation and nothing else', () => {
    const { container } = render(<p><RichText text="Only for terminals you are <strong>not watching</strong>, <em>really</em>." /></p>)
    expect(container.querySelector('strong')?.textContent).toBe('not watching')
    expect(container.textContent).toBe('Only for terminals you are not watching, <em>really</em>.')
  })

  it('switches from Settings › Appearance › Language and keeps the choice', async () => {
    render(<AppearanceSettings />)
    const select = screen.getByTestId('settings-language') as HTMLSelectElement
    expect(screen.getByRole('option', { name: 'System (English)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Português (Brasil)' })).toBeInTheDocument()

    await act(async () => { fireEvent.change(select, { target: { value: 'pt-BR' } }) })
    expect(useSettingsStore.getState().language).toBe('pt-BR')
    expect(await screen.findByText('Idioma')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Escuro/ })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('oxe-settings') ?? '{}').state.language).toBe('pt-BR')
  })
})
