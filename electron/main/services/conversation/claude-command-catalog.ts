import type { ThreadCommand, ThreadModel } from '../../../../shared/types/thread'
import type { ConversationTransport } from './codex-conversation'
import { JsonLinesDecoder } from './json-lines'

export const CLAUDE_THREAD_ARGS = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
  '--permission-mode', 'plan', '--permission-prompts', 'host', '--tools', 'default',
  '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--settings', '{"disableAllHooks":true,"disableSkillShellExecution":true}']

/** SDK initialize handshake. It enumerates the installed CLI, without a user prompt. */
export function claudeCommandCatalog(transport: ConversationTransport): Promise<ThreadCommand[]> {
  return claudeRuntimeCatalog(transport).then(catalog => catalog.commands)
}
export function claudeRuntimeCatalog(transport: ConversationTransport): Promise<{ commands: ThreadCommand[]; models: ThreadModel[] }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Claude command discovery timed out')), 8000)
    const finish = (error?: Error, commands: ThreadCommand[] = [], models: ThreadModel[] = []) => { clearTimeout(timer); if (error) reject(error); else resolve({ commands, models }) }
    const decoder = new JsonLinesDecoder(value => {
      const event = value as { type?: string; response?: { request_id?: string; subtype?: string; response?: { commands?: { name?: string; description?: string; argumentHint?: string; aliases?: string[] }[]; models?: { value?: string; displayName?: string; description?: string; supportedEffortLevels?: string[] }[] } } }
      if (event.type !== 'control_response' || event.response?.request_id !== 'commands') return
      if (event.response.subtype !== 'success' || !Array.isArray(event.response.response?.commands)) { finish(Error('Claude command discovery is unavailable')); return }
      finish(undefined, event.response.response.commands.slice(0, 512).flatMap(command => {
        if (typeof command.name !== 'string') return []
        return [command.name, ...(Array.isArray(command.aliases) ? command.aliases : [])].filter(name => typeof name === 'string' && /^[a-z0-9][a-z0-9_:-]*$/i.test(name)).map(name => ({
          name, description: typeof command.description === 'string' ? command.description : 'Claude command', source: 'claude' as const,
          ...(typeof command.argumentHint === 'string' && command.argumentHint ? { argumentHint: command.argumentHint } : {})
        }))
      }), (Array.isArray(event.response.response.models) ? event.response.response.models : []).filter(model => model && typeof model.value === 'string' && /^[a-z0-9][a-z0-9._:/\[\]-]*$/i.test(model.value)).slice(0, 100).map(model => ({ id: model.value!, label: typeof model.displayName === 'string' ? model.displayName.slice(0, 120) : model.value!, description: typeof model.description === 'string' ? model.description.slice(0, 500) : '', efforts: (model.supportedEffortLevels ?? []).filter(value => typeof value === 'string' && /^[a-z0-9_-]+$/i.test(value)), isDefault: model.value === 'default' })))
    })
    transport.onData(chunk => { try { decoder.push(chunk) } catch { finish(Error('Invalid Claude command catalog')) } })
    transport.onClose(() => finish(Error('Claude command discovery closed')))
    try { transport.write(JSON.stringify({ type: 'control_request', request_id: 'commands', request: { subtype: 'initialize', hooks: {} } }) + '\n') }
    catch { finish(Error('Could not initialize Claude command discovery')) }
  })
}
