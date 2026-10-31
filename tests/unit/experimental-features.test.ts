// @vitest-environment node
import { afterEach, expect, test } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureExperimentalFeatures, sharedProjectMemoryEnabled } from '../../electron/main/services/experimental-features'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function userData(content?: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'oxe-experimental-'))
  directories.push(directory)
  if (content !== undefined) await writeFile(join(directory, 'experimental.json'), content)
  return directory
}

test('Shared Project Memory is off by default and without configuration', async () => {
  configureExperimentalFeatures(await userData())
  expect(sharedProjectMemoryEnabled({})).toBe(false)
})

test('the persisted setting turns it on only for an explicit true', async () => {
  configureExperimentalFeatures(await userData('{"sharedProjectMemory":true}'))
  expect(sharedProjectMemoryEnabled({})).toBe(true)
  for (const content of ['{"sharedProjectMemory":"yes"}', '{"sharedProjectMemory":1}', '{}', 'not json', '']) {
    configureExperimentalFeatures(await userData(content))
    expect(sharedProjectMemoryEnabled({})).toBe(false)
  }
})

test('the environment override beats the persisted setting in both directions', async () => {
  configureExperimentalFeatures(await userData('{"sharedProjectMemory":false}'))
  expect(sharedProjectMemoryEnabled({ OXESPACE_EXPERIMENTAL_MEMORY: '1' })).toBe(true)
  configureExperimentalFeatures(await userData('{"sharedProjectMemory":true}'))
  expect(sharedProjectMemoryEnabled({ OXESPACE_EXPERIMENTAL_MEMORY: '0' })).toBe(false)
  expect(sharedProjectMemoryEnabled({ OXESPACE_EXPERIMENTAL_MEMORY: 'true' })).toBe(true)
})
