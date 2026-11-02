import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { messageKey, messageValues, type MainMessage } from '../../shared/messages'

/**
 * A C3 message in English, for text that goes to an agent rather than to the person (an MCP refusal, B10). Agents read
 * English; the person's words are the window's job. The catalog is read from disk, like i18n.ts, so strings never grow
 * the main entry; there is no Electron import, so the tools that use it stay testable.
 */
const here = dirname(fileURLToPath(import.meta.url))
let english: Record<string, unknown> | undefined

function catalog(): Record<string, unknown> {
  if (english) return english
  for (const root of [join(here, 'locales'), join(here, '..', 'locales'), join(here, '..', '..', 'shared', 'locales')]) {
    try { return (english = JSON.parse(readFileSync(join(root, 'en', 'main.json'), 'utf8')) as Record<string, unknown>) } catch { /* try the next place */ }
  }
  return (english = {})
}

export function englishText(message: MainMessage): string {
  const template = messageKey(message.code).split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog())
  if (typeof template !== 'string') return message.code
  const values = messageValues(message, 'en')
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? '')
}
