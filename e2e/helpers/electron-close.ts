import { _electron } from '@playwright/test'

/**
 * Playwright treats an Electron app as closed when its process emits 'close', which needs the
 * process to exit AND every stdio pipe to close. On Windows a child the app started (a shell's
 * console host, node-pty's console-list agent) inherits those pipes and can outlive the app, so
 * close() waited forever although Electron had exited ("Worker teardown timeout"). Once the
 * Electron process has exited, give its pipes a moment, then close our end of them.
 *
 * Loaded from the Playwright configs, which every worker imports, so each spec's
 * `_electron.launch` gets it without changing the specs.
 */
const PIPE_GRACE_MS = 2_000
const patched = Symbol.for('oxespace.e2e.electronClose')
type Launch = typeof _electron.launch

const electron = _electron as typeof _electron & { [patched]?: true }
if (!electron[patched]) {
  electron[patched] = true
  const launch: Launch = electron.launch.bind(electron)
  electron.launch = (async (...args: Parameters<Launch>) => {
    const app = await launch(...args)
    const child = app.process()
    child.once('exit', () => {
      setTimeout(() => {
        for (const stream of [child.stdin, child.stdout, child.stderr, ...child.stdio.slice(3)]) {
          if (stream && !stream.destroyed) stream.destroy()
        }
      }, PIPE_GRACE_MS).unref()
    })
    return app
  }) as Launch
}
