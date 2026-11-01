// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { envNamesProbeArgs, NODE_EXECUTABLE } from '../helpers/node-child'

/** Every tracked test and e2e file, as git lists them. */
const files = execFileSync('git', ['ls-files', 'tests', 'e2e'], { encoding: 'utf8' }).split('\n').filter(name => /\.(c|m)?[jt]sx?$/.test(name))

describe('a test never starts the Electron binary as an app on the person\'s screen', () => {
  it('runs Node children through tests/helpers/node-child.ts, never `process.execPath -e`', () => {
    // Under test:electron, process.execPath is electron.exe: with a minimal environment it opens "Unable to find
    // Electron app" on the person's screen. Use NODE_EXECUTABLE (the system node under Electron).
    const offenders = files.filter(name => name !== 'tests/unit/no-electron-as-app.test.ts'
      && /process\.execPath\s*,\s*\[\s*['"](-e|--eval|-p|--print)['"]/.test(readFileSync(name, 'utf8')))
    expect(offenders).toEqual([])
  }, 60_000)

  it('uses the system node under Electron and the current binary under plain Node', () => {
    expect(NODE_EXECUTABLE).toBe(process.versions.electron ? 'node' : process.execPath)
  })

  it('reports only the names asked for, never the whole environment', () => {
    const out = execFileSync(NODE_EXECUTABLE, envNamesProbeArgs(['PATH', 'OXE_NOT_SET_ANYWHERE']), { encoding: 'utf8', env: { ...process.env, OXE_OTHER: 'x' } })
    expect(JSON.parse(out)).toEqual(Object.keys(process.env).some(key => key === 'PATH') ? ['PATH'] : [])
  })
})
