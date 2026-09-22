import { createBalanceReader } from './src/balance.js'
import { computeState } from './src/core.js'
import { createGate } from './src/gate.js'
import { createGoalFreezer } from './src/goals.js'
import { createHistory } from './src/history.js'
import { installRpcChannel } from './src/host-rpc.js'
import { createStatusTool } from './src/host-tools.js'
import { Config, NS } from './src/schema.js'
import { spendInWindow } from './src/spend.js'

export const name = 'dsh-offpeak'

const SAMPLE_MS = 5 * 60 * 1000
const FREEZE_TICK_MS = 30 * 1000
const INJECT_CHECK_MS = 5000
const MINUTE = 60 * 1000

export function apply(ctx) {
  ctx.inject(['settings'], (sctx) => {
    const scope = sctx.settings.register(NS, Config)

    const report = (tag, value) => {
      console.log(`[offpeak] ${tag}`, JSON.stringify(value))
    }

    // Read live per decision: a missed change notice must not stale the schedule.
    const gate = createGate({ ctx, getConfig: () => scope.get(), report })

    ctx.effect(() => {
      const off = gate.install()
      return () => {
        off?.()
        gate.dispose()
      }
    })

    const balance = createBalanceReader({ ctx, report })
    const history = createHistory({ report })
    history.load()
    report('history loaded', { samples: history.size, path: history.path })

    // Sampled on the host while enabled, not only while the balance is shown.
    ctx.effect(() => {
      const id = setInterval(() => {
        if (scope.get().enabled !== true) return
        void balance
          .read()
          .then((value) => history.record(value.total, Date.now(), value.currency))
          .catch((error) => report('sample failed', { message: String((error && error.message) || error) }))
      }, SAMPLE_MS)
      return () => clearInterval(id)
    })

    // Freeze goals too: the gate stops the spend, the freeze stops the churn.
    const freezer = createGoalFreezer({ ctx, report })
    freezer.reconcile()

    const syncFreeze = () => {
      const state = computeState(Date.now(), scope.get())
      if (state.state === 'PAUSED') {
        if (!freezer.paused) freezer.freeze(state.window)
      } else if (freezer.paused) {
        freezer.unfreeze()
      }
    }

    ctx.effect(() => {
      const id = setInterval(syncFreeze, FREEZE_TICK_MS)
      syncFreeze()
      return () => {
        clearInterval(id)
        freezer.unfreeze()
      }
    })

    // An inject that never fires would silently drop a feature.
    let toolRegistered = false
    ctx.inject(['tools'], (tctx) => {
      toolRegistered = true
      return tctx.effect(() =>
        tctx.tools.register(createStatusTool({ getConfig: () => scope.get(), getPending: () => gate.pending })),
      )
    })

    // Only webServer is required; connection only supplies its trust fence.
    let rpcRegistered = false
    ctx.inject(['webServer'], (cctx) => {
      const disposer = installRpcChannel({
        ctx: cctx,
        report,
        handlers: {
          status: () => ({
            state: computeState(Date.now(), scope.get()),
            pending: gate.pending,
          }),
          balance: async (_payload, signal) => {
            const value = await balance.read(signal)
            history.record(value.total, Date.now(), value.currency)
            return value
          },
          history: () => {
            const now = Date.now()
            const samples = history.all()
            return {
              now,
              currency: history.currency,
              samples,
              spends: {
                m10: spendInWindow(samples, now, 10 * MINUTE),
                h1: spendInWindow(samples, now, 60 * MINUTE),
                h24: spendInWindow(samples, now, 24 * 60 * MINUTE),
              },
            }
          },
        },
      })
      rpcRegistered = disposer !== null
      return disposer
    })

    setTimeout(() => {
      if (!toolRegistered) console.warn('[offpeak] the tools service never appeared; offpeak_status is unavailable')
      if (!rpcRegistered) console.warn('[offpeak] the web server never appeared; the balance and chart are unavailable')
    }, INJECT_CHECK_MS)

    // Bare watch: the namespace registration already owns the observer.
    scope.watch((next) => {
      report('config changed', next)
      gate.revalidate()
      syncFreeze()
    })

    report('ready', { state: computeState(Date.now(), scope.get()) })
  })
}
