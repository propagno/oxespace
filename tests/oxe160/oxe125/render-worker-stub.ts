// Frozen helper for the acceptance tests of 1.6.0 program 160-125 (Jira OXE-125). Written by the planner; the executor
// must not edit it. jsdom has no Web Worker: this stub stands in for `new Worker(url, options)`, records what the
// renderer posts and lets the test answer the way the render worker does ({ id, tree }).
import { act } from '@testing-library/react'
import { vi } from 'vitest'

export interface Posted { id: number; text: string }

export class StubWorker {
  static all: StubWorker[] = []
  readonly url: string
  readonly posted: Posted[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  private readonly listeners = new Set<(event: MessageEvent) => void>()
  constructor(url: string | URL) {
    this.url = String(url)
    StubWorker.all.push(this)
  }
  postMessage(message: Posted): void { this.posted.push(message) }
  addEventListener(type: string, listener: (event: MessageEvent) => void): void { if (type === 'message') this.listeners.add(listener) }
  removeEventListener(type: string, listener: (event: MessageEvent) => void): void { if (type === 'message') this.listeners.delete(listener) }
  terminate(): void { /* nothing runs */ }
  /** Answers one request as the worker would. */
  reply(data: unknown): void {
    const event = { data } as MessageEvent
    act(() => {
      this.onmessage?.(event)
      for (const listener of this.listeners) listener(event)
    })
  }
}

/** Installs the stub as the global Worker; restore with vi.unstubAllGlobals(). */
export function installStubWorker(): void {
  StubWorker.all = []
  vi.stubGlobal('Worker', StubWorker)
}

/** The render worker, if the renderer started one: the stub whose URL names threadRender. */
export function renderWorker(): StubWorker | undefined {
  return StubWorker.all.find(worker => /threadRender/.test(worker.url))
}

/**
 * An answer with every kind of content the worker parses: a GFM table, a TypeScript block, a diff, a display formula,
 * an inline path and an external link.
 */
export const RICH_ANSWER = [
  '| Area | Status |',
  '| --- | --- |',
  '| Parser | **done** |',
  '',
  '```ts',
  'const total: number = 42',
  '```',
  '',
  '```diff',
  '- old line',
  '+ new line',
  '```',
  '',
  '$$',
  'x^2 + y^2 = z^2',
  '$$',
  '',
  'See `src/app.ts` and [the docs](https://example.com/docs).'
].join('\n')
