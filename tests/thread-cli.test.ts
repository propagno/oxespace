import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'
import { interactiveConversationCommand } from '../electron/main/services/conversation/process-transport'

const id = '11111111-1111-4111-8111-111111111111'

describe('native conversation command resolution', () => {
  it('resolves an npm Windows shim to the native Rust binary without launching Electron under ConPTY', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'oxe-cli-resolver-')), target = resolvePath(folder)
    if (dirname(target) !== resolvePath(tmpdir()) || !basename(target).startsWith('oxe-cli-resolver-')) throw Error('Invalid cleanup target')
    try {
      const root = join(folder, 'node_modules', '@openai', 'codex')
      const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
      const binary = join(root, 'vendor', triple, 'bin', 'codex.exe')
      await mkdir(dirname(binary), { recursive: true }); await mkdir(join(root, 'bin'), { recursive: true })
      await writeFile(join(root, 'bin', 'codex.js'), ''); await writeFile(binary, '')
      const shim = join(folder, 'codex.cmd'); await writeFile(shim, '')
      const args = ['resume', id, '--no-alt-screen']
      const result = interactiveConversationCommand(shim, args, { ELECTRON_RUN_AS_NODE: '1', CODEX_HOME: '/native' }, 'win32')
      expect(result).toEqual({ executable: binary, args, env: { CODEX_HOME: '/native' } })
      await rm(binary)
      expect(() => interactiveConversationCommand(shim, args, {}, 'win32')).toThrow('native executable')
    } finally { await rm(target, { recursive: true, force: true }) }
  })
})
