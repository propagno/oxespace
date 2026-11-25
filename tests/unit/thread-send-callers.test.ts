// SOURCE GUARD: every place in the renderer that reaches thread send or steer, aliases included.
// `sendTyped` and `steerTyped` give the text the person's authority (it may run a desktop command), so they belong to
// text the person just typed and to nothing else: the composer's own send and steer, and the command bar's typed text.
// A resend, retry, starter, plan, quick reply or programmatic send uses `send` or `steer`. A new call site fails here
// on purpose: decide which of the two it is, then add it to the list.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const WATCHED = new Set(['send', 'steer', 'sendTyped', 'steerTyped'])
const TYPED = new Set(['sendTyped', 'steerTyped'])
const MAY_SAY_TYPED = [
  'src/components/CommandBar/CommandBar.tsx',
  'src/components/CommandBar/CommandBarHost.tsx',
  'src/components/Threads/ThreadView.tsx'
]
const CALL_SITES = [
  // Read-only review with another agent (OXE-323): programmatic review prompt.
  'src/components/Changes/reviewWithAgent.ts send 2',
  // The command bar's /steer: what was typed in it.
  'src/components/CommandBar/CommandBar.tsx steerTyped 1',
  // The command bar's "agent: text": what was typed in it.
  'src/components/CommandBar/CommandBarHost.tsx send 1',
  'src/components/CommandBar/CommandBarHost.tsx sendTyped 1',
  // Delivery note and failure card: stored text.
  'src/components/Threads/ThreadMessageRow.tsx send 1',
  'src/components/Threads/ThreadTimelineEntry.tsx send 1',
  // send: the composer, the status line's Retry, the sign-in strip's Retry (legacy failures) and the sign-in failure
  // card's Try again once the account is connected again (LOGIN A, OXE-388): stored text. Typed: the composer only.
  'src/components/Threads/ThreadView.tsx send 4',
  'src/components/Threads/ThreadView.tsx sendTyped 1',
  'src/components/Threads/ThreadView.tsx steer 1',
  'src/components/Threads/ThreadView.tsx steerTyped 1'
]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? files(full) : /\.tsx?$/.test(name) ? [full] : []
  })
}

/** `x.send`, `x?.send`, `x['send']`, `const { send } = x`: whatever the receiver is called. */
function reaches(source: ts.SourceFile): string[] {
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    let name: string | undefined
    if (ts.isPropertyAccessExpression(node) && node.name.text !== undefined) {
      // composerModel's `hints.steer` is a flag of the composer's copy, not the API.
      if (!(node.name.text === 'steer' && node.expression.getText(source) === 'hints')) name = node.name.text
    } else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      name = node.argumentExpression.text
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name
      if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) name = key.text
    } else if (ts.isStringLiteralLike(node) && TYPED.has(node.text) && !ts.isElementAccessExpression(node.parent)) {
      name = node.text
    }
    if (name && WATCHED.has(name)) found.push(name)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const sources = files(join(ROOT, 'src')).map(file => ({ file: relative(ROOT, file).replace(/\\/g, '/'), text: readFileSync(file, 'utf8') }))

describe('who in the renderer reaches thread send and steer', () => {
  it('is exactly the known call sites', () => {
    const counts = new Map<string, number>()
    for (const { file, text } of sources) {
      if (!/send|steer/.test(text)) continue
      for (const name of reaches(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true))) {
        counts.set(`${file} ${name}`, (counts.get(`${file} ${name}`) ?? 0) + 1)
      }
    }
    expect([...counts].map(([key, count]) => `${key} ${count}`).sort()).toEqual([...CALL_SITES].sort())
  })

  it('only the composer and the command bar can say text was typed', () => {
    const users = sources.filter(({ text }) => /\b(sendTyped|steerTyped)\b/.test(text)).map(({ file }) => file)
    expect(users.sort()).toEqual([...MAY_SAY_TYPED].sort())
  })

  it('no renderer code reaches the marker or the two channels around the bridge', () => {
    const users = sources.filter(({ text }) => /\bTHREAD_TEXT_TYPED\b|IPC_CHANNELS\.thread\.(send|steer)\b|['"]thread:(send|steer)['"]/.test(text)).map(({ file }) => file)
    expect(users).toEqual([])
  })
})
