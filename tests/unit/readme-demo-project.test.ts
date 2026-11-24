// @vitest-environment node
// OXE-393: the demo project that e2e/readme-shots.spec.ts seeds runs its own `node --test`, so the README captures get
// past their terminal transcript. Two imports of the spec itself had fallen inside the demo's rate-limit test, and
// `node --test` in the demo looked for ./helpers/panels and ./helpers/oxepod, which the demo does not have.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RATE_LIMIT_TEST, seedDemoRepo } from '../../e2e/helpers/readme-demo'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('OXE-393: the README demo project', () => {
  it("the demo project's node --test passes", () => {
    const root = mkdtempSync(join(tmpdir(), 'oxe-readme-demo-'))
    roots.push(root)
    const repo = join(root, 'acme-web')
    // The demo's git must never reach a repository above the temporary folder (a home folder can be one).
    const env = Object.fromEntries(Object.entries({ ...process.env, GIT_CEILING_DIRECTORIES: root }).filter(([key]) => !key.startsWith('OXESPACE_')))
    seedDemoRepo(repo, env)

    // Every test file of the demo imports only Node's test modules and the demo's own sources.
    for (const file of readdirSync(join(repo, 'test'))) {
      const imports = [...readFileSync(join(repo, 'test', file), 'utf8').matchAll(/^import .* from '([^']+)'$/gm)].map(match => match[1])
      for (const from of imports) expect(from, `${file} imports ${from}`).toMatch(/^(node:test|node:assert\/strict|\.\.\/src\/)/)
    }
    expect(RATE_LIMIT_TEST).not.toMatch(/\.\/helpers\//)

    // What the captured terminal runs: 1 sign-in test and 3 rate-limit tests, all passing.
    const runDemoTests = (): string => {
      try {
        return execFileSync(process.execPath, ['--test', '--test-reporter=tap'], { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (error) {
        const failed = error as { stdout?: string; stderr?: string }
        throw new Error(`node --test failed in the demo project:\n${failed.stdout ?? ''}\n${failed.stderr ?? ''}`, { cause: error })
      }
    }
    const output = runDemoTests()
    expect(output).toMatch(/^# tests 4$/m)
    expect(output).toMatch(/^# pass 4$/m)
    expect(output).toMatch(/^# fail 0$/m)
  })
})
