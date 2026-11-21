// Frozen acceptance test for 1.5.0 A7 (U8, with U9 and U10; OXE phase F2). The executor must not edit it.
// Contract: docs/roadmap-1.5/ccr-a7-settings-rows.md. Every Settings page is built from SettingsSection and SettingRow,
// changes apply at once, the risk list (R1–R10) shows an Undo, and the irreversible list (I1–I7) asks first.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')
const S = 'src/components/Settings/'

/** The pages of CCR section 2. Each renders sections of rows. */
const PAGES = [
  `${S}SettingsModal.tsx`, `${S}AppearanceSettings.tsx`, `${S}KeyboardSettings.tsx`, `${S}UpdatePreferences.tsx`,
  `${S}ToolsSettings.tsx`, `${S}AutomationsSettings.tsx`, `${S}PolicySettings.tsx`, `${S}DevicesSettings.tsx`,
  'src/components/Workspace/WorkspaceSettingsModal.tsx'
]
/** One-row settings that pages include: a row, not a section of their own. */
const ROWS = [`${S}ExternalEditorSetting.tsx`, `${S}SeenSitesSetting.tsx`]
const importsFromUi = (source: string, name: string): boolean =>
  new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"][./]*ui['"]`).test(source)

describe('A7 · the Settings pages are sections of rows (U8)', () => {
  test.each(PAGES)('%s uses SettingsSection and SettingRow', path => {
    const source = read(path)
    expect(importsFromUi(source, 'SettingsSection')).toBe(true)
    expect(importsFromUi(source, 'SettingRow')).toBe(true)
  })

  test.each(ROWS)('%s is a SettingRow', path => {
    expect(importsFromUi(read(path), 'SettingRow')).toBe(true)
  })

  test('changes apply at once: no page-level Save, except the computer name on Devices', () => {
    const SAVE = /t\(\s*['"](?:common\.save|[\w.]*\.save)['"]/
    for (const path of [...PAGES, ...ROWS].filter(path => !path.endsWith('DevicesSettings.tsx'))) {
      expect({ path, save: SAVE.test(read(path)) }).toEqual({ path, save: false })
    }
  })
})

/** CCR section 3: the change's own message key, in the file that makes the change, next to an Undo. */
const RISK: Array<[string, string, string]> = [
  ['R1 resume without prompts', `${S}SettingsModal.tsx`, 'terminal.resumeBypass'],
  ['R2 a tool mode widened', `${S}ToolsSettings.tsx`, 'tools.modeSaved'],
  ['R3 a tool rule set to Allow', `${S}ToolsSettings.tsx`, 'tools.rules.saved'],
  ['R4 an MCP server added from the catalog', 'src/components/MCP/McpPanel.tsx', 'mcp.catalogAdded'],
  ['R5 a connection\'s agent access widened', 'src/components/OxeQuery/ConnectionDialog.tsx', 'form.agentsWidened'],
  ['R6 riskier OxeQuery preferences', 'src/components/OxeQuery/PreferencesDialog.tsx', 'preferences.riskySaved'],
  ['R7 a custom agent\'s command changed', 'src/components/Agents/AgentConfigModal.tsx', 'agentConfig.commandChanged'],
  ['R8 the phone connection turned on', `${S}DevicesSettings.tsx`, 'devices.gateway.on'],
  ['R9 the workspace default shell', 'src/components/Workspace/WorkspaceSettingsModal.tsx', 'workspace.settings.shellApplied'],
  ['R10 reset all shortcuts', `${S}KeyboardSettings.tsx`, 'keyboard.reset']
]

describe('A7 · the risk list applies at once with an Undo', () => {
  test.each(RISK)('%s', (_name, path, key) => {
    const source = read(path)
    expect(source).toContain(key)
    expect(source).toMatch(/applyWithUndo\(|ui\.undo/)
  })
})

/** CCR section 4: each irreversible action is behind a ConfirmDialog in the file that owns it. */
const IRREVERSIBLE: Array<[string, string, RegExp]> = [
  ['I1 unpair a phone', `${S}DevicesList.tsx`, /<ConfirmDialog[\s\S]{0,400}devices\.list\./],
  ['I2 delete a custom agent', 'src/components/Agents/AgentConfigModal.tsx', /<ConfirmDialog[\s\S]{0,400}agentConfig\.delete/],
  ['I3 allow a tool rule', `${S}ToolsSettings.tsx`, /<ConfirmDialog[\s\S]{0,400}tools\.rules\./],
  ['I4 the firewall rule', `${S}DevicesFirewall.tsx`, /<ConfirmDialog[\s\S]{0,600}firewallCheck\./],
  ['I5 a memory note', 'src/components/Workspace/WorkspaceMemoryNotes.tsx', /<ConfirmDialog/],
  ['I6 delete an automation', `${S}AutomationsSettings.tsx`, /<ConfirmDialog[\s\S]{0,400}automations\./],
  ['I7 remove the search-by-meaning model', `${S}SettingsModal.tsx`, /<ConfirmDialog[\s\S]{0,400}semantic\./]
]

describe('A7 · the irreversible list asks first', () => {
  test.each(IRREVERSIBLE)('%s', (_name, path, confirm) => {
    expect(read(path)).toMatch(confirm)
  })
})
