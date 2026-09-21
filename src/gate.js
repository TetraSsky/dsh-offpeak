import { computeState } from './core.js'

const DEEPSEEK_ROUTE = 'deepseek-official'

const matchesRoute = (options, filter) => {
  if (filter !== 'deepseek-official') return true
  const provider = String(options?.provider ?? '').toLowerCase()
  return provider === DEEPSEEK_ROUTE || provider.startsWith('deepseek-')
}

// Last-resort bound for the degenerate case where a window yields no resume instant.
const NO_DEADLINE_FALLBACK_MS = 12 * 60 * 60 * 1000

// Waits until the window ends and nothing else: the schedule already says when to resume.
export const holdDeadline = (state, now) => {
  const known = state.resumeAt !== null && state.resumeAt !== undefined
  if (!known) return { delay: NO_DEADLINE_FALLBACK_MS, reason: 'no-deadline' }
  return { delay: Math.max(1, state.resumeAt - now), reason: 'window-ended' }
}

// Holds calls until the window opens; llm/stream is the waterfall every call passes through.
export const createGate = ({ ctx, getConfig, report = () => {} }) => {
  const waiters = new Set()
  let disposed = false

  const decide = (options, now) => {
    const config = getConfig()
    if (!config.enabled) return { hold: false, reason: 'disabled' }
    if (!matchesRoute(options, config.routeFilter)) return { hold: false, reason: 'route-exempt' }
    const state = computeState(now, config)
    if (state.state !== 'PAUSED') return { hold: false, reason: state.reason }
    return { hold: true, state }
  }

  const releaseAll = (reason) => {
    for (const waiter of [...waiters]) waiter.finish(reason)
  }

  const revalidate = () => {
    const now = Date.now()
    for (const waiter of [...waiters]) {
      const decision = decide(waiter.options, now)
      if (!decision.hold) waiter.finish(decision.reason)
    }
  }

  const waitForRelease = (options, state) =>
    new Promise((resolve) => {
      const { delay, reason } = holdDeadline(state, Date.now())

      let settled = false
      const signal = options?.signal

      const finish = (reason) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (signal?.removeEventListener) signal.removeEventListener('abort', onAbort)
        waiters.delete(waiter)
        resolve(reason)
      }

      const onAbort = () => finish('aborted')
      const waiter = { options, finish }
      waiters.add(waiter)

      const timer = setTimeout(() => finish(reason), delay)

      if (signal) {
        if (signal.aborted) finish('aborted')
        else if (signal.addEventListener) signal.addEventListener('abort', onAbort, { once: true })
      }
    })

  const install = () =>
    ctx.on(
      'llm/stream',
      (options, next) => {
        const decision = decide(options, Date.now())
        if (!decision.hold) return next()

        report('holding request', {
          provider: options?.provider ?? null,
          model: options?.model ?? null,
          until: decision.state.resumeAt ?? null,
        })

        return (async function* held() {
          const reason = await waitForRelease(options, decision.state)
          report('released request', { reason })
          yield* next()
        })()
      },
      { global: true },
    )

  return {
    install,
    revalidate,
    releaseAll,
    get pending() {
      return waiters.size
    },
    dispose() {
      disposed = true
      releaseAll('unload')
    },
    get disposed() {
      return disposed
    },
  }
}
