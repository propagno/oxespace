import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { IGNORED_SEGMENTS, makeIgnoreFilter } from '../../electron/main/services/semantic-ignore'

// Regression guard for the chokidar v5 migration: globs in `ignored` silently
// stopped matching, so directory filtering moved to this root-scoped predicate.
// If it regresses, the indexer crawls node_modules and hammers the worker.
describe('semantic ignore filter', () => {
  const root = path.resolve('/projects/app')
  const ignore = makeIgnoreFilter(root)
  const p = (...segs: string[]) => path.join(root, ...segs)

  test('does not ignore the root itself', () => {
    expect(ignore(root)).toBe(false)
  })

  test('does not ignore ordinary source files', () => {
    expect(ignore(p('src', 'index.ts'))).toBe(false)
    expect(ignore(p('electron', 'main', 'services', 'semantic.service.ts'))).toBe(false)
    expect(ignore(p('.github', 'workflows', 'ci.yml'))).toBe(false)
    expect(ignore(p('.env'))).toBe(false)
    expect(ignore(p('.private-cache', 'state.json'))).toBe(true)
  })

  test('ignores every configured heavy directory', () => {
    for (const seg of IGNORED_SEGMENTS) {
      expect(ignore(p(seg, 'anything.ts'))).toBe(true)
    }
  })

  test('ignores nested node_modules, not just top-level', () => {
    expect(ignore(p('packages', 'ui', 'node_modules', 'react', 'index.js'))).toBe(true)
  })

  test('indexes relevant dotfiles/directories and ignores hidden caches', () => {
    expect(ignore(p('.env'))).toBe(false)
    expect(ignore(p('.git', 'config'))).toBe(true)
    expect(ignore(p('.vscode', 'settings.json'))).toBe(false)
    expect(ignore(p('.github', 'workflows', 'ci.yml'))).toBe(false)
    expect(ignore(p('src', '.secret.ts'))).toBe(true)
    expect(ignore(p('.private-cache', 'state.json'))).toBe(true)
  })

  test('does not self-exclude when the project lives under a dotted parent', () => {
    // The dotted segment is in the root prefix, above the watched tree, so
    // relative paths inside the project must not be treated as dotfiles.
    const dottedRoot = path.resolve('/home/user/.config/myapp')
    const ig = makeIgnoreFilter(dottedRoot)
    expect(ig(dottedRoot)).toBe(false)
    expect(ig(path.join(dottedRoot, 'src', 'index.ts'))).toBe(false)
    expect(ig(path.join(dottedRoot, 'node_modules', 'x.js'))).toBe(true)
  })

  test('does not ignore paths outside the root', () => {
    expect(ignore(path.resolve('/other/place/node_modules/x.js'))).toBe(false)
  })

  test('honors a custom ignored-segment set', () => {
    const ig = makeIgnoreFilter(root, new Set(['vendor']))
    expect(ig(p('vendor', 'lib.php'))).toBe(true)
    expect(ig(p('node_modules', 'x.js'))).toBe(false) // not in the custom set
  })
})
