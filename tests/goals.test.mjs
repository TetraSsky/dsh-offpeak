import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGoalFreezer } from '../src/goals.js'

const workspace = () => mkdtempSync(join(tmpdir(), 'offpeak-goals-'))

// A stand-in for the agents + goals services, one goal per agent.
const makeServices = (initial) => {
  const state = new Map(Object.entries(initial))
  const agents = { list: () => [...state.keys()].map((id) => ({ id })) }

  const goals = {
    get: (agent) => {
      const goal = state.get(agent.id)
      return goal === undefined ? undefined : { id: goal.id, revision: goal.revision, phase: goal.phase }
    },
    pause(agent, ref) {
      const goal = state.get(agent.id)
      if (!goal || goal.id !== ref.id) throw new Error('goal mismatch')
      if (goal.phase !== 'active') throw new Error('not active')
      goal.phase = 'paused'
      goal.revision += 1
    },
    resume(agent, ref) {
      const goal = state.get(agent.id)
      if (!goal) throw new Error('no goal')
      goal.phase = 'active'
      goal.revision += 1
    },
  }

  return { agents, goals, state }
}

const harness = (initial, options = {}) => {
  const services = makeServices(initial)
  const reports = []
  const ctx = {
    get: (name) => (name === 'agents' ? services.agents : name === 'goals' ? services.goals : undefined),
  }
  const freezer = createGoalFreezer({
    ctx,
    report: (tag, value) => reports.push([tag, value]),
    filePath: options.filePath ?? join(workspace(), 'offpeak-paused.json'),
    ...(options.withoutServices ? { ctx: { get: () => undefined } } : {}),
  })
  return { freezer, services, reports }
}

test('an active goal is paused while a window is open', () => {
  const { freezer, services, reports } = harness({ a: { id: 'g1', revision: 3, phase: 'active' } })

  assert.deepEqual(freezer.freeze({ pauseAt: '09:00' }), { frozen: 1 })
  assert.equal(services.state.get('a').phase, 'paused')
  assert.equal(freezer.paused, true)
  assert.ok(reports.some(([tag]) => tag === 'goals paused'))
})

test('a goal the user paused themselves is never touched', () => {
  const { freezer, services } = harness({ a: { id: 'g1', revision: 1, phase: 'paused' } })

  assert.deepEqual(freezer.freeze(null), { frozen: 0 })
  assert.equal(services.state.get('a').phase, 'paused', 'still paused, and not by us')
  assert.equal(freezer.paused, false, 'nothing recorded, so nothing will be resumed')
})

test('a completed goal is not paused', () => {
  const { freezer } = harness({ a: { id: 'g1', revision: 9, phase: 'complete' } })
  assert.deepEqual(freezer.freeze(null), { frozen: 0 })
})

test('only the active goals are paused when several agents exist', () => {
  const { freezer, services } = harness({
    a: { id: 'g1', revision: 1, phase: 'active' },
    b: { id: 'g2', revision: 2, phase: 'complete' },
    c: { id: 'g3', revision: 4, phase: 'active' },
  })

  assert.deepEqual(freezer.freeze(null), { frozen: 2 })
  assert.equal(services.state.get('a').phase, 'paused')
  assert.equal(services.state.get('b').phase, 'complete')
  assert.equal(services.state.get('c').phase, 'paused')
})

test('freezing twice does not re-pause or lose the record', () => {
  const { freezer } = harness({ a: { id: 'g1', revision: 1, phase: 'active' } })

  freezer.freeze(null)
  const second = freezer.freeze(null)
  assert.equal(second.frozen, 0)
  assert.equal(second.already, true)
})

test('unfreezing resumes exactly what was paused', () => {
  const { freezer, services } = harness({
    a: { id: 'g1', revision: 1, phase: 'active' },
    b: { id: 'g2', revision: 5, phase: 'complete' },
  })

  freezer.freeze(null)
  const result = freezer.unfreeze()

  assert.equal(result.resumed, 1)
  assert.equal(services.state.get('a').phase, 'active')
  assert.equal(services.state.get('b').phase, 'complete')
  assert.equal(freezer.paused, false)
})

test('unfreezing with nothing recorded is a no-op', () => {
  const { freezer } = harness({ a: { id: 'g1', revision: 1, phase: 'active' } })
  assert.deepEqual(freezer.unfreeze(), { resumed: 0 })
})

test('a restart resumes only the goals this plugin paused', () => {
  const dir = workspace()
  const file = join(dir, 'offpeak-paused.json')

  const first = harness({ a: { id: 'g1', revision: 1, phase: 'active' } }, { filePath: file })
  first.freezer.freeze({ pauseAt: '09:00' })
  assert.equal(existsSync(file), true)

  // A fresh process: g1 was paused by us, g2 by the user.
  const second = harness(
    {
      a: { id: 'g1', revision: 2, phase: 'paused' },
      b: { id: 'g2', revision: 7, phase: 'paused' },
    },
    { filePath: file },
  )
  const result = second.freezer.reconcile()

  assert.equal(result.resumed, 1)
  assert.equal(second.services.state.get('a').phase, 'active', 'ours is resumed')
  assert.equal(second.services.state.get('b').phase, 'paused', "the user's stays paused")
  assert.equal(existsSync(file), false, 'the record is cleared once reconciled')
})

test('reconcile with no record does nothing', () => {
  const { freezer } = harness({ a: { id: 'g1', revision: 1, phase: 'paused' } })
  assert.deepEqual(freezer.reconcile(), { resumed: 0 })
})

test('the record survives being read back, with the window it was taken for', () => {
  const dir = workspace()
  const file = join(dir, 'offpeak-paused.json')
  const { freezer } = harness({ a: { id: 'g1', revision: 1, phase: 'active' } }, { filePath: file })

  freezer.freeze({ pauseAt: '09:00', resumeAt: '12:00' })
  const stored = JSON.parse(readFileSync(file, 'utf8'))

  assert.equal(stored.version, 1)
  assert.deepEqual(stored.window, { pauseAt: '09:00', resumeAt: '12:00' })
  assert.equal(stored.paused.length, 1)
  assert.equal(stored.paused[0].goalId, 'g1')
})

test('a missing agents/goals service reports instead of throwing', () => {
  const reports = []
  const freezer = createGoalFreezer({
    ctx: { get: () => undefined },
    report: (tag, value) => reports.push([tag, value]),
    filePath: join(workspace(), 'offpeak-paused.json'),
  })

  assert.deepEqual(freezer.freeze(null), { frozen: 0 })
  assert.ok(reports.some(([tag, value]) => tag === 'goal freeze skipped' && value.reason === 'agents/goals services unavailable'))
})

test('one failing pause does not stop the others', () => {
  const services = makeServices({
    a: { id: 'g1', revision: 1, phase: 'active' },
    b: { id: 'g2', revision: 1, phase: 'active' },
  })
  const reports = []
  const original = services.goals.pause
  services.goals.pause = (agent, ref) => {
    if (agent.id === 'a') throw new Error('agent torn down')
    return original(agent, ref)
  }

  const freezer = createGoalFreezer({
    ctx: { get: (name) => (name === 'agents' ? services.agents : services.goals) },
    report: (tag, value) => reports.push([tag, value]),
    filePath: join(workspace(), 'offpeak-paused.json'),
  })

  assert.deepEqual(freezer.freeze(null), { frozen: 1 })
  assert.equal(services.state.get('b').phase, 'paused')
  assert.ok(reports.some(([tag]) => tag === 'goal pause failed'))
})

test('a stale record is cleared even when the goal is already gone', () => {
  const dir = workspace()
  const file = join(dir, 'offpeak-paused.json')
  writeFileSync(file, JSON.stringify({ version: 1, window: null, paused: [{ goalId: 'gone', revision: 1, at: 1 }] }))

  const { freezer } = harness({ a: { id: 'g1', revision: 1, phase: 'paused' } }, { filePath: file })
  assert.deepEqual(freezer.reconcile(), { resumed: 0 })
  assert.equal(existsSync(file), false, 'the stale record does not linger')
})
