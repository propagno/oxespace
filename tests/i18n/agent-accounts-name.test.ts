// Frozen acceptance test for 1.5.2 Polimento 2 (Jira OXE-268, PP-05·13, CA-1; A10). Written by the planner; the executor
// must not edit it. One dialog, one name wherever it is opened (RN-1): the dialog is "Contas dos agentes" / "Agent
// accounts" (thread:accounts.title), and the command that opens it (common:commands.action.thread.accounts, the palette
// and the menus: "Gerenciar as contas dos provedores" / "Manage provider accounts"), common:commands.thread.accounts and
// thread:view.providerAccounts still say "Contas dos provedores" / "Provider accounts" on main f65fa5374.
// The command's former name (common:commands.formerly.thread.accounts) keeps the old words on purpose: it is the search
// word that still finds a renamed command (src/commands/commandText.ts, F17), so it must contain the old name.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const read = (lang: string, ns: string): Record<string, unknown> => JSON.parse(readFileSync(join(process.cwd(), 'shared/locales', lang, `${ns}.json`), 'utf8'))
function at(tree: Record<string, unknown>, key: string): unknown {
  let node: unknown = tree
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  return node
}

describe('OXE-268 · PP-05·13 Agent accounts has one name', () => {
  test('pt-BR and en menu/command entries for Agent accounts match the dialog title', () => {
    const expected = { 'pt-BR': 'Contas dos agentes', en: 'Agent accounts' } as const
    for (const lang of ['pt-BR', 'en'] as const) {
      const thread = read(lang, 'thread'), common = read(lang, 'common')
      expect(at(thread, 'accounts.title'), `${lang} dialog title`).toBe(expected[lang])
      // The palette and the application menus show commands.action.<key> ("OxeChat: …" in the palette). A command starts
      // with a verb (docs/design/commands.md; CR-34), so the action names the dialog inside it: "Gerenciar as contas dos agentes".
      expect(String(at(common, 'commands.action.thread.accounts')).toLowerCase(), `${lang} command action`).toContain(expected[lang].toLowerCase())
      expect(at(common, 'commands.thread.accounts'), `${lang} command`).toBe(expected[lang])
      expect(at(thread, 'view.providerAccounts'), `${lang} view entry`).toBe(expected[lang])
      expect(at(thread, 'sidebar.agentAccounts'), `${lang} sidebar footer`).toBe(expected[lang])
      // The old name stays a search word, so a person who learned it still finds the command.
      expect(String(at(common, 'commands.formerly.thread.accounts')), `${lang} former name`).toContain(lang === 'en' ? 'Provider accounts' : 'Contas dos provedores')
    }
  })
})
