import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadPermissionStore } from '../../electron/main/services/conversation/thread-permissions'
import { ThreadPolicy } from '../../electron/main/services/conversation/thread-policy'
import type { ThreadRequest } from '../../shared/types/thread'
import { removeTempDir } from '../helpers/removeTempDir'

const dirs: string[] = []
const dbs: AppDatabase[] = []
afterEach(() => { for (const db of dbs.splice(0)) db.close(); for (const dir of dirs.splice(0)) removeTempDir(dir) })

function setup() {
  // The real path: on a Windows runner the temp folder is an 8.3 short name (RUNNER~1), which the path check refuses on purpose.
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-guarded-'))); dirs.push(root)
  const db = openInMemoryDatabase(); dbs.push(db)
  const store = new ThreadPermissionStore(db)
  const policy = new ThreadPolicy(store, () => root, async () => undefined)
  const edit = (path: string, id = 'r1'): ThreadRequest => ({ id, nativeId: id, nativeMethod: 'can_use_tool:Edit', kind: 'approval', title: 'Edit', detail: '', generation: 1, createdAt: 0, state: 'pending', toolName: 'Edit', paths: [path] })
  return { root, store, policy, edit }
}

describe('a change to agent instructions, MCP settings or hooks', () => {
  it('reaches the person even after they allowed edits to every file of the project they could name', () => {
    const { root, store, policy, edit } = setup()
    store.add({ projectRoot: root, kind: 'path', pattern: 'src/**', decision: 'allow' })
    store.add({ projectRoot: root, kind: 'path', pattern: '*.md', decision: 'allow' })
    store.add({ projectRoot: root, kind: 'path', pattern: '.*', decision: 'allow' })
    // An ordinary file under a rule is answered by the rule.
    expect(policy.evaluate(root, edit('src/a.ts'))).toMatchObject({ decision: 'allow' })
    // The files that steer agents are not.
    for (const path of ['AGENTS.md', 'CLAUDE.md', '.mcp.json', '.claude/settings.json', '.claude/hooks/pre.sh', '.git/hooks/pre-commit']) {
      expect(policy.evaluate(root, edit(path)), path).toMatchObject({ decision: 'ask', guarded: true })
    }
  })

  it('is not answered by Full access either, and the request is left pending for the person', () => {
    const { root, policy, edit } = setup()
    const request = { ...edit('AGENTS.md'), policy: policy.evaluate(root, edit('AGENTS.md'), 'full-access') }
    expect(request.policy).toMatchObject({ decision: 'ask', guarded: true })
    // The conversation applies a policy only when it is not 'ask'; an 'ask' waits for a decision by a person.
    expect(request.policy!.suggestions).toBeUndefined()
    // An ordinary edit under Full access is still answered without asking.
    expect(policy.evaluate(root, edit('src/a.ts', 'r2'), 'full-access')).toMatchObject({ decision: 'allow' })
  })

  it('is still declined by a deny rule the person saved', () => {
    const { root, store, policy, edit } = setup()
    store.add({ projectRoot: root, kind: 'path', pattern: 'AGENTS.md', decision: 'deny' })
    expect(policy.evaluate(root, edit('AGENTS.md'), 'full-access')).toMatchObject({ decision: 'deny' })
  })
})
