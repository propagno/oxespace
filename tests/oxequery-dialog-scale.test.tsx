import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportPreview, ImportResult } from '../shared/types/oxequery'
import { ImportButton } from '../src/components/OxeQuery/ImportDialog'
import { NewDatabaseDialog } from '../src/components/OxeQuery/NewDatabaseDialog'
import { ServerPanel } from '../src/components/OxeQuery/ServerPanel'
import structureEditor from '../src/components/OxeQuery/StructureEditor.module.css'
import { changeLanguage } from '../src/i18n'
import { connection, installFakeOxeQuery, type FakeOxeQuery } from './helpers/oxequery-api'

/**
 * OXE-160: the Import, "Server of <db>" and New database dialogs draw on the same scale as the other OxeQuery dialogs.
 * jsdom has no layout, so the test renders each dialog and runs the stylesheets that reach a dialog (OxeQuery.css, the
 * CSS Modules of src/ui and the module the server panel uses) against the rendered nodes: every text in the dialog body
 * takes its size from a --text-2xs/xs/sm token (none falls through to the page's 16 px, none is a literal), every label
 * of a field sits above it, every field with a placeholder fills its column (a field sized by the browser cut "first
 * free port" to "first free p"), and no matched rule paints a literal colour.
 */

const ROOT = join(__dirname, '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

interface Rule { selector: string; declarations: Array<[string, string]>; source: string }

/** Splits on a separator outside parentheses and brackets. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0, start = 0
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (char === separator && depth === 0) { parts.push(text.slice(start, index)); start = index + 1 }
  }
  parts.push(text.slice(start))
  return parts.map(part => part.trim()).filter(Boolean)
}

/** A small reader for the flat CSS these files use: rules, inside @layer, @media and @container blocks. */
function parseCss(css: string, source: string, classes?: Record<string, string>): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: Rule[] = []
  const walk = (block: string): void => {
    let index = 0
    while (index < block.length) {
      const open = block.indexOf('{', index), semicolon = block.indexOf(';', index)
      if (open === -1) return
      if (semicolon !== -1 && semicolon < open && block.slice(index, semicolon).trim().startsWith('@')) { index = semicolon + 1; continue }
      let depth = 1, close = open + 1
      for (; close < block.length && depth > 0; close++) { if (block[close] === '{') depth++; else if (block[close] === '}') depth-- }
      const head = block.slice(index, open).trim(), body = block.slice(open + 1, close - 1)
      index = close
      if (head.startsWith('@')) { if (/^@(layer|media|container|supports)\b/.test(head)) walk(body); continue }
      const declarations = splitTop(body, ';').map(item => {
        const colon = item.indexOf(':')
        return [item.slice(0, colon).trim().toLowerCase(), item.slice(colon + 1).trim()] as [string, string]
      }).filter(([name]) => name)
      for (const raw of splitTop(head, ',')) {
        if (raw.includes('::')) continue
        const selector = classes ? raw.replace(/\.(-?[_a-zA-Z][\w-]*)/g, (whole, name: string) => classes[name] ? `.${classes[name]}` : whole) : raw
        rules.push({ selector, declarations, source })
      }
    }
  }
  walk(text)
  return rules
}

const uiModules = import.meta.glob('../src/ui/*.module.css', { eager: true }) as Record<string, { default: Record<string, string> }>
const RULES: Rule[] = [
  ...parseCss(read('src/components/OxeQuery/OxeQuery.css'), 'OxeQuery.css'),
  ...parseCss(read('src/components/OxeQuery/StructureEditor.module.css'), 'StructureEditor.module.css', structureEditor),
  ...Object.entries(uiModules).flatMap(([path, module]) => parseCss(read(path.replace(/^\.\.\//, '')), path.split('/').pop() ?? path, module.default))
]

function matched(node: Element): Rule[] {
  return RULES.filter(rule => { try { return node.matches(rule.selector) } catch { return false } })
}
const declared = (node: Element, names: string[]): Array<{ name: string; value: string; rule: Rule }> =>
  matched(node).flatMap(rule => rule.declarations.filter(([name]) => names.includes(name)).map(([name, value]) => ({ name, value, rule })))

const TYPE_TOKEN = /^var\(--text-(2xs|xs|sm)\)$/
const describeNode = (node: Element): string => `<${node.tagName.toLowerCase()}${node.className && typeof node.className === 'string' ? ` class="${node.className}"` : ''}> "${(node.textContent || (node as HTMLInputElement).placeholder || '').trim().slice(0, 40)}"`

/** The size a node's text takes: the nearest font size a matched rule sets on it or an ancestor in the dialog. */
function fontSize(node: Element, dialog: Element): string {
  for (let current: Element | null = node; current && current !== dialog.parentElement; current = current.parentElement) {
    const sizes = declared(current, ['font-size', 'font'])
      .map(({ name, value }) => name === 'font' ? value.match(/var\(--text-[\w-]+\)|\b[\d.]+(px|rem|em|pt|%)/)?.[0] ?? '' : value)
      .filter(value => value && value !== 'inherit')
    const literal = sizes.find(value => !TYPE_TOKEN.test(value))
    if (literal) return literal
    if (sizes.length) return sizes[sizes.length - 1]
  }
  return 'the page size (no token reaches it)'
}

const ownText = (node: Element): boolean => [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())
const isControl = (node: Element): boolean => node.matches('select, textarea, input:not([type="checkbox"], [type="radio"], [type="hidden"])')

function problems(dialog: HTMLElement): string[] {
  const body = dialog.querySelector('[data-dialog-body]')
  expect(body, 'the dialog has a body').not.toBeNull()
  const found: string[] = []
  for (const node of [body!, ...body!.querySelectorAll('*')]) {
    if (node.closest('option, svg')) continue
    if (ownText(node) || isControl(node)) {
      const size = fontSize(node, dialog)
      if (!TYPE_TOKEN.test(size)) found.push(`type: ${describeNode(node)} draws at ${size}`)
    }
    if (node.tagName === 'LABEL' && [...node.querySelectorAll('*')].some(isControl)) {
      const display = declared(node, ['display']).map(item => item.value)
      const stacked = display.some(value => value === 'grid') || (display.some(value => value === 'flex') && declared(node, ['flex-direction']).some(item => item.value === 'column'))
      if (!stacked) found.push(`label: ${describeNode(node)} sits inline with its field`)
    }
    if (node.matches('input[placeholder]:not([type="checkbox"], [type="radio"])') && !declared(node, ['width', 'inline-size']).some(item => item.value === '100%')) {
      found.push(`cut: ${describeNode(node)} keeps the browser's width, so its placeholder is cut`)
    }
    if (node.matches('label, legend') && declared(node, ['text-overflow']).some(item => item.value === 'ellipsis')) found.push(`cut: ${describeNode(node)} is ellipsized`)
    for (const { name, value, rule } of declared(node, ['color', 'background', 'background-color', 'border', 'border-color', 'border-top', 'border-bottom', 'outline', 'box-shadow'])) {
      if (/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/i.test(value)) found.push(`colour: ${describeNode(node)} ${name}: ${value} (${rule.source})`)
    }
  }
  return [...new Set(found)]
}

/** No text is a missing catalog key. */
const rawKeys = (dialog: HTMLElement): string[] => [...dialog.querySelectorAll('*')].filter(ownText).map(node => node.textContent!.trim()).filter(text => /^[a-z]+(\.[a-zA-Z0-9]+)+$/.test(text))

const preview: ImportPreview = {
  importId: 'imp1', fileName: 'users.csv', format: 'csv', bytes: 2048, fields: ['id', 'Email'], sample: [['1', 'a@example.com']],
  targetColumns: [{ name: 'id', type: 'integer', nullable: false, hasDefault: true, generated: false }, { name: 'email', type: 'text', nullable: false, hasDefault: false, generated: false }],
  mapping: { id: 'id', Email: 'email' }, options: { delimiter: 'auto', hasHeader: true, encoding: 'auto' }, detected: { delimiter: ';', encoding: 'utf-8' }
}
const dryRun: ImportResult = { dryRun: true, inserted: 2, rejected: 1, rejects: [{ row: 3, reason: 'null value in column "email"' }], durationMs: 5 }

let api: FakeOxeQuery
beforeEach(() => {
  api = installFakeOxeQuery()
  api.on('import.preview', preview)
  api.on('import.run', dryRun)
  api.on('sql.databases', [{ name: 'app', owner: 'postgres', encoding: 'UTF8', sizeBytes: 8_400_000, current: true }, { name: 'reports', owner: 'postgres', encoding: 'UTF8', sizeBytes: null, current: false }])
  api.on('sql.roles', [{ name: 'postgres', login: true, superuser: true, createDatabase: true, createRole: true, replication: true, memberOf: [] }])
})
afterEach(async () => { cleanup(); await changeLanguage('en') })

const DIALOGS: Array<{ name: string; open: () => Promise<HTMLElement> }> = [
  { name: 'New database', open: async () => { render(<NewDatabaseDialog onClose={vi.fn()} />); return screen.findByRole('dialog') } },
  { name: 'Server of <db>', open: async () => {
    render(<ServerPanel connection={connection()} onClose={vi.fn()} />)
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('table')
    return dialog
  } },
  { name: 'Import (table, after a dry run)', open: async () => {
    render(<ImportButton connection={connection()} target={{ kind: 'table', schema: 'public', table: 'users' }} onImported={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^(Import|Importar)$/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getAllByRole('combobox').at(-1)!, { target: { value: 'skip' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /^(Dry run|Simular|Testar)/ })) })
    await within(dialog).findAllByRole('status')
    return dialog
  } },
  { name: 'Import (collection)', open: async () => {
    render(<ImportButton connection={connection({ engine: 'mongodb' })} target={{ kind: 'collection', database: 'app', collection: 'users' }} onImported={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^(Import|Importar)$/ }))
    return screen.findByRole('dialog')
  } }
]

describe('OXE-160: the Import, Server and New database dialogs draw on the OxeQuery dialog scale', () => {
  for (const language of ['en', 'pt-BR'] as const) {
    for (const { name, open } of DIALOGS) {
      it(`${name} (${language}): type tokens only, labels above their fields, nothing cut, token colours`, async () => {
        await changeLanguage(language)
        const dialog = await open()
        expect(problems(dialog)).toEqual([])
        expect(rawKeys(dialog)).toEqual([])
      })
    }
  }

  it('the OxeQuery stylesheet sets no pixel font size for these dialogs', () => {
    const literal = RULES.filter(rule => rule.source === 'OxeQuery.css' && /oq-(import|dialog-form|new-database)/.test(rule.selector))
      .flatMap(rule => rule.declarations.filter(([name, value]) => name === 'font-size' && !TYPE_TOKEN.test(value)).map(([, value]) => `${rule.selector} { font-size: ${value} }`))
    expect(literal).toEqual([])
  })
})
