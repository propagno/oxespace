#!/usr/bin/env node
/**
 * 1.4.3 P5 · Signs in to the OXESpace gateway like a phone, subscribes to one topic, and prints what comes back: the
 * screen snapshot (P4) first, then the first frames. A repro and support tool for "the phone shows nothing / garbage".
 * Idea from Orca's mobile/scripts/test-subscribe.ts (MIT License, Copyright (c) 2026 Lovecast Inc.); written for C5.
 *
 * Usage (Node 22+, no build needed):
 *   node scripts/remote-subscribe.mts <deviceToken> --uri "oxespace://pair?…" --pane <paneId>
 *   node scripts/remote-subscribe.mts <deviceToken> --host 192.168.0.10 --port 47321 --fp <sha256 hex> --pane <paneId>
 *   node scripts/remote-subscribe.mts --device device.json --uri "…" --pane <paneId>     (refresh with a saved key)
 *   node scripts/remote-subscribe.mts --pair --device device.json --uri "…"              (pairs a test device first;
 *                                                                                         accept it in Settings › Devices)
 * Options: --topic terminal|threads|thread|workspaces|agents (default terminal), --target <id> (thread id …),
 *          --frames <n> (default 5), --raw (print the snapshot's ANSI as is, so the terminal draws it).
 *
 * <deviceToken> is an access token the gateway gave this device (from /pair or an earlier auth); it lasts until the
 * desktop restarts. A device file holds { deviceId, privateKeyPkcs8 } for a refresh sign-in that survives restarts.
 * The desktop's certificate is pinned by the fingerprint from the QR (--uri or --fp): the script checks it before it
 * sends anything, and stops on a mismatch. It never prints a token or a key.
 */
import { createPrivateKey, generateKeyPairSync, sign, X509Certificate, type KeyObject } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import https from 'node:https'
import type { TLSSocket } from 'node:tls'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('ws') as typeof import('ws')

export interface Options {
  token?: string
  device?: string
  pair: boolean
  host: string
  port: number
  fp: string
  code?: string
  topic: string
  target?: string
  frames: number
  raw: boolean
}

export function parseArgs(argv: readonly string[]): Options {
  const flags = new Map<string, string>()
  const bare: string[] = []
  const switches = new Set(['--raw', '--pair'])
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (switches.has(arg)) flags.set(arg, '1')
    else if (arg.startsWith('--')) flags.set(arg, argv[++index] ?? '')
    else bare.push(arg)
  }
  let host = flags.get('--host') ?? '', port = Number(flags.get('--port') ?? 0), fp = (flags.get('--fp') ?? '').toLowerCase().replace(/:/g, '')
  let code: string | undefined
  const uri = flags.get('--uri')
  if (uri) {
    const prefix = 'oxespace://pair?'
    if (!uri.startsWith(prefix)) throw new Error('--uri must be the pairing QR text (oxespace://pair?…)')
    const query = new URLSearchParams(uri.slice(prefix.length))
    host = query.get('host') ?? host
    port = Number(query.get('port') ?? port)
    fp = (query.get('fp') ?? fp).toLowerCase()
    code = query.get('code') ?? undefined
  }
  const pane = flags.get('--pane'), topic = flags.get('--topic') ?? 'terminal'
  const options: Options = {
    token: bare[0], device: flags.get('--device'), pair: flags.has('--pair'), host, port, fp, code, topic,
    target: flags.get('--target') ?? pane, frames: Math.max(1, Number(flags.get('--frames') ?? 5) || 5), raw: flags.has('--raw')
  }
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Give the desktop as --uri, or --host and --port')
  if (!/^[0-9a-f]{64}$/.test(fp)) throw new Error('Give the certificate fingerprint (64 hex characters) as --uri or --fp')
  if (!options.token && !options.device) throw new Error('Give a <deviceToken>, or --device <file> (with --pair to make one)')
  if (options.pair && (!options.device || !code)) throw new Error('--pair needs --device <file> to save to and --uri with a code')
  if ((topic === 'terminal' || topic === 'thread') && !options.target) throw new Error(`--topic ${topic} needs --pane or --target`)
  return options
}

/** SHA-256 of the certificate DER, lowercase hex: what the QR's `fp` names. */
export function fingerprintOf(socket: TLSSocket): string | null {
  const raw = socket.getPeerCertificate(false)?.raw
  if (!raw) return null
  return new X509Certificate(raw).fingerprint256.replace(/:/g, '').toLowerCase()
}

/** A frame summary safe to print: tokens never, long text cut. */
export function describeFrame(frame: Record<string, unknown>): string {
  const copy = JSON.parse(JSON.stringify(frame)) as Record<string, unknown>
  const result = copy.result as Record<string, unknown> | undefined
  if (result && 'accessToken' in result) result.accessToken = '[hidden]'
  const data = copy.data as Record<string, unknown> | undefined
  if (data && typeof data.data === 'string' && data.data.length > 200) data.data = `${data.data.slice(0, 200)}… (${(frame.data as { data: string }).data.length} chars)`
  if (data && data.snapshot) {
    const snapshot = data.snapshot as { ansi: string; cols: number; rows: number }
    data.snapshot = { cols: snapshot.cols, rows: snapshot.rows, ansi: `[${snapshot.ansi.length} chars]` }
  }
  return JSON.stringify(copy)
}

async function pairDevice(options: Options): Promise<void> {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
  const body = JSON.stringify({ code: options.code, deviceName: 'remote-subscribe', publicKey })
  console.error('Pairing a test device: accept "remote-subscribe" in OXESpace › Settings › Devices…')
  const answer = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = https.request({ host: options.host, port: options.port, path: '/pair', method: 'POST', rejectUnauthorized: false, agent: false, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, response => {
      const pinned = fingerprintOf(response.socket as TLSSocket)
      if (pinned !== options.fp) { request.destroy(); reject(new Error(`Certificate fingerprint mismatch: expected ${options.fp}, got ${pinned}`)); return }
      let text = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { text += chunk })
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: text }))
    })
    request.on('error', reject)
    request.end(body)
  })
  if (answer.status !== 200) throw new Error(`Pairing refused (${answer.status}): ${answer.body}`)
  const { deviceId, accessToken } = JSON.parse(answer.body) as { deviceId: string; accessToken: string }
  writeFileSync(options.device!, JSON.stringify({ deviceId, privateKeyPkcs8: keys.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url') }, null, 2), { mode: 0o600 })
  console.error(`Paired as ${deviceId}; key saved to ${options.device}.`)
  options.token = accessToken
}

function authFrame(options: Options, challenge: string): Record<string, unknown> {
  if (options.token) return { type: 'auth', id: 'auth', accessToken: options.token }
  const saved = JSON.parse(readFileSync(options.device!, 'utf8')) as { deviceId: string; privateKeyPkcs8: string }
  const key: KeyObject = createPrivateKey({ key: Buffer.from(saved.privateKeyPkcs8, 'base64url'), format: 'der', type: 'pkcs8' })
  const signature = sign('sha256', Buffer.from(`oxespace-refresh:1:${options.fp}:${saved.deviceId}:${challenge}`), key).toString('base64url')
  return { type: 'auth', id: 'auth', refresh: { deviceId: saved.deviceId, nonce: challenge, signature } }
}

export async function run(options: Options, out: (line: string) => void = console.log, write: (text: string) => void = text => process.stdout.write(text)): Promise<number> {
  if (options.pair) await pairDevice(options)
  const socket = new WebSocket(`wss://${options.host.includes(':') ? `[${options.host}]` : options.host}:${options.port}/v1/ws`, { rejectUnauthorized: false, perMessageDeflate: false })
  return new Promise<number>(resolve => {
    let shown = 0, verified = false
    const finish = (code: number) => { try { socket.close() } catch { /* closed */ } resolve(code) }
    const send = (frame: Record<string, unknown>) => socket.send(JSON.stringify(frame))
    socket.on('upgrade', response => {
      const pinned = fingerprintOf(response.socket as TLSSocket)
      if (pinned !== options.fp) { out(`Certificate fingerprint mismatch: expected ${options.fp}, got ${pinned}. Nothing was sent.`); socket.terminate(); resolve(2); return }
      verified = true
    })
    socket.on('open', () => { if (verified) send({ type: 'hello', versions: [1] }) })
    socket.on('message', raw => {
      const frame = JSON.parse(String(raw)) as Record<string, unknown>
      if (frame.type === 'hello') { out(`hello from "${String(frame.desktopName ?? 'OXESpace')}"`); send(authFrame(options, String(frame.challenge ?? ''))); return }
      if (frame.type === 'ack' && frame.id === 'auth') { out('signed in'); send({ type: 'subscribe', id: 'sub', topic: options.topic, ...(options.target ? { target: options.target } : {}) }); return }
      if (frame.type === 'error') { out(`error: ${describeFrame(frame)}`); finish(1); return }
      if (frame.type === 'ack' && frame.id === 'sub') { out(`subscribed: ${String(frame.subscription)}`); return }
      if (frame.type === 'snapshot' || frame.type === 'event') {
        const snapshot = (frame.data as { snapshot?: { ansi: string; cols: number; rows: number } } | undefined)?.snapshot
        if (snapshot) {
          out(`snapshot: ${snapshot.cols}×${snapshot.rows}, ${snapshot.ansi.length} chars of ANSI`)
          if (options.raw) write(`\x1b[2J\x1b[H${snapshot.ansi}\x1b[0m\r\n`)
          else out(snapshot.ansi.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g, ''))
        }
        out(`${frame.type}: ${describeFrame(frame)}`)
        shown += 1
        if (shown >= options.frames) finish(0)
      }
    })
    socket.on('error', error => { out(`connection failed: ${error.message}`); finish(1) })
    socket.on('close', () => resolve(shown ? 0 : 1))
  })
}

const invoked = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!)
if (invoked) {
  let options: Options
  try { options = parseArgs(process.argv.slice(2)) } catch (error) { console.error((error as Error).message); process.exit(64) }
  run(options!).then(code => process.exit(code), error => { console.error((error as Error).message); process.exit(1) })
}
