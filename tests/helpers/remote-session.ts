import { expect } from 'vitest'
import { REMOTE_LIMITS } from '../../shared/remote/protocol'
import { TestSocket, type Target } from './remote-client'
import { Harness } from './remote-gateway-harness'
import { seedDesktop, type Desk } from './remote-desktop'

/** A paired phone signed in to a gateway that has a desktop: the shared setup of the M4 and M5 tests. */

export type Frame = Record<string, unknown>

export interface Phone { h: Harness; desk: Desk; target: Target; accessToken: string; deviceId: string }

export async function phoneWithDesktop(harnesses: Harness[], seed?: (desk: Desk, h: Harness) => void): Promise<Phone> {
  const h = new Harness()
  harnesses.push(h)
  const desk = seedDesktop(h.db)
  seed?.(desk, h)
  h.gateway = h.create({ desktop: desk.desktop, topicTiming: { pollMs: 40, debounceMs: 10 } })
  const target = await h.enable()
  const { res } = await h.pair()
  const body = res.body as { deviceId: string; accessToken: string }
  return { h, desk, target, accessToken: body.accessToken, deviceId: body.deviceId }
}

export async function signIn(phone: Phone): Promise<TestSocket> {
  const socket = await TestSocket.connect(phone.target)
  await socket.ask({ type: 'hello', versions: [1] })
  expect(await socket.ask({ type: 'auth', id: 'a', accessToken: phone.accessToken })).toMatchObject({ type: 'ack' })
  return socket
}

/** Frames until `done` says the last one ends what the test waits for; every frame is checked against the cap. */
export async function collect(socket: TestSocket, done: (frame: Frame, all: Frame[]) => boolean, timeoutMs = 3000): Promise<Frame[]> {
  const frames: Frame[] = []
  for (;;) {
    const frame = await socket.next(timeoutMs)
    expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThanOrEqual(REMOTE_LIMITS.maxFrameBytes)
    frames.push(frame)
    if (done(frame, frames)) return frames
  }
}

/** Subscribes; returns the stream's name and the frames up to the end of the first snapshot or event. */
export async function subscribe(socket: TestSocket, topic: string, extra: Record<string, unknown> = {}): Promise<{ subscription: string; frames: Frame[] }> {
  const ack = await socket.ask({ type: 'subscribe', id: `s-${topic}`, topic, ...extra })
  expect(ack).toMatchObject({ type: 'ack', subscription: expect.any(String) })
  const frames = await collect(socket, ended)
  return { subscription: ack.subscription as string, frames }
}

/** A snapshot's last page, or an event that carries a cursor. */
export const ended = (frame: Frame): boolean => (frame.type === 'snapshot' && (!frame.page || (frame.page as { last: boolean }).last)) || (frame.type === 'event' && frame.cursor !== undefined)

export const lastCursor = (frames: Frame[]): string => frames.filter(frame => frame.cursor).at(-1)!.cursor as string

/** Nothing more arrives for a while (without leaving a waiter behind that would take the next frame). */
export async function quiet(socket: TestSocket, ms = 250): Promise<void> {
  await sleep(ms)
  expect(socket.frames).toEqual([])
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** The phone goes away for 30 s (the clock moves; the token is still good). */
export function away(phone: Phone, socket: TestSocket): void {
  socket.close()
  phone.h.clock += 30_000
}
