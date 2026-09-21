import test from 'node:test'
import assert from 'node:assert/strict'
import { formatHHMM, wallClock } from '../src/core.js'
import { createGate, holdDeadline } from '../src/gate.js'

const ZONE = 'Asia/Shanghai'

const baseConfig = (overrides = {}) => ({
  enabled: true,
  scheduleZone: ZONE,
  windows: [],
  activeDays: [],
  warnMinutes: 5,
  routeFilter: 'all',
  ...overrides,
})

const configCoveringNow = (overrides = {}) => {
  const minutes = wallClock(ZONE, new Date()).minutes
  return baseConfig({
    windows: [{ id: 'now', pauseAt: formatHHMM(minutes - 60), resumeAt: formatHHMM(minutes + 60) }],
    ...overrides,
  })
}

const harness = (config) => {
  const captured = {}
  const reports = []
  const ctx = {
    on: (event, handler, options) => {
      captured.event = event
      captured.handler = handler
      captured.options = options
      return () => { captured.disposed = true }
    },
  }
  const gate = createGate({ ctx, getConfig: () => config, report: (tag, value) => reports.push([tag, value]) })
  gate.install()
  return { gate, captured, reports, setConfig: (next) => { Object.assign(config, next) } }
}

const passthrough = () => {
  const state = { called: false }
  const next = async function* () {
    state.called = true
    yield 'chunk'
  }
  return { state, next }
}

const collect = async (iterable) => {
  const chunks = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

// The wrapper generator body is lazy, so a request is only parked once consumed.
const waitForPark = async (gate) => {
  for (let attempt = 0; attempt < 200 && gate.pending === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

test('the gate registers on the mandatory llm/stream waterfall, globally', () => {
  const { captured } = harness(configCoveringNow())
  assert.equal(captured.event, 'llm/stream')
  assert.deepEqual(captured.options, { global: true })
})

test('a disabled schedule never intercepts', async () => {
  const { captured } = harness(baseConfig({ enabled: false }))
  const { state, next } = passthrough()

  const chunks = await collect(captured.handler({ provider: 'deepseek' }, next))
  assert.deepEqual(chunks, ['chunk'])
  assert.equal(state.called, true)
})

test('an exempt route passes through untouched', async () => {
  const { captured } = harness(configCoveringNow({ routeFilter: 'deepseek-official' }))
  const { state, next } = passthrough()

  await collect(captured.handler({ provider: 'opencode-go-v4' }, next))
  assert.equal(state.called, true)
})

test('outside a window the request is not held', async () => {
  const minutes = wallClock(ZONE, new Date()).minutes
  const { captured } = harness(
    baseConfig({ windows: [{ id: 'later', pauseAt: formatHHMM(minutes + 120), resumeAt: formatHHMM(minutes + 180) }] }),
  )
  const { state, next } = passthrough()

  await collect(captured.handler({ provider: 'deepseek' }, next))
  assert.equal(state.called, true)
})

test('a hold runs until the window ends, however long that is', () => {
  const now = Date.now()
  assert.deepEqual(holdDeadline({ resumeAt: now + 4 * 3600000 }, now), {
    delay: 4 * 3600000,
    reason: 'window-ended',
  })
  assert.deepEqual(holdDeadline({ resumeAt: now + 120000 }, now), { delay: 120000, reason: 'window-ended' })
})

test('a window that already ended releases immediately', () => {
  const now = Date.now()
  assert.deepEqual(holdDeadline({ resumeAt: now - 60000 }, now), { delay: 1, reason: 'window-ended' })
})

test('a missing resume instant still gets a bounded fallback', () => {
  const now = Date.now()
  assert.deepEqual(holdDeadline({ resumeAt: null }, now), { delay: 12 * 3600000, reason: 'no-deadline' })
})

test('inside a window the adapter call does not start until the hold is released', async () => {
  const { gate, captured } = harness(configCoveringNow())
  const { state, next } = passthrough()

  const consumed = collect(captured.handler({ provider: 'deepseek' }, next))
  await waitForPark(gate)

  assert.equal(gate.pending, 1)
  assert.equal(state.called, false, 'the adapter call must not start while held')

  gate.releaseAll('window-ended')
  const chunks = await consumed
  assert.deepEqual(chunks, ['chunk'])
  assert.equal(state.called, true)
  assert.equal(gate.pending, 0)
})

test('aborting the request releases it immediately', async () => {
  const { gate, captured } = harness(configCoveringNow())
  const { state, next } = passthrough()
  const controller = new AbortController()

  const consumed = collect(captured.handler({ provider: 'deepseek', signal: controller.signal }, next))
  await waitForPark(gate)
  assert.equal(gate.pending, 1)

  controller.abort()
  await consumed
  assert.equal(state.called, true)
  assert.equal(gate.pending, 0)
})

test('an override releases everything parked', async () => {
  const { gate, captured } = harness(configCoveringNow())
  const { state, next } = passthrough()

  const consumed = collect(captured.handler({ provider: 'deepseek' }, next))
  await waitForPark(gate)
  assert.equal(gate.pending, 1)

  gate.releaseAll('override')
  await consumed
  assert.equal(state.called, true)
})

test('revalidation releases parked requests when the schedule stops holding', async () => {
  const { gate, captured, setConfig } = harness(configCoveringNow())
  const { state, next } = passthrough()

  const consumed = collect(captured.handler({ provider: 'deepseek' }, next))
  await waitForPark(gate)
  assert.equal(gate.pending, 1)

  setConfig({ enabled: false })
  gate.revalidate()

  await consumed
  assert.equal(state.called, true)
})

test('disposal releases parked requests instead of stranding them', async () => {
  const { gate, captured } = harness(configCoveringNow())
  const { state, next } = passthrough()

  const consumed = collect(captured.handler({ provider: 'deepseek' }, next))
  await waitForPark(gate)
  assert.equal(gate.pending, 1)

  gate.dispose()
  await consumed
  assert.equal(state.called, true)
  assert.equal(gate.pending, 0)
})

test('the request object is never mutated, only delayed', async () => {
  const { gate, captured } = harness(configCoveringNow())
  const { next } = passthrough()
  const options = Object.freeze({ provider: 'deepseek', model: 'deepseek-flash' })

  const consumed = collect(captured.handler(options, next))
  await waitForPark(gate)
  gate.releaseAll('window-ended')
  await consumed

  assert.deepEqual(options, { provider: 'deepseek', model: 'deepseek-flash' })
})

test('a held request reports why it was held and why it resumed', async () => {
  const { gate, captured, reports } = harness(configCoveringNow())
  const { next } = passthrough()

  const consumed = collect(captured.handler({ provider: 'deepseek' }, next))
  await waitForPark(gate)
  gate.releaseAll('window-ended')
  await consumed

  assert.ok(reports.some(([tag]) => tag === 'holding request'))
  assert.ok(reports.some(([tag, value]) => tag === 'released request' && value.reason === 'window-ended'))
})
