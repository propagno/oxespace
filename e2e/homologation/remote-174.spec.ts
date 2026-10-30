import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from '../helpers/launch'
import { readPairingUri } from '../../shared/remote/protocol'

/** Homologation of #174 (remote.* contract): the E2E mock walks status, pairing with a prompt, accept, rename, revoke. */
test('remote contract through the window API (mock gateway)', async () => {
  test.setTimeout(60_000)
  process.env.OXESPACE_E2E_REMOTE_PAIR_PROMPT = '1'
  const { app, page } = await launchApp()
  try {
    const out = await page.evaluate(async () => {
      type Api = Record<string, (input?: unknown) => Promise<unknown>> & { onChanged: (l: (c: unknown) => void) => () => void }
      const remote = (window as unknown as { oxe: { remote: Api } }).oxe.remote
      const events: unknown[] = []
      remote.onChanged(change => events.push(change))
      const attempt = async (name: string, input?: unknown) => { try { return await remote[name](input) } catch (error) { return `error: ${(error as Error).message.slice(0, 160)}` } }
      const status = await attempt('status')
      const devices = await attempt('devices')
      const lowPort = await attempt('setEnabled', { enabled: true, port: 80 })
      const enabled = await attempt('setEnabled', { enabled: true, port: 47_000 })
      const offer = await attempt('startPairing') as { uri: string }
      await new Promise(r => setTimeout(r, 700))
      const prompt = (events.find(e => (e as { pairing?: unknown }).pairing) as { pairing: { promptId: string } } | undefined)?.pairing
      const accepted = prompt ? await attempt('answerPairing', { promptId: prompt.promptId, accept: true }) : 'no prompt'
      const after = await attempt('devices') as Array<{ deviceId: string; name: string }>
      const longName = await attempt('rename', { deviceId: after[0]?.deviceId, name: 'x'.repeat(65) })
      const renamed = await attempt('rename', { deviceId: after[0]?.deviceId, name: 'Celular do trabalho' })
      const revoked = await attempt('revoke', { deviceId: after[0]?.deviceId })
      const unknownRevoke = await attempt('revoke', { deviceId: 'nope' })
      return { status, devices, lowPort, enabled, offer, prompt, accepted, after, longName, renamed, revoked, unknownRevoke, finalDevices: await attempt('devices'), events: events.length }
    })
    const uri = (out.offer as { uri?: string })?.uri
    const checked = { ...out, offerUriValid: uri ? readPairingUri(uri).ok : false }
    const dir = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'b9-174')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'notes.json'), JSON.stringify(checked, null, 2))
  } finally { await app.close() }
})
