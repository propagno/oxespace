// Acceptance test for 1.5.2 Polimento · Configurações (Jira OXE-233, PS-08·2, CA-1 to CA-3).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ToolsSettings } from '../../../src/components/Settings/ToolsSettings'
import { changeLanguage, i18n } from '../../../src/i18n'

const readJson = (rel: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8')) as Record<string, unknown>

afterEach(async () => {
  cleanup()
  await changeLanguage('en')
})

describe('OXE-233 (PS-08·2): pt-BR menu path and glossary words in Settings', () => {
  it('tools.whereToAdd names Ferramentas › Gerenciar servidores MCP in pt-BR', async () => {
    await changeLanguage('pt-BR')
    render(<ToolsSettings rootPath="" />)
    const whereToAdd = screen.getByTestId('tools-where-to-add')
    expect(whereToAdd).toHaveTextContent('Ferramentas › Gerenciar servidores MCP')
    expect(whereToAdd.textContent).not.toContain('Tools › Manage MCP servers')
  })

  it('hostsProxy.tryAgain reads Tentar de novo', async () => {
    await changeLanguage('pt-BR')
    expect(i18n.t('hostsProxy.tryAgain', { ns: 'settings' })).toBe('Tentar de novo')
  })

  it('the pt-BR keys that translated skills say skills', async () => {
    await changeLanguage('pt-BR')
    const skillsManagerFeature = i18n.t('updates.removedFeatures.skillsManager.feature', { ns: 'common' })
    const paletteMcp = i18n.t('commands.action.settings.mcp', { ns: 'common' })
    expect(skillsManagerFeature.toLowerCase()).toContain('skills')
    expect(paletteMcp.toLowerCase()).toContain('skills')
    expect(skillsManagerFeature).not.toMatch(/habilidad/i)
    expect(paletteMcp).not.toMatch(/habilidad/i)

    const commonRaw = JSON.stringify(readJson('shared/locales/pt-BR/common.json'))
    expect(commonRaw).not.toMatch(/habilidad/i)
  })
})
