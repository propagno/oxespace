// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LIVE_APP_ENV, scrubLiveAppEnv, withoutLiveApp } from '../../e2e/helpers/live-app-env'

/** What an OXESpace terminal gives every process started in it (terminal executionEnvironment, mcp-sync, agent-launch). */
const LIVE = ['OXESPACE_MCP_PORT', 'OXESPACE_MCP_TOKEN', 'OXESPACE_EXECUTION_ID', 'OXESPACE_EXECUTION_TOKEN', 'OXESPACE_AGENT_HOOK_PORT',
  'OXESPACE_AGENT_HOOK_TOKEN', 'OXESPACE_WORKSPACE_ID', 'OXESPACE_MEMORY_RUN_ID', 'OXESPACE_PANE_BRIDGE',
  // memory.service.ts: the live run's capture path (homologation of #337), its capture owner and the memory auth token.
  'OXESPACE_MEMORY_RUN', 'AI_MEMORY_CAPTURE_OWNER', 'AI_MEMORY_AUTH_TOKEN', 'AI_MEMORY_BACKFILL_ON_START']
/** What tests set on purpose for the app they start. */
const TEST_KNOBS = ['OXESPACE_E2E_MOCK_NATIVE', 'OXESPACE_DB_PATH', 'OXESPACE_DISABLE_SINGLE_INSTANCE', 'OXESPACE_LOCALE',
  'OXESPACE_E2E_AGENT_STATE', 'OXESPACE_PACKAGED_EXECUTABLE', 'OXESPACE_WORKSPACE_IDS', 'OXESPACE_MEMORY_RUNNER',
  'OXESPACE_EXPERIMENTAL_MEMORY', 'OXESPACE_AI_MEMORY_TEST_BINARY', 'PATH']

describe('tests never reach the running OXESpace app (harness safety)', () => {
  it('matches every variable that connects a process to the running app, in any case, and no test knob', () => {
    for (const key of LIVE) {
      expect(LIVE_APP_ENV.test(key), key).toBe(true)
      expect(LIVE_APP_ENV.test(key.toLowerCase()), key).toBe(true)
    }
    for (const key of TEST_KNOBS) expect(LIVE_APP_ENV.test(key), key).toBe(false)
  })

  it('drops them from a child environment and keeps everything else', () => {
    const env = Object.fromEntries([...LIVE, ...TEST_KNOBS].map(key => [key, 'x']))
    expect(Object.keys(withoutLiveApp(env)).sort()).toEqual([...TEST_KNOBS].sort())
    const removed = scrubLiveAppEnv(env)
    expect(removed.sort()).toEqual([...LIVE].sort())
    expect(Object.keys(env).sort()).toEqual([...TEST_KNOBS].sort())
  })

  it('has none of them in this test process, so nothing it spawns gets them either', () => {
    expect(Object.keys(process.env).filter(key => LIVE_APP_ENV.test(key))).toEqual([])
    // A child started the careless way, with all of process.env, sees none.
    const child = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(Object.keys(process.env)))'], { env: { ...process.env }, encoding: 'utf8' })
    expect((JSON.parse(child.stdout) as string[]).filter(key => LIVE_APP_ENV.test(key))).toEqual([])
  })

  it('scrubs in every test config, and the e2e launcher never passes the raw environment', () => {
    const configs = readdirSync('.').filter(name => /^(playwright|vitest)(\.[a-z]+)?\.config\.ts$/.test(name))
    expect(configs).toEqual(expect.arrayContaining(['playwright.config.ts', 'vitest.config.ts']))
    for (const name of configs) expect(readFileSync(name, 'utf8'), name).toMatch(/^scrubLiveAppEnv\(\)$/m)
    const launch = readFileSync(join('e2e', 'helpers', 'launch.ts'), 'utf8')
    expect(launch).toContain('...withoutLiveApp(process.env)')
    expect(launch).not.toMatch(/\.\.\.process\.env\b/)
  })
})
