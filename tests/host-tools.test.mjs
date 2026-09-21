import test from 'node:test'
import assert from 'node:assert/strict'
import { createStatusTool } from '../src/host-tools.js'

const ZONE = 'Asia/Shanghai'

const baseConfig = (overrides = {}) => ({
  enabled: true,
  scheduleZone: ZONE,
  windows: [{ pauseAt: '09:00', resumeAt: '12:00', days: [1, 2, 3, 4, 5] }],
  activeDays: [],
  warnMinutes: 5,
  ...overrides,
})

const toolFor = (config, pending = 0) =>
  createStatusTool({ getConfig: () => config, getPending: () => pending })

const renderText = (tool, value) => tool.output.render([], value)[0].text

test('the tool is named and described as read-only', () => {
  const tool = toolFor(baseConfig())
  assert.equal(tool.name, 'offpeak_status')
  assert.match(tool.description, /read-only/i)
})

test('the tool takes no arguments, so it cannot be used to change anything', () => {
  const tool = toolFor(baseConfig())
  assert.equal(tool.parameters.type, 'object')
  assert.deepEqual(tool.parameters.properties, {}, 'no input the model could set')
})

test('the snapshot reports the schedule and the state', async () => {
  const tool = toolFor(baseConfig())
  const value = await tool.execute({}, {})

  assert.equal(value.enabled, true)
  assert.equal(value.scheduleZone, ZONE)
  assert.deepEqual(value.windows, [{ pauseAt: '09:00', resumeAt: '12:00', days: [1, 2, 3, 4, 5] }])
  assert.equal(['NORMAL', 'WARN', 'PAUSED'].includes(value.state), true)
  assert.equal(value.heldRequests, 0)
})

test('the snapshot reports how many requests are waiting', async () => {
  const tool = toolFor(baseConfig(), 3)
  assert.equal((await tool.execute({}, {})).heldRequests, 3)
})

test('a disabled schedule says so plainly', async () => {
  const tool = toolFor(baseConfig({ enabled: false }))
  const value = await tool.execute({}, {})

  assert.equal(value.enabled, false)
  assert.match(renderText(tool, value), /disabled/)
})

test('the rendered report names the schedule zone and the windows', async () => {
  const tool = toolFor(baseConfig())
  const text = renderText(tool, await tool.execute({}, {}))

  assert.match(text, /09:00-12:00/)
  assert.match(text, new RegExp(ZONE))
  assert.match(text, /read-only/i)
})

test('a paused schedule tells the model when calls resume', async () => {
  // A window that certainly covers the current instant in the schedule zone.
  const now = new Date()
  const zoneMinutes = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour12: false, hour: '2-digit', minute: '2-digit' })
      .format(now)
      .replace(':', ''),
  )
  const pad = (minutes) => String(minutes).padStart(4, '0').replace(/(\d{2})(\d{2})/, '$1:$2')
  const config = baseConfig({
    windows: [{ pauseAt: pad((zoneMinutes + 2300) % 2400), resumeAt: pad((zoneMinutes + 100) % 2400), days: [] }],
  })

  const tool = toolFor(config, 2)
  const value = await tool.execute({}, {})
  assert.equal(value.state, 'PAUSED', 'the constructed window should cover now')
  assert.equal(typeof value.resumesAt, 'string')

  const text = renderText(tool, value)
  assert.match(text, /being held/)
  assert.match(text, /2 request/)
})

test('an empty schedule is reported as none configured', async () => {
  const tool = toolFor(baseConfig({ windows: [] }))
  const text = renderText(tool, await tool.execute({}, {}))
  assert.match(text, /none configured/)
})
