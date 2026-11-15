// Frozen acceptance test for 1.5.2 Polimento · OxeQuery (Jira OXE-214, PQ-07·1, CA-1 and CA-2). Written by the planner;
// the executor must not edit it. Item: oxespace-ux-ag/POLISH-07-oxequery.md #1, approved as written by MARCA.
// Contract: the connection source in New connection is src/ui's SegmentedControl (role radiogroup named form.source,
// one role=radio per option, the Field.module.css segmented/segment classes; "From a running container" stays disabled
// while no container can be used, so SegmentedControl may gain a per-option `disabled`), and the container choice is
// src/ui's Select (the Field.module.css select class, labelled form.containerLabel), not a raw <select>.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ConnectionDialog } from '../../../src/components/OxeQuery/ConnectionDialog'
import { useOxeQueryStore } from '../../../src/components/OxeQuery/oxequery.store'
import field from '../../../src/ui/Field.module.css'
import { installFakeOxeQuery, type FakeOxeQuery } from '../../helpers/oxequery-api'
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
const running = { id: 'billing-db', name: 'billing-db', image: 'postgres:16', state: 'running', status: 'running', labels: {}, ports: [{ hostIp: '0.0.0.0', hostPort: 5433, containerPort: 5432, protocol: 'tcp' }] }
let api: FakeOxeQuery
beforeEach(() => {
  api = installFakeOxeQuery()
  api.on('connections.list', [])
  api.on('containers.list', { engine: 'docker', containers: [running] })
  api.on('containers.suggestConnection', { engine: 'postgres', name: 'billing-db', host: 'localhost', port: 5433, database: 'billing', username: 'app', hasPassword: false })
  useOxeQueryStore.setState({ connections: [], tabs: [], activeTab: '', dialog: { open: false, editing: null } })
})
afterEach(() => { cleanup(); act(() => useOxeQueryStore.setState({ dialog: { open: false, editing: null } })) })

async function newConnection(): Promise<HTMLElement> {
  render(<ConnectionDialog />)
  act(() => useOxeQueryStore.getState().openDialog(null))
  return screen.findByRole('dialog', { name: cat('connections.new') })
}

describe('PQ-07·1 · the connection source is a SegmentedControl and the container a Select', () => {
  test('the source is src/ui SegmentedControl: one segmented track, each option a segment, the chosen one checked', async () => {
    const dialog = within(await newConnection())
    const group = dialog.getByRole('radiogroup', { name: cat('form.source') })
    expect(group).toHaveClass(field.segmented)
    const details = within(group).getByRole('radio', { name: cat('form.sourceDetails') })
    const container = within(group).getByRole('radio', { name: cat('form.sourceContainer') })
    for (const option of [details, container]) expect(option).toHaveClass(field.segment)
    expect(details).toHaveAttribute('aria-checked', 'true')
    expect(group.querySelector('.oq-source-radio')).toBeNull()
  })

  test('choosing a running container checks its segment and the container list is src/ui Select, not a raw select', async () => {
    const dialog = within(await newConnection())
    const container = dialog.getByRole('radio', { name: cat('form.sourceContainer') })
    await waitFor(() => expect(container).toBeEnabled())
    fireEvent.click(container)
    expect(container).toHaveAttribute('aria-checked', 'true')
    const select = await dialog.findByLabelText(cat('form.containerLabel'))
    expect(select.tagName).toBe('SELECT')
    expect(select).toHaveClass(field.select)
  })
})
