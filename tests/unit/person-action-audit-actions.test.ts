// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const DIR = join(process.cwd(), 'electron', 'main', 'db', 'migrations')

/** The actions each migration's rebuild of person_action_audit accepts, in the order the migrations run. */
function rebuilds(): Array<{ file: string; actions: string[] }> {
  return readdirSync(DIR).filter(name => /^\d{3}_.*\.sql$/.test(name)).sort().flatMap(file => {
    const sql = readFileSync(join(DIR, file), 'utf8')
    const table = /CREATE TABLE(?: IF NOT EXISTS)? person_action_audit(?:_new)? \(([\s\S]*?)\n\);/.exec(sql)?.[1]
    const list = table ? /action TEXT NOT NULL CHECK \(action IN \(([\s\S]*?)\)\)/.exec(table)?.[1] : undefined
    return list ? [{ file, actions: [...list.matchAll(/'([^']+)'/g)].map(match => match[1]) }] : []
  })
}

describe('the audit of what the person did', () => {
  test('a migration that rebuilds the table keeps every action the one before it accepted', () => {
    const all = rebuilds()
    expect(all.length).toBeGreaterThanOrEqual(4)
    for (let index = 1; index < all.length; index++) {
      const dropped = all[index - 1].actions.filter(action => !all[index].actions.includes(action))
      expect(dropped, `${all[index].file} drops actions that ${all[index - 1].file} accepts: rows with them would abort the copy`).toEqual([])
    }
  })

  test('the Android panel\'s three actions are accepted from 103 on', () => {
    const latest = rebuilds().at(-1)!
    for (const action of ['android-install-apk', 'android-open-link', 'android-pair-link', 'hosts-proxy-on', 'android-agents-can-see']) expect(latest.actions, action).toContain(action)
  })
})
