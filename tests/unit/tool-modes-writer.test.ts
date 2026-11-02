import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { withToolMode } from '../../electron/main/services/repo-config/tool-modes-writer'

describe('writing a tool group mode to oxe.yaml (F10)', () => {
  it('creates the file content when there is none', () => {
    expect(withToolMode(null, 'data', 'off')).toBe('thread:\n  tools:\n    data: off\n')
    expect(withToolMode('', 'docs', 'always')).toBe('thread:\n  tools:\n    docs: always\n')
  })

  it('adds a thread block and keeps the rest, comments included', () => {
    const text = '# project settings\nscripts:\n  setup: npm ci # install\n'
    expect(withToolMode(text, 'app', 'off')).toBe('# project settings\nscripts:\n  setup: npm ci # install\nthread:\n  tools:\n    app: off\n')
  })

  it('adds tools to an existing thread block, keeping its other keys and indentation', () => {
    const text = 'thread:\n    brief: false\nscripts:\n  setup: make\n'
    expect(withToolMode(text, 'data', 'always')).toBe('thread:\n    brief: false\n    tools:\n        data: always\nscripts:\n  setup: make\n')
  })

  it('turns the 1.3 list form into the map, the listed groups always on', () => {
    expect(withToolMode('thread:\n  tools: [data, docs]\n  brief: true\n', 'docs', 'off')).toBe('thread:\n  tools:\n    data: always\n    docs: off\n  brief: true\n')
    expect(withToolMode('thread:\n  tools:\n    - data\n    - app\n# end\n', 'orchestration', 'on-demand'))
      .toBe('thread:\n  tools:\n    data: always\n    app: always\n    orchestration: on-demand\n# end\n')
  })

  it('changes one group in the map form and keeps the others', () => {
    const written = withToolMode('thread:\n  tools:\n    data: off\n    docs: always\n', 'data', 'on-demand')
    expect(load(written)).toEqual({ thread: { tools: { data: 'on-demand', docs: 'always' } } })
  })

  it('keeps Windows line endings', () => {
    expect(withToolMode('scripts:\r\n  setup: make\r\n', 'data', 'off')).toBe('scripts:\r\n  setup: make\r\nthread:\r\n  tools:\r\n    data: off\r\n')
  })

  it('refuses layouts it cannot edit safely with a C3 code, rather than rewriting them', () => {
    const refusal = (text: string) => { try { withToolMode(text, 'data', 'off'); return null } catch (error) { return error } }
    expect(refusal('thread: { brief: true }\n')).toMatchObject({ code: 'mcp.toolGroups.inlineThread', message: 'mcp.toolGroups.inlineThread' })
    expect(refusal('- a\n- b\n')).toMatchObject({ code: 'mcp.toolGroups.notMapping' })
    expect(refusal('thread:\n  tools: &anchor [data]\nother: *anchor\n')).toMatchObject({ code: 'mcp.toolGroups.unsafeEdit' })
    // More groups in a 1.3 list than the parser reads: the result cannot be verified, so nothing is written.
    expect(refusal(`thread:\n  tools: [${Array.from({ length: 20 }, (_, i) => `g${i}`).join(', ')}]\n`)).toMatchObject({ code: 'mcp.toolGroups.unsafeEdit' })
  })

  it('refuses a file that is not valid YAML with a code, never js-yaml\'s own text', () => {
    for (const text of ['thread:\n  tools: [data\n', 'a: b: c\n', 'thread: "unterminated\n']) {
      expect(() => withToolMode(text, 'data', 'off'), JSON.stringify(text)).toThrow(/^mcp\.toolGroups\.invalidYaml$/)
    }
  })

  it('keeps a byte order mark and still finds the thread block', () => {
    expect(withToolMode('﻿thread:\n  brief: false\n', 'data', 'off')).toBe('﻿thread:\n  brief: false\n  tools:\n    data: off\n')
  })
})
