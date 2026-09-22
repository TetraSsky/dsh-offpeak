import test from 'node:test'
import assert from 'node:assert/strict'
import { CHANNEL, installRpcChannel } from '../src/host-rpc.js'
import { Config } from '../src/schema.js'

const makeRequest = ({ method = 'POST', url = `${CHANNEL}/balance`, body = {} } = {}) => {
  const listeners = new Map()
  const req = {
    method,
    url,
    headers: {},
    on(event, callback) {
      listeners.set(event, [...(listeners.get(event) ?? []), callback])
      return req
    },
    destroy() {},
  }
  queueMicrotask(() => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body)
    for (const callback of listeners.get('data') ?? []) callback(raw)
    for (const callback of listeners.get('end') ?? []) callback()
  })
  return req
}

const makeResponse = () => ({
  status: 0,
  headers: {},
  body: '',
  writeHead(status, headers) {
    this.status = status
    this.headers = headers ?? {}
  },
  end(payload) {
    this.body = payload ?? ''
  },
})

const harness = (handlers, { rejection, withWebServer = true } = {}) => {
  const captured = {}
  const reports = []
  const webServer = {
    register: (route) => {
      captured.route = route
      return () => {}
    },
  }
  const connection = { requestRejection: () => rejection }
  const ctx = {
    get: (name) =>
      name === 'webServer' ? (withWebServer ? webServer : undefined) : name === 'connection' ? connection : undefined,
    effect: (factory) => factory(),
  }
  const installed = installRpcChannel({ ctx, report: (tag, value) => reports.push([tag, value]), handlers })
  return { captured, reports, installed }
}

const call = async (route, options) => {
  const res = makeResponse()
  await route.handler(makeRequest(options), res)
  const isJson = String(res.headers['content-type'] ?? '').includes('application/json')
  return { status: res.status, body: res.body === '' ? undefined : isJson ? JSON.parse(res.body) : res.body }
}

test('the channel satisfies Connection\'s target grammar', () => {
  // Connection needs a leading slash and rejects "/api" as reserved.
  assert.match(CHANNEL, /^\/[A-Za-z0-9._~-]+$/)
  assert.notEqual(CHANNEL, '/api')
})

test('the route is registered as a prefix route on the plugin channel', () => {
  const { captured, reports } = harness({ balance: () => 'ok' })
  assert.equal(captured.route.kind, 'prefix')
  assert.equal(captured.route.path, CHANNEL)
  assert.ok(reports.some(([tag, value]) => tag === 'rpc route registered' && value.guarded === true))
})

test('a valid envelope is answered in Connection\'s response shape', async () => {
  const { captured } = harness({ balance: () => ({ total: 12.5 }) })
  const { status, body } = await call(captured.route, {
    body: { type: 'client-request', rpcId: 'rpc-1', method: 'balance', payload: null },
  })

  assert.equal(status, 200)
  assert.equal(body.type, 'server-response')
  assert.equal(body.rpcId, 'rpc-1')
  assert.deepEqual(body.result, { ok: true, value: { total: 12.5 } })
})

test('the rpcId is echoed so the browser can correlate the answer', async () => {
  const { captured } = harness({ status: () => 1 })
  const { body } = await call(captured.route, {
    body: { type: 'client-request', rpcId: 'abc-123', method: 'status', payload: null },
  })
  assert.equal(body.rpcId, 'abc-123')
})

test('an unknown endpoint is refused rather than silently succeeding', async () => {
  const { captured } = harness({ status: () => 1 })
  const { status, body } = await call(captured.route, {
    url: `${CHANNEL}/nope`,
    body: { type: 'client-request', rpcId: 'r1', method: 'nope', payload: null },
  })
  assert.equal(status, 200)
  assert.equal(body.result.ok, false)
  assert.equal(body.result.error.code, 'not-found')
})

test('a throwing handler becomes a failure result, never a 500', async () => {
  const { captured } = harness({
    balance: () => {
      throw new Error('no DEEPSEEK_API_KEY is stored')
    },
  })
  const { status, body } = await call(captured.route, {
    body: { type: 'client-request', rpcId: 'r1', method: 'balance', payload: null },
  })
  assert.equal(status, 200)
  assert.equal(body.result.error.code, 'internal')
  assert.match(body.result.error.message, /DEEPSEEK_API_KEY/)
})

test('a non-POST request is not served', async () => {
  const { captured } = harness({ status: () => 1 })
  const { status } = await call(captured.route, { method: 'GET' })
  assert.equal(status, 404)
})

test('a path outside the channel is not served', async () => {
  const { captured } = harness({ status: () => 1 })
  const { status } = await call(captured.route, { url: '/somewhere-else/status' })
  assert.equal(status, 404)
})

test('a malformed body is rejected without throwing', async () => {
  const { captured } = harness({ status: () => 1 })
  const { status } = await call(captured.route, { body: 'not json at all' })
  assert.equal(status, 400)
})

test('a method that disagrees with the endpoint is refused', async () => {
  const { captured } = harness({ status: () => 1, balance: () => 2 })
  const { body } = await call(captured.route, {
    url: `${CHANNEL}/status`,
    body: { type: 'client-request', rpcId: 'r1', method: 'balance', payload: null },
  })
  assert.equal(body.result.error.code, 'bad-request')
})

test('the trust fence refuses an untrusted or unauthenticated caller', async () => {
  const { captured } = harness({ status: () => 1 }, { rejection: 401 })
  const { status, body } = await call(captured.route, {
    body: { type: 'client-request', rpcId: 'r1', method: 'status', payload: null },
  })
  assert.equal(status, 401)
  assert.equal(body, 'unauthorized')
})

test('a missing web server degrades instead of throwing', () => {
  const { installed, reports } = harness({ status: () => 1 }, { withWebServer: false })
  assert.equal(installed, null)
  assert.ok(reports.some(([tag]) => tag === 'rpc route unavailable'))
})

test('the default route filter targets DeepSeek official routes only', () => {
  const defaults = Config({})
  assert.equal(defaults.routeFilter, 'deepseek-official')
  assert.equal(defaults.showBalance, false)
  assert.equal('maxHoldMinutes' in defaults, false, 'the hold has no separate cap to configure')
})
