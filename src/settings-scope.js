import { Config, NS } from './schema.js'

const DEFAULTS = Config({})

export function createSettingsScope(ctx, sctx, config) {
  const settings = sctx && sctx.settings
  const hasDescribe = !!settings && typeof settings.describe === 'function'
  const hasRegister = !!settings && typeof settings.register === 'function'

  const findDescriptor = () => {
    try {
      return settings.describe({ redactSecrets: true }).find((d) => d && d.ns === NS)
    } catch {
      return undefined
    }
  }

  // Host that serves the namespace the plugin registered itself.
  if (!hasDescribe && hasRegister) {
    let scope
    try {
      scope = settings.register(NS, Config)
    } catch (err) {
      console.error('[offpeak] settings.register failed: ' + String((err && err.message) || err))
      return { get: () => DEFAULTS, watch: () => {} }
    }
    return {
      get: () => {
        try {
          const value = typeof scope.get === 'function' ? scope.get() : undefined
          return value && typeof value === 'object' ? value : DEFAULTS
        } catch {
          return DEFAULTS
        }
      },
      watch: (cb) => {
        if (typeof scope.watch === 'function') scope.watch(() => cb())
      },
    }
  }

  // Live refs handed to apply, readable before the entry is listed by describe().
  const fromConfig = () => {
    if (!config || typeof config !== 'object') return undefined
    const out = { ...DEFAULTS }
    for (const key of Object.keys(DEFAULTS)) {
      const field = config[key]
      const value = field && typeof field.get === 'function' ? field.get() : field
      if (value !== undefined) out[key] = value
    }
    return out
  }

  const read = () => {
    const live = fromConfig()
    if (live !== undefined) return live
    const descriptor = findDescriptor()
    const value = descriptor && descriptor.value
    if (!value || typeof value !== 'object') return undefined
    return { ...DEFAULTS, ...value }
  }

  // The plugin renders its own settings section, so skip the host generated page.
  if (hasDescribe && typeof settings.configure === 'function' && ctx && ctx.fiber) {
    try {
      const applyPolicy = () => settings.configure({ auto: false }, ctx.fiber)
      if (sctx && typeof sctx.effect === 'function') sctx.effect(applyPolicy)
      else applyPolicy()
    } catch (err) {
      console.error('[offpeak] settings.configure failed: ' + String((err && err.message) || err))
    }
  }

  return {
    get: () => read() ?? DEFAULTS,
    watch: (cb) => {
      // Notifications only shorten the wait, reads are live anyway.
      try {
        ctx.on('loader/volatile-update', () => cb())
        sctx.on('settings/document-updated', (ns) => {
          if (ns === undefined || ns === NS) cb()
        }, { global: true })
      } catch {
        // No event bus on this host.
      }
    },
  }
}
