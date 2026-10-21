import { spawnSync } from 'node:child_process'
import { _electron, type ElectronApplication } from '@playwright/test'

/**
 * Playwright treats an Electron app as closed when its process emits 'close', which needs the
 * process to exit AND every stdio pipe to close. On Windows CI two things kept close() waiting
 * until the test timed out ("Worker teardown timeout"):
 *  - a child the app started (a shell's console host, node-pty's console-list agent) inherits
 *    those pipes and outlives the app: once Electron has exited, close our end of them;
 *  - Electron itself sometimes does not exit after quit(): after CLOSE_GRACE_MS, report whether
 *    its main process still answers (the diagnostic for the app-side fix) and end the process
 *    tree, so one stuck shutdown cannot fail the run.
 *
 * Loaded from the Playwright configs, which every worker imports, so each spec's
 * `_electron.launch` gets it without changing the specs.
 */
const PIPE_GRACE_MS = 2_000
const CLOSE_GRACE_MS = 15_000
const patched = Symbol.for('oxespace.e2e.electronClose')
type Launch = typeof _electron.launch

const wait = <T>(ms: number, value: T): Promise<T> => new Promise(resolve => setTimeout(() => resolve(value), ms).unref())

function endTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  else { try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ } }
}

function guard(app: ElectronApplication): void {
  const child = app.process()
  const closePipes = (): void => {
    for (const stream of [child.stdin, child.stdout, child.stderr, ...child.stdio.slice(3)]) {
      if (stream && !stream.destroyed) stream.destroy()
    }
  }
  child.once('exit', () => { setTimeout(closePipes, PIPE_GRACE_MS).unref() })

  const close = app.close.bind(app)
  app.close = async () => {
    const closing = close()
    if (await Promise.race([closing.then(() => true, () => true), wait(CLOSE_GRACE_MS, false)])) return closing
    const exited = child.exitCode !== null || child.signalCode !== null
    const answers = exited ? 'exited' : await Promise.race([app.evaluate(() => 'yes').catch(() => 'error'), wait(2_000, 'no')])
    console.warn(`[electron-close] close() still waiting after ${CLOSE_GRACE_MS / 1000} s; Electron ${exited ? 'has exited (pipes held by a child)' : `is still running, main process answers: ${answers}`}; ending process tree ${child.pid}`)
    endTree(child.pid)
    closePipes()
    await Promise.race([closing.catch(() => undefined), wait(5_000, undefined)])
  }
}

const electron = _electron as typeof _electron & { [patched]?: true }
if (!electron[patched]) {
  electron[patched] = true
  const launch: Launch = electron.launch.bind(electron)
  electron.launch = (async (...args: Parameters<Launch>) => {
    const app = await launch(...args)
    guard(app)
    return app
  }) as Launch
}
