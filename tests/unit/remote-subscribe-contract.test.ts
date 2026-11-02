// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'
import { SUBSCRIBE_FRAME_KEYS } from '../../electron/main/services/remote/connection'

/** The property names of one interface in protocol.ts, with those of the interfaces it extends (C5 is the source). */
function interfaceKeys(source: ts.SourceFile, name: string): string[] {
  const declaration = source.statements.find((statement): statement is ts.InterfaceDeclaration =>
    ts.isInterfaceDeclaration(statement) && statement.name.text === name)
  if (!declaration) throw new Error(`${name} is not in protocol.ts`)
  const own = declaration.members.flatMap(member => member.name && ts.isIdentifier(member.name) ? [member.name.text] : [])
  const inherited = (declaration.heritageClauses ?? []).flatMap(clause => clause.types)
    .flatMap(type => ts.isIdentifier(type.expression) ? interfaceKeys(source, type.expression.text) : [])
  return [...new Set([...inherited, ...own])]
}

describe('subscribe frame contract (C5)', () => {
  const file = join(__dirname, '../../shared/remote/protocol.ts')
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)

  test('the gateway accepts exactly the fields protocol.ts gives a subscribe frame, cursor included', () => {
    const contract = interfaceKeys(source, 'RemoteSubscribeFrame')
    expect(contract).toContain('cursor')
    expect([...SUBSCRIBE_FRAME_KEYS].sort()).toEqual([...contract].sort())
  })
})
