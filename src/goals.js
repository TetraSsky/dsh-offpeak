import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

const ACTIVE = 'active'
const PAUSED = 'paused'

export const PAUSE_FILE = 'offpeak-paused.json'

// Pauses the active goals while a window is open, so the wait is visible and the goal stops churning.
export const createGoalFreezer = ({ ctx, report = () => {}, filePath = dshHomePath(PAUSE_FILE) } = {}) => {
  let record = null

  const services = () => ({ agents: ctx.get('agents'), goals: ctx.get('goals') })

  const persist = () => {
    try {
      if (record === null) {
        try {
          unlinkSync(filePath)
        } catch {
          // already gone
        }
        return
      }
      mkdirSync(dirname(filePath), { recursive: true })
      const temporary = `${filePath}.tmp`
      writeFileSync(temporary, JSON.stringify({ version: 1, ...record }, null, 2))
      renameSync(temporary, filePath)
    } catch (error) {
      report('pause record persist failed', { message: String((error && error.message) || error) })
    }
  }

  // Every live agent whose current goal is active.
  const activeGoals = () => {
    const { agents, goals } = services()
    if (!agents || !goals) return null
    const found = []
    for (const agent of agents.list()) {
      let goal
      try {
        goal = goals.get(agent)
      } catch {
        continue // not the registry's live instance for that agent
      }
      if (goal && goal.phase === ACTIVE) found.push({ agent, goalId: goal.id, revision: goal.revision })
    }
    return found
  }

  const freeze = (window) => {
    if (record !== null) return { frozen: 0, already: true }

    const targets = activeGoals()
    if (targets === null) {
      report('goal freeze skipped', { reason: 'agents/goals services unavailable' })
      return { frozen: 0 }
    }
    if (targets.length === 0) {
      report('goal freeze skipped', { reason: 'no active goal' })
      return { frozen: 0 }
    }

    const { goals } = services()
    const paused = []
    for (const target of targets) {
      try {
        goals.pause(target.agent, { id: target.goalId, revision: target.revision })
        paused.push({ goalId: target.goalId, revision: target.revision, at: Date.now() })
      } catch (error) {
        report('goal pause failed', { goalId: target.goalId, message: String((error && error.message) || error) })
      }
    }

    if (paused.length === 0) return { frozen: 0 }
    record = { window: window ?? null, paused }
    persist()
    report('goals paused', { count: paused.length, window: record.window })
    return { frozen: paused.length }
  }

  // Resume one goal by identity, whatever agent currently owns it.
  const resumeByGoalId = (goalId, revision) => {
    const { agents, goals } = services()
    if (!agents || !goals) return false
    for (const agent of agents.list()) {
      let goal
      try {
        goal = goals.get(agent)
      } catch {
        continue
      }
      if (goal && goal.id === goalId && goal.phase === PAUSED) {
        goals.resume(agent, { id: goalId, revision: goal.revision })
        return true
      }
    }
    return false
  }

  const unfreeze = () => {
    if (record === null) return { resumed: 0 }

    const pending = record.paused
    record = null
    persist()

    let resumed = 0
    const failed = []
    for (const entry of pending) {
      try {
        if (resumeByGoalId(entry.goalId, entry.revision)) resumed += 1
      } catch (error) {
        failed.push(entry.goalId)
        report('goal resume failed', { goalId: entry.goalId, message: String((error && error.message) || error) })
      }
    }
    report('goals resumed', { resumed, failed: failed.length })
    return { resumed, failed }
  }

  return {
    freeze,
    unfreeze,
    // Resume goals this plugin paused in a previous process.
    reconcile() {
      let stored
      try {
        stored = JSON.parse(readFileSync(filePath, 'utf8'))
      } catch {
        return { resumed: 0 }
      }
      if (!Array.isArray(stored?.paused) || stored.paused.length === 0) return { resumed: 0 }

      let resumed = 0
      for (const entry of stored.paused) {
        try {
          if (resumeByGoalId(entry.goalId, entry.revision)) resumed += 1
        } catch (error) {
          report('goal reconcile failed', { goalId: entry.goalId, message: String((error && error.message) || error) })
        }
      }
      try {
        unlinkSync(filePath)
      } catch {
        // already gone
      }
      report('reconciled goals paused by a previous run', { resumed })
      return { resumed }
    },
    get paused() {
      return record !== null
    },
    get record() {
      return record
    },
  }
}
