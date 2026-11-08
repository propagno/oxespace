import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SIGNER_DIGEST, apkFindings, refuseUnattended, approvals, badging, ciVerdict, main, parseArgs, parseVersion, pickCheck, sha256Of,
  signerDigest, snapshotImages, splitConflicts, tagFindings, trialBranch, versionCodeOf,
} from '../../scripts/release.mjs'

const v143 = parseVersion('1.4.3')
const HEAD = '3c985a94c15a8aacd13d5d93e1dd8fd5b94e6bfd'
const ready = {
  head: HEAD, onMain: true, tagExists: false, packageVersion: '1.4.3',
  notes: ['docs/releases/1.4.3.md', 'docs/releases/1.4.3.pt-BR.md'], ci: { run: 41938049325, ok: true },
}

describe('release script: versions and names', () => {
  it('reads a stable version with or without the v', () => {
    expect(parseVersion('v1.4.3')).toEqual({ version: '1.4.3', major: 1, minor: 4, patch: 3 })
    expect(() => parseVersion('1.5.0-beta.1')).toThrow(/stable version/)
    expect(() => parseVersion('1.4')).toThrow()
  })

  it('computes the Android versionCode like build.gradle.kts', () => {
    expect(versionCodeOf(v143)).toBe(10403)
    expect(versionCodeOf(parseVersion('1.4.2'))).toBe(10402)
  })

  it('names the trial branch the way 1.4.3 did', () => {
    expect(trialBranch('1.4.3')).toBe('merge/release-1.4.3-into-main')
  })
})

describe('release script: snapshot images', () => {
  it('finds the Android goldens and the visual baselines, not other images', () => {
    expect(snapshotImages([
      'mobile/android/app/src/test/snapshots/images/com.oxespace_X_dark.png',
      'e2e/visual/__screenshots__/linux/thread-states.spec.ts/a.png',
      'docs/design/v0/hero.png',
      'src/x.ts',
    ])).toEqual([
      'mobile/android/app/src/test/snapshots/images/com.oxespace_X_dark.png',
      'e2e/visual/__screenshots__/linux/thread-states.spec.ts/a.png',
    ])
  })

  it('refuses a pick that adds or changes a golden, and allows one that deletes it or touches none', () => {
    const refused = pickCheck('ff7c4414d27b', 'M\tmobile/android/app/src/test/snapshots/images/a.png\nM\tsrc/a.ts')
    expect(refused).toMatchObject({ ok: false, images: ['mobile/android/app/src/test/snapshots/images/a.png'] })
    expect(refused.reason).toMatch(/twin PR/)
    expect(pickCheck('abc', 'R100\told.ts\te2e/visual/__screenshots__/win32/x.spec.ts/b.png').ok).toBe(false)
    expect(pickCheck('abc', 'D\tmobile/android/app/src/test/snapshots/images/a.png\nM\tsrc/a.ts').ok).toBe(true)
    expect(pickCheck('abc', '').ok).toBe(true)
  })

  it('splits the trial conflicts: images take main, the rest is for a person', () => {
    expect(splitConflicts(['mobile/android/app/src/test/snapshots/images/a.png', 'package.json'])).toEqual({
      images: ['mobile/android/app/src/test/snapshots/images/a.png'], others: ['package.json'],
    })
  })
})

describe('release script: the tag conditions', () => {
  it('lets the tag go when the head is on main, green, versioned and has both notes', () => {
    expect(tagFindings(v143, ready)).toEqual([])
  })

  it('names every missing condition', () => {
    const findings = tagFindings(v143, { ...ready, onMain: false, tagExists: true, packageVersion: '1.4.2', notes: ['docs/releases/1.4.3.md'], ci: { run: 9, ok: false } })
    expect(findings).toHaveLength(5)
    expect(findings.join('\n')).toMatch(/already exists/)
    expect(findings.join('\n')).toMatch(/says 1\.4\.2/)
    expect(findings.join('\n')).toMatch(/1\.4\.3\.pt-BR\.md is missing/)
    expect(findings.join('\n')).toMatch(/not on main yet/)
    expect(findings.join('\n')).toMatch(/\(9\) did not pass/)
  })

  it('refuses a head with no completed CI run, and a branch that is not on origin', () => {
    expect(tagFindings(v143, { ...ready, ci: { run: null, ok: false } })).toEqual([expect.stringMatching(/no completed ci\.yml run/)])
    expect(tagFindings(v143, { head: null, notes: [] })[0]).toMatch(/not on origin/)
  })

  it('reads the newest completed ci.yml run on that sha', () => {
    const runs = [
      { id: 1, path: '.github/workflows/ci.yml', head_sha: HEAD, status: 'completed', conclusion: 'failure', created_at: '2026-11-04T10:00:00Z' },
      { id: 2, path: '.github/workflows/ci.yml', head_sha: HEAD, status: 'completed', conclusion: 'success', created_at: '2026-11-04T11:00:00Z' },
      { id: 3, path: '.github/workflows/ci.yml', head_sha: HEAD, status: 'in_progress', conclusion: null, created_at: '2026-11-04T12:00:00Z' },
      { id: 4, path: '.github/workflows/android.yml', head_sha: HEAD, status: 'completed', conclusion: 'failure', created_at: '2026-11-04T13:00:00Z' },
      { id: 5, path: '.github/workflows/ci.yml', head_sha: 'other', status: 'completed', conclusion: 'failure', created_at: '2026-11-04T14:00:00Z' },
    ]
    expect(ciVerdict(runs, HEAD)).toMatchObject({ run: 2, ok: true })
    expect(ciVerdict([], HEAD)).toEqual({ run: null, ok: false })
  })
})

describe('release script: approvals', () => {
  it('approves release before android-release, only on the tag commit', () => {
    const pending = [
      { run: 2, sha: HEAD, environment: 'android-release', environmentId: 20 },
      { run: 1, sha: HEAD, environment: 'release', environmentId: 10 },
      { run: 3, sha: 'other', environment: 'release', environmentId: 10 },
      { run: 4, sha: HEAD, environment: 'staging', environmentId: 30 },
    ]
    expect(approvals(pending, HEAD).map(item => item.run)).toEqual([1, 2])
  })
})

describe('release script: the APK', () => {
  const apksigner = `Signer #1 certificate DN: CN=OXESpace\nSigner #1 certificate SHA-256 digest: ${SIGNER_DIGEST}\nSigner #1 certificate SHA-1 digest: 00`
  const badge = "package: name='com.oxespace.mobile' versionCode='10403' versionName='1.4.3' platformBuildVersionName='16'"
  const sha = '564b1e12e95235999549393453ce6d7ae40055c3366788077b82af35cebb6140'

  it('pins the signer to the fingerprint RELEASING.md publishes', () => {
    const releasing = readFileSync('mobile/android/RELEASING.md', 'utf8')
    expect(releasing).toContain(`\`${SIGNER_DIGEST}\``)
    expect(releasing.replace(/:/g, '').toLowerCase()).toContain(SIGNER_DIGEST)
  })

  it('parses apksigner, aapt2 and the .sha256 file', () => {
    expect(signerDigest(apksigner)).toBe(SIGNER_DIGEST)
    expect(signerDigest('no signer')).toBeNull()
    expect(badging(badge)).toEqual({ versionName: '1.4.3', versionCode: 10403 })
    expect(sha256Of(`${sha}  oxespace-android-v1.4.3.apk\n`)).toBe(sha)
  })

  it('passes the published 1.4.3 APK and fails a wrong key, file or version', () => {
    const facts = { expectedSha: sha, actualSha: sha, digest: SIGNER_DIGEST, versionName: '1.4.3', versionCode: 10403 }
    expect(apkFindings(facts, v143)).toEqual([])
    const bad = apkFindings({ ...facts, actualSha: 'f'.repeat(64), digest: 'a'.repeat(64), versionName: '1.4.2', versionCode: 10402 }, v143)
    expect(bad).toHaveLength(4)
    expect(apkFindings({ ...facts, expectedSha: null }, v143)).toEqual(['the release has no readable .sha256 asset'])
  })
})

describe('release script: arguments and dry runs', () => {
  it('reads the step, the version, the commits and --run', () => {
    expect(parseArgs(['pick', '1.4.4', 'abc', 'def', '--run'])).toMatchObject({ step: 'pick', version: '1.4.4', shas: ['abc', 'def'], run: true })
    expect(parseArgs(['cut', '1.4.4', '--from', 'v1.4.3'])).toMatchObject({ from: 'v1.4.3', run: false })
    expect(() => parseArgs(['publish', '1.4.4'])).toThrow(/one of/)
    expect(() => parseArgs(['tag'])).toThrow(/version/)
    expect(() => parseArgs(['tag', '1.4.4', '--force'])).toThrow(/unknown option/)
  })

  it('refuses tag --run and approve --run under CI, and lets the other steps and dry runs through', () => {
    expect(() => refuseUnattended({ step: 'tag', run: true }, { CI: 'true' })).toThrow(/not for CI/)
    expect(() => refuseUnattended({ step: 'approve', run: true }, { GITHUB_ACTIONS: 'true' })).toThrow(/not for CI/)
    expect(() => refuseUnattended({ step: 'tag', run: false }, { CI: 'true' })).not.toThrow()
    expect(() => refuseUnattended({ step: 'verify-apk', run: true }, { CI: 'true' })).not.toThrow()
    expect(() => refuseUnattended({ step: 'tag', run: true }, {})).not.toThrow()
  })

  it('a dry-run tag prints the plan and writes nothing', () => {
    const calls: string[][] = []
    const logs: string[] = []
    const git = (args: string[]) => {
      calls.push(args)
      if (args[0] === 'rev-parse') return `${HEAD}\n`
      if (args[0] === 'merge-base') return ''
      if (args[0] === 'ls-remote') return ''
      if (args[0] === 'show') return JSON.stringify({ version: '1.4.4' })
      if (args[0] === 'ls-tree') return 'docs/releases/1.4.4.md\ndocs/releases/1.4.4.pt-BR.md\n'
      return ''
    }
    const gh = (args: string[]) => (args[0] === 'repo' ? 'propagno/oxespace\n'
      : JSON.stringify([{ id: 7, path: '.github/workflows/ci.yml', head_sha: HEAD, status: 'completed', conclusion: 'success', created_at: '2026-11-08T00:00:00Z' }]))
    const io = {
      run: false, git, gh, exec: () => '', log: (line: string) => logs.push(line),
      tryGit: (args: string[]) => { try { return git(args).trim() } catch { return null } },
      write: (label: string) => { logs.push(`[plan] ${label}`) },
      repo: () => 'propagno/oxespace',
    }
    expect(main(['tag', '1.4.4'], io)).toBe(0)
    expect(logs.filter(line => line.startsWith('[plan]'))).toEqual([
      `[plan] git tag -a v1.4.4 ${HEAD.slice(0, 8)} (CI 7 success, on main)`, '[plan] git push origin refs/tags/v1.4.4',
    ])
    expect(calls.some(args => args[0] === 'tag' || args[0] === 'push')).toBe(false)
  })
})
