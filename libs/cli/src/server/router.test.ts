import { describe, it, expect } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Router } from './router.js'
import type { ServerContext } from './router.js'

/**
 * The pod is a single Node process serving every session. An exception that
 * escapes dispatch is not one failed request — it is the whole workspace gone.
 *
 * That happened for real: `/api/health` was registered with a synchronous
 * handler, dispatch called `.catch()` on its `undefined` return, and every team
 * pod died on the kubelet's first startup probe and crash-looped forever.
 */

function req(method: string, url: string): IncomingMessage {
  return { method, url, headers: {} } as IncomingMessage
}

/** A response double that records what dispatch wrote to it. */
function res(): ServerResponse & { status?: number; body: string } {
  const r = {
    status: undefined as number | undefined,
    body: '',
    writeHead(code: number) {
      r.status = code
      return r
    },
    end(chunk?: string) {
      if (chunk) r.body += chunk
      return r
    },
  }
  return r as unknown as ServerResponse & { status?: number; body: string }
}

const ctx = {} as ServerContext
const settle = () => new Promise((r) => setImmediate(r))

describe('Router.dispatch', () => {
  it('survives a SYNCHRONOUS handler instead of crashing the process', async () => {
    const router = new Router()
    router.add('GET', '/api/health', ((_q: unknown, w: ServerResponse) => {
      w.writeHead(200)
      w.end('{"ok":true}')
      // returns undefined — not a promise
    }) as never)

    const r = res()
    expect(router.dispatch(req('GET', '/api/health'), r, ctx)).toBe(true)
    await settle()
    expect(r.status).toBe(200)
    expect(r.body).toBe('{"ok":true}')
  })

  it('turns a handler that throws synchronously into a 500', async () => {
    const router = new Router()
    router.add('GET', '/boom', (() => {
      throw new Error('sync boom')
    }) as never)

    const r = res()
    router.dispatch(req('GET', '/boom'), r, ctx)
    await settle()
    expect(r.status).toBe(500)
    expect(JSON.parse(r.body).error).toBe('sync boom')
  })

  it('still turns a rejected promise into a 500', async () => {
    const router = new Router()
    router.add('GET', '/boom', async () => {
      throw new Error('async boom')
    })

    const r = res()
    router.dispatch(req('GET', '/boom'), r, ctx)
    await settle()
    expect(r.status).toBe(500)
    expect(JSON.parse(r.body).error).toBe('async boom')
  })
})
