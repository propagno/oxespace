import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: vi.fn(() => ({})) } }))
const { parseBytes, parseDirectory, parseOneOf, parseText, parseToken, requireAppFrame } = await import('../../electron/main/ipc/ipc-guards')

describe('IPC guards', () => {
  it('accepts only existing absolute directories as project roots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oxe-guard-'))
    writeFileSync(join(dir, 'file.txt'), 'x')
    expect(parseDirectory(dir)).toBe(dir)
    expect(() => parseDirectory('relative/path')).toThrow('absolute')
    expect(() => parseDirectory(join(dir, 'file.txt'))).toThrow('not an existing directory')
    expect(() => parseDirectory(join(dir, 'missing'))).toThrow('not an existing directory')
    expect(() => parseDirectory(`${dir}\0x`)).toThrow('directory path')
    expect(() => parseDirectory(42)).toThrow('directory path')
  })

  it('bounds binary payloads, identifiers, choices and text', () => {
    expect(parseBytes(new Uint8Array([1]), 10, 'Audio').byteLength).toBe(1)
    expect(() => parseBytes(new Uint8Array(11), 10, 'Audio')).toThrow('Audio must be between')
    expect(() => parseBytes('not bytes', 10, 'Audio')).toThrow('binary data')
    expect(parseToken('claude', 'Provider')).toBe('claude')
    expect(() => parseToken('../etc', 'Provider')).toThrow('valid identifier')
    expect(parseOneOf('base', ['tiny', 'base'] as const, 'Model size')).toBe('base')
    expect(() => parseOneOf('huge', ['tiny', 'base'] as const, 'Model size')).toThrow('one of tiny, base')
    expect(parseText('a'.repeat(300), 'Title', 200)).toHaveLength(200)
    expect(() => parseText('a\0b', 'Title', 200)).toThrow('must be text')
  })

  it('refuses requests from a subframe of the window', () => {
    const mainFrame = {}
    expect(() => requireAppFrame({ sender: { mainFrame }, senderFrame: mainFrame } as never)).not.toThrow()
    expect(() => requireAppFrame({ sender: { mainFrame }, senderFrame: {} } as never, 'Voice input')).toThrow('Voice input requires the application main frame')
  })
})
