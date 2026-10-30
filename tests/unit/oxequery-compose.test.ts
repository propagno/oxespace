import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { composeArgs, composeTarget } from '../../electron/main/services/oxepod/compose'

const inspect = (labels: Record<string, string>): string => JSON.stringify([{ Config: { Labels: labels } }])
const dir = resolve('/work/shop')
const file = join(dir, 'compose.yaml')

describe('compose projects', () => {
  it('takes the project, folder and files from the labels', () => {
    const target = composeTarget(inspect({ 'com.docker.compose.project': 'shop', 'com.docker.compose.project.working_dir': dir, 'com.docker.compose.project.config_files': file }))
    expect(target).toEqual({ project: 'shop', directory: dir, files: [file] })
  })

  it('reads Podman labels too', () => {
    expect(composeTarget(inspect({ 'io.podman.compose.project': 'shop', 'io.podman.compose.project.working_dir': dir }))).toEqual({ project: 'shop', directory: dir, files: [] })
  })

  it('refuses what is not a plain project: odd names, relative folders, files that are not YAML', () => {
    const base = { 'com.docker.compose.project': 'shop', 'com.docker.compose.project.working_dir': dir }
    expect(composeTarget(inspect({ ...base, 'com.docker.compose.project': '../x' }))).toBeNull()
    expect(composeTarget(inspect({ ...base, 'com.docker.compose.project': 'Shop;rm' }))).toBeNull()
    expect(composeTarget(inspect({ ...base, 'com.docker.compose.project.working_dir': 'relative/dir' }))).toBeNull()
    expect(composeTarget(inspect({ ...base, 'com.docker.compose.project.config_files': file + ',' + file.replace(/compose.yaml$/, '.env') }))).toBeNull()
    expect(composeTarget(inspect({}))).toBeNull()
    expect(composeTarget('not json')).toBeNull()
  })

  it('builds argv for one compose call and bounds the log length', () => {
    const target = { project: 'shop', directory: dir, files: [file] }
    expect(composeArgs(target, 'up')).toEqual(['compose', '--project-name', 'shop', '--project-directory', dir, '-f', file, 'up', '-d'])
    expect(composeArgs(target, 'restart').slice(-1)).toEqual(['restart'])
    expect(composeArgs(target, 'logs', 99999).slice(-2)).toEqual(['--tail', '500'])
  })
})

describe('ContainerRuntime.compose', () => {
  async function setup(labels: Record<string, string> | null, exec?: (args: string[]) => { code: number; stdout: string; stderr: string; timedOut: boolean }) {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { ContainerRuntime } = await import('../../electron/main/services/oxepod/container-runtime')
    const folder = mkdtempSync(join(tmpdir(), 'compose-'))
    const compose = join(folder, 'compose.yaml')
    writeFileSync(compose, 'services: {}\n')
    const calls: { args: string[]; cwd?: string }[] = []
    const events: unknown[] = []
    const host = {
      id: 'fake', kind: 'local' as const, readTextFile: async () => '', writeTextFile: async () => undefined,
      exec: async (_command: string, args: string[], options?: { cwd?: string }) => {
        calls.push({ args, ...(options?.cwd ? { cwd: options.cwd } : {}) })
        if (args[0] === 'version' || args[0] === 'info') return { code: 0, stdout: '27.0.0\n', stderr: '', timedOut: false }
        if (args.includes('inspect')) return { code: 0, stdout: JSON.stringify([{ Config: { Labels: labels === null ? {} : { 'com.docker.compose.project': 'shop', 'com.docker.compose.project.working_dir': folder, 'com.docker.compose.project.config_files': compose, ...labels } } }]), stderr: '', timedOut: false }
        return exec ? exec(args) : { code: 0, stdout: 'ok\n', stderr: '', timedOut: false }
      }
    }
    return { runtime: new ContainerRuntime({ host, emit: event => events.push(event), platform: 'linux', env: {} }), calls, events, folder, compose }
  }

  it('runs one compose call in the project folder named by the container labels, and announces a change', async () => {
    const { runtime, calls, events, folder, compose } = await setup({})
    const result = await runtime.compose('web-1', 'restart', {}, 'docker')
    expect(result.output).toBe('ok')
    const call = calls.find(entry => entry.args.includes('restart'))!
    expect(call.cwd).toBe(folder)
    expect(call.args).toEqual(['compose', '--project-name', 'shop', '--project-directory', folder, '-f', compose, 'restart'])
    expect(events).toEqual([{ type: 'containers-changed' }])
  })

  it('does not announce a change for logs, and explains a failure with what the engine said', async () => {
    const logs = await setup({}, () => ({ code: 0, stdout: 'web-1 | hi\n', stderr: '', timedOut: false }))
    expect((await logs.runtime.compose('web-1', 'logs', { tail: 10 }, 'docker')).output).toBe('web-1 | hi')
    expect(logs.events).toEqual([])
    const broken = await setup({}, () => ({ code: 1, stdout: '', stderr: 'unknown shorthand flag: compose', timedOut: false }))
    await expect(broken.runtime.compose('web-1', 'up', {}, 'docker')).rejects.toThrow(/unknown shorthand/)
  })

  it('refuses a container without project labels, and a folder that is not here', async () => {
    const plain = await setup(null)
    await expect(plain.runtime.compose('x', 'up', {}, 'docker')).rejects.toThrow(/does not belong to a Compose project/)
    const gone = await setup({ 'com.docker.compose.project.working_dir': resolve('/definitely/not/here') })
    await expect(gone.runtime.compose('x', 'up', {}, 'docker')).rejects.toThrow(/not on this computer/)
  })
})
