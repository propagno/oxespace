// Frozen acceptance test for 1.5.2 Polimento · OxeQuery (Jira OXE-223, PQ-07·10, CA-1 to CA-3). Written by the planner;
// the executor must not edit it. Item: oxespace-ux-ag/POLISH-07-oxequery.md #10, approved as written by MARCA.
// Contract: no OxeQuery button is drawn with .oq-primary any more (the class and its !important rule are gone); Mongo's
// Run is src/ui Button primary small (data-ui=button, data-variant=primary, data-size=sm) with the Ctrl+Enter chord in
// src/ui Kbd, as in the SQL bar; Mongo's bar follows the SQL order: Run, Explain and Limit on the left, Library and Ask
// agent on the right (after the spacer); and Ctrl+Enter (Mod+Enter) in a JSON field of the Mongo query runs it.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { MongoWorkbench } from '../../../src/components/OxeQuery/MongoWorkbench'
import field from '../../../src/ui/Field.module.css'
import { connection, installFakeOxeQuery, type FakeOxeQuery } from '../../helpers/oxequery-api'
// ---- catalog strings (inlined in each frozen file so every task's PR stands alone) ----
import { readFileSync as pqReadFile } from 'node:fs'
import { join as pqJoin } from 'node:path'

const pqRead = (rel: string): string => pqReadFile(pqJoin(process.cwd(), rel), 'utf8')
const pqCatalogs: Record<string, unknown> = {}
/** The OxeQuery catalog text of a key, so elements are found by the string the person reads. A missing key fails loudly. */
function cat(key: string, vars: Record<string, string | number> = {}, lang: 'en' | 'pt-BR' = 'en'): string {
  pqCatalogs[lang] ??= JSON.parse(pqRead(`shared/locales/${lang}/oxequery.json`))
  let node: unknown = pqCatalogs[lang]
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the ${lang} oxequery catalog has no key ${key}`)
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? `{{${name}}}`))
}
let api: FakeOxeQuery
beforeEach(() => {
  api = installFakeOxeQuery()
  for (const [op, value] of Object.entries({
    'mongo.databases': [{ name: 'shop' }], 'mongo.collections': [{ name: 'items', type: 'collection' }], 'library.list': { saved: [], history: [] },
    'mongo.find': { documents: ['{"_id":1,"sku":"a"}'], truncated: false, durationMs: 1, total: 1 }, 'mongo.indexes': [],
    'mongo.validation': { validator: null, level: 'strict', action: 'error' },
    'mongo.stats': { documents: 1, sizeBytes: 1, avgDocumentBytes: 1, storageBytes: 1, indexes: 1, indexBytes: 1, capped: false }
  })) api.on(op, value)
})
afterEach(() => cleanup())

async function openItems() {
  render(<MongoWorkbench connection={connection({ engine: 'mongodb' })} />)
  fireEvent.click(await screen.findByRole('button', { name: 'shop' }))
  fireEvent.click(await screen.findByRole('button', { name: 'items' }))
  await waitFor(() => expect(api.callsOf('mongo.find').length).toBeGreaterThan(0))
  return document.querySelector<HTMLElement>('.oq-editor-toolbar')!
}
const run = () => screen.getAllByRole('button', { name: new RegExp(`^${cat('common.run')}`) })[0]

describe('PQ-07·10 · the Mongo editor bar matches SQL and Run is the src/ui primary Button', () => {
  test('Run is src/ui Button primary and small, with Ctrl+Enter in a Kbd, and nothing uses .oq-primary', async () => {
    const bar = await openItems()
    expect(run()).toHaveAttribute('data-ui', 'button')
    expect(run()).toHaveAttribute('data-variant', 'primary')
    expect(run()).toHaveAttribute('data-size', 'sm')
    expect(run().querySelector(`kbd.${field.kbd}`)).not.toBeNull()
    expect(bar.querySelector('.oq-primary')).toBeNull()
    expect(pqRead('src/components/OxeQuery/OxeQuery.css')).not.toMatch(/\.oq-primary\b/)
  })

  test('the bar reads Run, Explain, Limit on the left and Library, Ask agent on the right', async () => {
    const bar = await openItems()
    const all = [...bar.querySelectorAll<HTMLElement>('button, select, .oq-spacer')]
    const at = (match: (node: HTMLElement) => boolean): number => all.findIndex(match)
    const runAt = at(node => node === run())
    const explainAt = at(node => node.textContent?.trim() === cat('workbench.explain'))
    const limitAt = at(node => node.tagName === 'SELECT')
    const spacerAt = at(node => node.classList.contains('oq-spacer'))
    const libraryAt = at(node => (node.getAttribute('aria-label') ?? node.textContent ?? '').includes(cat('library.title')))
    const askAt = at(node => (node.getAttribute('aria-label') ?? node.textContent ?? '').includes(cat('ask.button')))
    expect([runAt, explainAt, limitAt, libraryAt, askAt].every(index => index >= 0)).toBe(true)
    expect(runAt).toBeLessThan(explainAt)
    expect(explainAt).toBeLessThan(limitAt)
    expect(limitAt).toBeLessThan(spacerAt)
    expect(spacerAt).toBeLessThan(libraryAt)
    expect(libraryAt).toBeLessThan(askAt)
  })

  test('Ctrl+Enter in the filter field runs the query', async () => {
    await openItems()
    const before = api.callsOf('mongo.find').length
    fireEvent.change(screen.getByLabelText(cat('mongo.filter')), { target: { value: '{"sku":"a"}' } })
    fireEvent.keyDown(screen.getByLabelText(cat('mongo.filter')), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(api.callsOf('mongo.find').length).toBe(before + 1))
    expect(api.callsOf('mongo.find').at(-1)).toMatchObject({ filter: '{"sku":"a"}' })
  })
})
