// @vitest-environment node
// `npm run release -- status|tag <version> --from-main`: a release cut from main (1.5.0), with the same checks as a
// patch release on release/<version> (TECH LEAD, 09/11).
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain ES module script without type declarations
import { main, parseArgs } from '../../scripts/release.mjs'

const MAIN = 'f'.repeat(40)

/** A fake git and GitHub where main is MAIN, carrying `version` and `notes`, and the latest ci.yml run on it ended `ci`. */
function fakeRepo({ version = '1.5.0', notes = ['docs/releases/1.5.0.md', 'docs/releases/1.5.0.pt-BR.md'], ci = 'success', tagExists = false, run = false } = {}) {
  const calls: string[][] = []
  const logs: string[] = []
  const writes: string[] = []
  const git = (args: string[]) => {
    calls.push(args)
    if (args[0] === 'rev-parse') return args[1] === 'origin/main' ? `${MAIN}\n` : (() => { throw new Error('unknown revision') })()
    if (args[0] === 'merge-base') return ''
    if (args[0] === 'ls-remote') return tagExists ? `${'e'.repeat(40)}\trefs/tags/v1.5.0\n` : ''
    if (args[0] === 'show') return JSON.stringify({ version })
    if (args[0] === 'ls-tree') return notes.join('\n')
    return ''
  }
  const gh = (args: string[]) => (args[0] === 'repo' ? 'propagno/oxespace\n'
    : JSON.stringify(ci ? [{ id: 42, path: '.github/workflows/ci.yml', head_sha: MAIN, status: 'completed', conclusion: ci, event: 'push', created_at: '2026-11-09T09:00:00Z' }] : []))
  const io = {
    run, git, gh, exec: () => '', log: (line: string) => logs.push(line),
    tryGit: (args: string[]) => { try { return git(args).trim() } catch { return null } },
    write: (label: string) => { writes.push(label) },
    repo: () => 'propagno/oxespace',
  }
  return { io, calls, logs, writes }
}
const tagFromMain = (repo: ReturnType<typeof fakeRepo>) => main(['tag', '1.5.0', '--from-main'], repo.io, {})

describe('release from main (--from-main)', () => {
  it('refuses when package.json on main does not say the version', () => {
    const repo = fakeRepo({ version: '1.4.3' })
    expect(tagFromMain(repo)).toBe(1)
    expect(repo.logs).toContain('not yet: package.json on the release head says 1.4.3, not 1.5.0')
    expect(repo.writes).toEqual([])
  })

  it('refuses without the release notes, naming each one missing', () => {
    const repo = fakeRepo({ notes: ['docs/releases/1.4.3.md'] })
    expect(tagFromMain(repo)).toBe(1)
    expect(repo.logs).toEqual(expect.arrayContaining([
      'not yet: docs/releases/1.5.0.md is missing on the release head',
      'not yet: docs/releases/1.5.0.pt-BR.md is missing on the release head',
    ]))
    expect(repo.writes).toEqual([])
  })

  it('refuses a main whose latest completed CI did not pass, or that has none, and a tag that exists', () => {
    expect(tagFromMain(fakeRepo({ ci: 'failure' }))).toBe(1)
    const none = fakeRepo({ ci: '' })
    expect(tagFromMain(none)).toBe(1)
    expect(none.logs).toContain(`not yet: no completed ci.yml run on ${MAIN.slice(0, 8)}`)
    const exists = fakeRepo({ tagExists: true })
    expect(tagFromMain(exists)).toBe(1)
    expect(exists.logs).toContain('not yet: v1.5.0 already exists: a published tag is never moved')
  })

  it('happy path: plans the tag on main’s exact head and writes nothing in a dry run', () => {
    const repo = fakeRepo()
    expect(tagFromMain(repo)).toBe(0)
    expect(repo.writes).toEqual([`git tag -a v1.5.0 ${MAIN.slice(0, 8)} (CI 42 success, on main)`, 'git push origin refs/tags/v1.5.0'])
    // It reads main, never a release branch, and no git call tags or pushes.
    expect(repo.calls).toContainEqual(['fetch', '--quiet', 'origin', 'main'])
    expect(repo.calls).toContainEqual(['rev-parse', 'origin/main'])
    expect(repo.calls.some(args => args.some(arg => String(arg).includes('release/1.5.0')))).toBe(false)
    expect(repo.calls.some(args => args[0] === 'tag' || args[0] === 'push')).toBe(false)
  })

  it('status says main is ready, and points to the --from-main tag', () => {
    const repo = fakeRepo()
    expect(main(['status', '1.5.0', '--from-main'], repo.io, {})).toBe(0)
    expect(repo.logs[0]).toBe(`main: ${MAIN}`)
    expect(repo.logs.at(-1)).toBe('ready to tag: npm run release -- tag 1.5.0 --from-main --run')
  })

  it('goes with status and tag only, and the patch path is unchanged without it', () => {
    expect(parseArgs(['tag', '1.5.0', '--from-main'])).toMatchObject({ step: 'tag', fromMain: true })
    expect(() => parseArgs(['cut', '1.5.0', '--from-main'])).toThrow(/--from-main goes with status or tag/)
    expect(parseArgs(['tag', '1.4.4'])).toMatchObject({ fromMain: false })
    // Without --from-main, a missing release branch is still named as such.
    const patch = fakeRepo()
    expect(main(['tag', '1.4.4'], patch.io, {})).toBe(1)
    expect(patch.logs).toContain('not yet: release/1.4.4 is not on origin')
  })
})
