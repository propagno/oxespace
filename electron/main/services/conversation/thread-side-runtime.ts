import type { AppDatabase } from '../../db'
import type { ConversationThread, ThreadEvent, ThreadProvider } from '../../../../shared/types/thread'
import type { ThreadManager } from './thread-manager'
import { AgentService } from '../agent.service'
import { AgentProcessTransport } from './process-transport'
import { AntigravityConversationAdapter } from './antigravity-conversation'
import { ClaudeConversationAdapter } from './claude-conversation'
import { CodexConversationAdapter, CodexForkUnsupportedError } from './codex-conversation'
import { removeClaudeSessionCopy } from './claude-transcript-fork'
import {
  antigravityMcpServers,
  deniedMcpTools,
  threadMcpArguments,
  threadToolList,
  threadToolRoles,
  toolSearchEnvironment,
  THREAD_READ_ONLY_MCP_TOOLS
} from './thread-mcp'
import { ThreadPermissionStore } from './thread-permissions'
import { threadAgentProfile } from './thread-runtime'
import { SIDE_CHAT_DISALLOWED_TOOLS, ThreadSideChats } from './thread-side-chat'
import { readTerminalScreenSnapshot, type ThreadSideTerminalHost } from './side-chat-context'
import { effectiveToolModes } from '../policy/tool-config'
import { assertProviderAllowed, policyDeniedMcpNames, policyDeniedToolNames } from '../policy'

export type { ThreadSideTerminalHost }

/** The OXESpace tools a side chat may call: the read-only lookups among those its conversation has. */
export async function sideChatMcpTools(db: AppDatabase, thread: ConversationThread): Promise<string[]> {
  // The groups the project turned on, in the accepted modes (B7.4).
  const modes = effectiveToolModes(thread.rootPath)
  const tools = threadToolList(threadToolRoles(db, thread.id), Object.entries(modes).filter(([, entry]) => entry.mode === 'always').map(([group]) => group))
  return THREAD_READ_ONLY_MCP_TOOLS.filter(tool => tools.includes(tool))
}

function readPersistedThreadContext(db: AppDatabase, id: string): { events: ThreadEvent[] } | null {
  try {
    const row = db.prepare('SELECT events_json, history_version FROM conversation_threads WHERE id = ?').get(id) as { events_json: string; history_version: number } | undefined
    if (!row) return null
    const events: ThreadEvent[] = row.history_version
      ? (db.prepare('SELECT data_json FROM conversation_events WHERE thread_id = ? ORDER BY seq DESC LIMIT 80').all(id) as { data_json: string }[])
          .reverse()
          .map(entry => JSON.parse(entry.data_json) as ThreadEvent)
      : (JSON.parse(row.events_json) as ThreadEvent[]).slice(-80)
    return { events }
  } catch {
    return null
  }
}

function pickDefaultSideProvider(db: AppDatabase): ThreadProvider {
  try {
    const profiles = new AgentService(db).list()
    for (const candidate of ['antigravity', 'claude', 'codex'] as const) {
      if (profiles.some(profile => !profile.parentProvider && profile.provider === candidate && profile.command?.trim())) {
        return candidate
      }
    }
  } catch { /* fall back */ }
  return 'claude'
}

/**
 * Side chats wired to the real providers (Antigravity, Claude, Codex), supporting:
 * - Same-provider Claude/Codex native session fork/copy fast path;
 * - Antigravity strict read-only ephemeral ACP sessions (`sideChat: true`, `permissions: false`);
 * - Any cross-provider pair via deterministic read-only context brief;
 * - OxeCode active terminal pane context via OXE-445 ScreenMirror (`PaneScreen`) without touching the PTY or DB.
 */
export function createThreadSideChats(
  db: AppDatabase,
  bridge: string,
  manager: ThreadManager,
  platform: NodeJS.Platform = process.platform,
  terminal?: ThreadSideTerminalHost
): ThreadSideChats {
  return new ThreadSideChats({
    readThread: id => manager.readThread(id),
    readThreadContext: id => readPersistedThreadContext(db, id),
    readTerminalContext: async ({ paneId, workspaceId, rootPath }) => {
      if (!terminal) return null
      const paneRow = (workspaceId
        ? db.prepare('SELECT id, workspace_id, display_name, agent_name, root_path FROM panes WHERE id = ? AND workspace_id = ?').get(paneId, workspaceId)
        : db.prepare('SELECT id, workspace_id, display_name, agent_name, root_path FROM panes WHERE id = ?').get(paneId)) as { id: string; workspace_id: string; display_name: string | null; agent_name: string | null; root_path: string | null } | undefined
      const resolvedWorkspaceId = paneRow?.workspace_id ?? workspaceId
      const wsRow = resolvedWorkspaceId
        ? db.prepare('SELECT id, name, root_path FROM workspaces WHERE id = ?').get(resolvedWorkspaceId) as { id: string; name: string; root_path: string } | undefined
        : undefined
      const resolvedRoot = paneRow?.root_path ?? wsRow?.root_path ?? rootPath ?? ''
      if (!resolvedRoot) return null
      const snapshot = await readTerminalScreenSnapshot(paneId, terminal)
      const status = terminal.status?.(paneId)
      const cwd = terminal.shellCwd?.(paneId) ?? status?.launchDirectory ?? paneRow?.root_path ?? resolvedRoot
      const liveState = terminal.agentState?.(paneId)
      const agent = liveState?.agent ?? terminal.agentOf?.(paneId) ?? paneRow?.agent_name ?? null
      return {
        paneId,
        workspaceId: resolvedWorkspaceId,
        workspaceName: wsRow?.name,
        paneTitle: paneRow?.display_name ?? paneRow?.agent_name ?? undefined,
        rootPath: resolvedRoot,
        cwd,
        branch: status?.branch ?? null,
        agent,
        agentState: liveState?.state ?? null,
        altScreen: snapshot?.altScreen ?? false,
        screenText: snapshot?.screenText ?? '',
        truncated: snapshot?.truncated ?? false
      }
    },
    defaultProvider: () => pickDefaultSideProvider(db),
    subscribe: (id, listener) => manager.subscribe(id, listener),
    unavailable: error => error instanceof CodexForkUnsupportedError,
    connect: async (thread, forkId, request) => {
      const provider = request?.provider ?? thread.provider
      const mode = request?.mode ?? 'native-fork'
      assertProviderAllowed(provider, thread.rootPath)
      const profileTarget = provider === thread.provider
        ? thread
        : { ...thread, provider, agentProfileId: undefined }
      const profile = threadAgentProfile(db, profileTarget)
      const meta = db.prepare('SELECT port, token FROM internal_mcp_meta LIMIT 1').get() as { port: number; token: string } | undefined
      const env: Record<string, string> = { ...toolSearchEnvironment(provider),
        ...(meta ? { OXESPACE_MCP_PORT: String(meta.port), OXESPACE_MCP_TOKEN: meta.token, OXESPACE_WORKSPACE_ID: thread.workspaceId } : {}) }
      const denied = [...deniedMcpTools(new ThreadPermissionStore(db).rules(thread.rootPath)), ...policyDeniedMcpNames(thread.rootPath).map(server => ({ server, tool: '*' }))]
      const deniedTools = policyDeniedToolNames(thread.rootPath)
      const tools = await sideChatMcpTools(db, thread)
      const diagnostic = { thread: thread.id, generation: thread.generation }

      if (provider === 'antigravity') {
        return new AntigravityConversationAdapter(
          (args, cwd) => new AgentProcessTransport(profile.command, args, cwd, env, diagnostic),
          {
            sideChat: true,
            mcpServers: meta ? access => antigravityMcpServers(bridge, env, access, undefined, denied, tools, deniedTools) : () => []
          }
        )
      }

      // Without the internal MCP, Claude keeps its empty strict configuration and Codex gets no OXESpace bridge.
      const launch = (args: string[]) => meta ? threadMcpArguments(provider, args, bridge, undefined, denied, tools, deniedTools) : args
      if (provider === 'claude') {
        return new ClaudeConversationAdapter(
          (args, cwd) => new AgentProcessTransport(profile.command, launch(args), cwd, env, diagnostic),
          { sessionId: forkId, args: ['--disallowedTools', ...SIDE_CHAT_DISALLOWED_TOOLS] }
        )
      }
      return new CodexConversationAdapter(
        new AgentProcessTransport(profile.command, launch(['app-server', '--listen', 'stdio://']), thread.rootPath, env, diagnostic),
        { ephemeral: true, mode: mode === 'native-fork' ? 'fork' : 'ephemeral', lookups: tools, platform }
      )
    },
    // Codex's copy is ephemeral and never reaches disk; Antigravity is a fresh ephemeral ACP session;
    // Claude's is the one `<forkId>.jsonl` beside the session.
    discard: async (thread, forkId, keep, provider) => {
      if ((provider ?? thread.provider) === 'claude') await removeClaudeSessionCopy({ rootPath: thread.rootPath, forkId, keep })
    }
  })
}
