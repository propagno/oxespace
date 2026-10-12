import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { spawn } from 'node-pty'
import { ThreadNativeCli, type NativeCliSession } from '../../electron/main/services/conversation/thread-cli'
import type { ConversationThread } from '../../shared/types/thread'

// Real PTYs, isolated native homes, no account mutation or model inference.
it.skipIf(process.env.OXESPACE_THREAD_SMOKE !== '1')('installed Claude and Codex TUIs open inside the Thread transport', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oxe-thread-cli-smoke-'))
  const target = resolve(root)
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('oxe-thread-cli-smoke-')) throw Error('Invalid cleanup target')
  await mkdir(join(root, 'claude')); await mkdir(join(root, 'codex'))
  try {
    for (const provider of ['claude', 'codex'] as const) {
      let session: NativeCliSession | undefined, output = '', pid: number | undefined, resolveBanner: (() => void) | undefined
      const banner = new Promise<void>(resolve => { resolveBanner = resolve })
      const cli = new ThreadNativeCli(() => provider, { spawn: (file, args, options) => { const pty = spawn(file, args, options); pid = pty.pid; return pty }, env: { ...process.env, CLAUDE_CONFIG_DIR: join(root, 'claude'), CODEX_HOME: join(root, 'codex') },
        exit: () => {}, data: event => {
          output = (output + event.data).slice(-32768)
          if (event.data.includes('\x1b[6n')) void session?.write('\x1b[1;1R')
          if (event.data.includes('\x1b[c')) void session?.write('\x1b[?1;2c')
          if (/Claude\s+Code|Codex|OpenAI|Anthropic|Choose|Select|Welcome|text style|sign in|theme/i.test(output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''))) resolveBanner?.()
        } })
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        session = await cli.open({ id: `smoke-${provider}`, rootPath: root, provider, nativeSessionId: null } as ConversationThread, '/permissions', async () => {})
        const replay = session.attach().replay
        output += replay
        if (/Claude\s+Code|Codex|OpenAI|Anthropic|Choose|Select|Welcome|text style|sign in|theme/i.test(output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''))) resolveBanner?.()
        if (replay.includes('\x1b[6n')) await session.write('\x1b[1;1R')
        await Promise.race([banner, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`${provider} native TUI banner timed out (${output.length} output characters)`)), 15000) })])
        expect(session.state().running).toBe(true)
        expect(session.state().pendingCommand).toBe('/permissions')
        // No queued command has been inserted into sign-in/trust screens.
      } finally { clearTimeout(timer); await session?.close(); output = '' }
      expect(pid).toBeTypeOf('number')
      expect(() => process.kill(pid!, 0)).toThrow() // no surviving native CLI after Return
    }
  } finally {
    await rm(target, { recursive: true, force: true })
  }
}, 45000)
