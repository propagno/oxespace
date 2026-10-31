import type { AppDatabase } from '../../db'
import type { ConversationThread } from '../../../../shared/types/thread'
import type { ThreadManager } from './thread-manager'
import { AgentProcessTransport } from './process-transport'
import { ClaudeConversationAdapter } from './claude-conversation'
import { CodexConversationAdapter, CodexForkUnsupportedError } from './codex-conversation'
import { removeClaudeSessionCopy } from './claude-transcript-fork'
import { deniedMcpTools, threadMcpArguments, threadToolList, threadToolRoles, toolSearchEnvironment, THREAD_READ_ONLY_MCP_TOOLS } from './thread-mcp'
import { ThreadPermissionStore } from './thread-permissions'
import { threadAgentProfile } from './thread-runtime'
import { SIDE_CHAT_DISALLOWED_TOOLS, ThreadSideChats } from './thread-side-chat'
import { loadRepoConfig } from '../repo-config/loader'
import { assertProviderAllowed, policyDeniedMcpNames, policyDeniedToolNames } from '../policy'

/** The OXESpace tools a side chat may call: the read-only lookups among those its conversation has. */
export async function sideChatMcpTools(db: AppDatabase, thread: ConversationThread): Promise<string[]> {
  const tools = threadToolList(threadToolRoles(db, thread.id), (await loadRepoConfig(thread.rootPath).catch(() => null))?.thread?.tools)
  return THREAD_READ_ONLY_MCP_TOOLS.filter(tool => tools.includes(tool))
}

/**
 * Side chats wired to the real providers. Each runs its own process: Claude resumes the session as a copy under an
 * id OXESpace creates, Codex forks an ephemeral thread. Neither gets the main conversation's MCP lease, memory run or
 * hooks; the OXESpace bridge is limited to read-only lookups and third-party servers are left out.
 */
export function createThreadSideChats(db: AppDatabase, bridge: string, manager: ThreadManager, platform: NodeJS.Platform = process.platform): ThreadSideChats {
  return new ThreadSideChats({
    readThread: id => manager.readThread(id),
    subscribe: (id, listener) => manager.subscribe(id, listener),
    unavailable: error => error instanceof CodexForkUnsupportedError,
    connect: async (thread, forkId) => {
      assertProviderAllowed(thread.provider, thread.rootPath)
      const profile = threadAgentProfile(db, thread)
      const meta = db.prepare('SELECT port, token FROM internal_mcp_meta LIMIT 1').get() as { port: number; token: string } | undefined
      const env: Record<string, string> = { ...toolSearchEnvironment(thread.provider),
        ...(meta ? { OXESPACE_MCP_PORT: String(meta.port), OXESPACE_MCP_TOKEN: meta.token, OXESPACE_WORKSPACE_ID: thread.workspaceId } : {}) }
      const denied = [...deniedMcpTools(new ThreadPermissionStore(db).rules(thread.rootPath)), ...policyDeniedMcpNames(thread.rootPath).map(server => ({ server, tool: '*' }))]
      const tools = await sideChatMcpTools(db, thread)
      // Without the internal MCP, Claude keeps its empty strict configuration and Codex gets no OXESpace bridge.
      const launch = (args: string[]) => meta ? threadMcpArguments(thread.provider, args, bridge, undefined, denied, tools, policyDeniedToolNames(thread.rootPath)) : args
      const diagnostic = { thread: thread.id, generation: thread.generation }
      return thread.provider === 'claude'
        ? new ClaudeConversationAdapter((args, cwd) => new AgentProcessTransport(profile.command, launch(args), cwd, env, diagnostic),
          { sessionId: forkId, args: ['--disallowedTools', ...SIDE_CHAT_DISALLOWED_TOOLS] })
        : new CodexConversationAdapter(new AgentProcessTransport(profile.command, launch(['app-server', '--listen', 'stdio://']), thread.rootPath, env, diagnostic), { ephemeral: true, lookups: tools, platform })
    },
    // Codex's copy is ephemeral and never reaches disk; Claude's is the one `<forkId>.jsonl` beside the session.
    discard: async (thread, forkId, keep) => { if (thread.provider === 'claude') await removeClaudeSessionCopy({ rootPath: thread.rootPath, forkId, keep }) }
  })
}
