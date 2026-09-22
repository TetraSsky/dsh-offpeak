import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatHHMM, parseHHMM, wallClock } from '../src/core.js'

const CLIENT = new URL('../client.js', import.meta.url)

const loadBundle = () => {
  let definition
  const win = { __ModuleLoader__: { load: (def) => { definition = def } } }
  new Function('window', 'console', readFileSync(CLIENT, 'utf8'))(win, console)
  return definition
}

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

const fakeRequire = (spec) => {
  if (spec === 'react') return reactStub
  throw new Error(`not available in test: ${spec}`)
}

const findElement = (node, predicate) => {
  if (!node || typeof node !== 'object') return undefined
  if (node.type && predicate(node)) return node
  for (const child of node.children ?? []) {
    const hit = findElement(child, predicate)
    if (hit) return hit
  }
  return undefined
}

const allText = (node) => {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(allText).join('')
  return allText(node.children)
}

const buttonLabels = (node, into = []) => {
  if (!node || typeof node !== 'object') return into
  if (node.type === 'button') into.push(allText(node))
  for (const child of node.children ?? []) buttonLabels(child, into)
  return into
}

// The slot callback returns an element wrapping the function component, so resolve it once.
const renderEntry = (component) => {
  const wrapper = component()
  return typeof wrapper.type === 'function' ? wrapper.type(wrapper.props) : wrapper
}

const harness = (value, localeId = 'en') => {
  const registered = []
  const injected = []
  const bound = []
  const writes = []
  const snapshot = { status: 'ready', value, revision: 1 }
  let active = localeId

  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: async (field, next) => { writes.push([field, next]) },
    mutate: async (ops) => { writes.push(['mutate', ops]) },
  }

  const slots = {
    inject: (name, contribute) => { injected.push(name); contribute() },
    register: (options, component) => { registered.push({ options, component }); return () => {} },
  }

  const locale = { getSnapshot: () => ({ active }), subscribe: () => () => {} }

  const ctx = {
    get: (name) =>
      name === 'slots'
        ? slots
        : name === 'settingsScope'
          ? { bind: (spec) => { bound.push(spec); return scope } }
          : name === 'locale'
            ? locale
            : undefined,
  }

  return {
    ctx,
    registered,
    injected,
    bound,
    writes,
    setLocale: (next) => { active = next },
    overlay: () => registered.find((entry) => entry.options.id === 'offpeak-status'),
  }
}

// The shell projects a section label on every render: a thunk is re-read, a plain
// string keeps whatever the locale was at registration.
const sectionLabel = (entry) =>
  typeof entry.options.label === 'function' ? entry.options.label() : entry.options.label

const idleConfig = {
  enabled: false,
  scheduleZone: 'Asia/Shanghai',
  displayZone: 'schedule',
  windows: [],
  activeDays: [],
  warnMinutes: 5,
  routeFilter: 'all',
  currency: 'auto',
  cnyPerUsd: 0,
}

const configCoveringNow = () => {
  const zone = 'Asia/Shanghai'
  const nowMinutes = wallClock(zone, new Date()).minutes
  return {
    ...idleConfig,
    enabled: true,
    windows: [{ id: 'now', pauseAt: formatHHMM(nowMinutes - 60), resumeAt: formatHHMM(nowMinutes + 60) }],
  }
}

const configWarningSoon = () => {
  const zone = 'Asia/Shanghai'
  const nowMinutes = wallClock(zone, new Date()).minutes
  return {
    ...idleConfig,
    enabled: true,
    warnMinutes: 5,
    windows: [{ id: 'soon', pauseAt: formatHHMM(nowMinutes + 3), resumeAt: formatHHMM(nowMinutes + 60) }],
  }
}

test('the client bundle declares the package id and the services it needs', () => {
  const definition = loadBundle()
  assert.equal(definition.id, 'dsh-offpeak')

  const plugin = definition.factory(fakeRequire)
  // `locale` must be declared: the service is only readable once its providing fiber
  // is active, and reading it too early silently leaves every string in English.
  assert.deepEqual(plugin.inject, ['slots', 'settingsScope', 'locale'])
  assert.equal(typeof plugin.apply, 'function')
})

test('apply contributes the header entry and a settings section', () => {
  const plugin = loadBundle().factory(fakeRequire)
  const { ctx, registered, injected, bound, overlay } = harness(idleConfig)

  plugin.apply(ctx)

  assert.deepEqual(injected, ['conversation.session.header.utilities', 'settings.section'])
  assert.deepEqual(bound, [{ namespace: 'offpeak' }])

  assert.equal(overlay().options.name, 'conversation.session.header.utilities')
  const section = registered.find((entry) => entry.options.id === 'offpeak')
  assert.equal(section.options.name, 'settings.section')
  assert.equal(sectionLabel(section), 'Off-peak')
  assert.equal(typeof section.component, 'function')
})

test('a disabled schedule reads as off and offers Enable', () => {
  const plugin = loadBundle().factory(fakeRequire)
  const { ctx, overlay } = harness(idleConfig)
  plugin.apply(ctx)

  const tree = renderEntry(overlay().component)
  assert.match(allText(tree), /offpeak: off/)
  assert.equal(findElement(tree, (node) => node.type === 'button').children.join(''), 'Enable')
})

test('an active window reads as paused until the resume time', () => {
  const config = configCoveringNow()
  const plugin = loadBundle().factory(fakeRequire)
  const { ctx, overlay } = harness(config)
  plugin.apply(ctx)

  const tree = renderEntry(overlay().component)
  const expected = formatHHMM(parseHHMM(config.windows[0].resumeAt))
  assert.match(allText(tree), new RegExp(`offpeak: paused until ${expected}`))
  assert.equal(findElement(tree, (node) => node.type === 'button').children.join(''), 'Disable')
})

test('a paused window offers Dismiss and nothing else', () => {
  const plugin = loadBundle().factory(fakeRequire)
  const { ctx, overlay } = harness(configCoveringNow())
  plugin.apply(ctx)

  const labels = buttonLabels(renderEntry(overlay().component))
  assert.ok(labels.includes('Dismiss'), `expected a Dismiss action, got ${JSON.stringify(labels)}`)
  assert.equal(labels.includes('Skip this window'), false, 'there is no per-window override')
  assert.equal(labels.includes('Send now'), false, 'there is no per-request override')
})

test('while peak hours are only approaching, Dismiss is the only action', () => {
  const plugin = loadBundle().factory(fakeRequire)
  const { ctx, overlay } = harness(configWarningSoon())
  plugin.apply(ctx)

  const labels = buttonLabels(renderEntry(overlay().component))
  assert.ok(labels.includes('Dismiss'), `expected Dismiss, got ${JSON.stringify(labels)}`)
  assert.equal(labels.includes('Skip this window'), false)
  assert.equal(labels.includes('Send now'), false)
})

test('the notice separates its message from its buttons', () => {
  const plugin = loadBundle().factory(fakeRequire)
  const { ctx, overlay } = harness(configWarningSoon())
  plugin.apply(ctx)

  const chip = findElement(renderEntry(overlay().component), (node) => node.props?.style?.gap === '10px')
  assert.ok(chip, 'the notice chip must define a gap, or the text and buttons render glued together')
  assert.equal(chip.props.style.display, 'inline-flex')
})

test('a disabled schedule shows no banner at all', () => {
  const plugin = loadBundle().factory(fakeRequire)
  const { ctx, overlay } = harness(idleConfig)
  plugin.apply(ctx)

  const labels = buttonLabels(renderEntry(overlay().component))
  assert.equal(labels.includes('Dismiss'), false)
})

test('the header label itself follows the locale, not just the state word', () => {
  // The prefix used to be a hardcoded English "offpeak: ", so a Chinese UI showed
  // Chinese state text behind an English label.
  const chinese = (() => {
    const plugin = loadBundle().factory(fakeRequire)
    const { ctx, overlay } = harness(idleConfig, 'zh')
    plugin.apply(ctx)
    return allText(renderEntry(overlay().component))
  })()
  assert.match(chinese, /低谷时段：已关闭/)
  assert.equal(chinese.includes('offpeak:'), false, 'no English label in the Chinese UI')

  const english = (() => {
    const plugin = loadBundle().factory(fakeRequire)
    const { ctx, overlay } = harness(idleConfig, 'en')
    plugin.apply(ctx)
    return allText(renderEntry(overlay().component))
  })()
  assert.match(english, /offpeak: off/)
})

test('strings follow the active DSH locale', () => {
  const plugin = loadBundle().factory(fakeRequire)
  const { ctx, overlay, registered } = harness(idleConfig, 'zh')
  plugin.apply(ctx)

  assert.equal(sectionLabel(registered.find((entry) => entry.options.id === 'offpeak')), '低谷时段')
  const tree = renderEntry(overlay().component)
  assert.match(allText(tree), /低谷时段：已关闭/)
  assert.equal(findElement(tree, (node) => node.type === 'button').children.join(''), '启用')
})

test('a live language switch reaches the section label and the settings page', () => {
  // The section label is projected by the shell on every render, so it must be a
  // thunk. A string captured at registration showed "Off-peak" in a Chinese UI.
  const plugin = loadBundle().factory(fakeRequire)
  const { ctx, overlay, registered, setLocale } = harness(idleConfig, 'en')
  plugin.apply(ctx)

  const section = registered.find((entry) => entry.options.id === 'offpeak')
  assert.equal(sectionLabel(section), 'Off-peak')

  setLocale('zh')

  assert.equal(sectionLabel(section), '低谷时段', 'the label must be re-read, not frozen at registration')
  assert.match(allText(renderEntry(overlay().component)), /低谷时段：已关闭/)
})

test('the toggle writes the explicit target rather than a negation', async () => {
  const plugin = loadBundle().factory(fakeRequire)
  const { ctx, overlay, writes } = harness(idleConfig)
  plugin.apply(ctx)

  const button = findElement(renderEntry(overlay().component), (node) => node.type === 'button')
  await button.props.onClick()
  assert.deepEqual(writes, [['enabled', true]], 'clicking Enable must write true, never a toggle')
})

test('the status dot sits after the label so it separates label from balance', () => {
  const plugin = loadBundle().factory(fakeRequire)
  const { ctx, overlay } = harness(idleConfig)
  plugin.apply(ctx)

  const tree = renderEntry(overlay().component)
  assert.match(allText(tree.children[0]), /^offpeak: /, 'label comes first')
  assert.equal(allText(tree.children[1]), '', 'the dot carries no text')
  assert.ok(tree.children[1].props.style.background, 'second child is the coloured dot')
})

test('apply degrades instead of throwing when the services are absent', () => {
  const plugin = loadBundle().factory(fakeRequire)
  assert.doesNotThrow(() => plugin.apply({ get: () => undefined }))
})

// The settings section renders through its own component, the same way the header does.
const renderSection = (registered) => {
  const section = registered.find((entry) => entry.options.id === 'offpeak')
  const wrapper = section.component()
  return typeof wrapper.type === 'function' ? wrapper.type(wrapper.props) : wrapper
}

const findSelect = (node, value) => {
  if (!node || typeof node !== 'object') return undefined
  if (node.type === 'select' && node.props?.value === value) return node
  for (const child of node.children ?? []) {
    const hit = findSelect(child, value)
    if (hit) return hit
  }
  return undefined
}

test('the currency setting is offered, defaulting to the API currency', () => {
  const plugin = loadBundle().factory(fakeRequire)
  const { ctx, registered } = harness(idleConfig)
  plugin.apply(ctx)

  const select = findSelect(renderSection(registered), 'auto')
  assert.ok(select, 'the balance currency picker must be present')
  assert.deepEqual(
    select.children.map((option) => option.props.value),
    ['auto', 'CNY', 'USD'],
  )
  assert.equal(findSelect(renderSection(registered), undefined) === undefined, true, 'no rate field while following the API')
})

test('forcing a currency reveals the rate field, which is saved with the rest', async () => {
  const plugin = loadBundle().factory(fakeRequire)
  const { ctx, registered, writes } = harness({ ...idleConfig, currency: 'CNY' })
  plugin.apply(ctx)

  const tree = renderSection(registered)
  const rate = findElement(tree, (node) => node.type === 'input' && node.props?.step === 0.01)
  assert.ok(rate, 'a rate field must appear once a currency is forced')
  assert.equal(rate.props.value, 0)

  const save = findElement(tree, (node) => node.type === 'button' && allText(node) === 'Save')
  await save.props.onClick()
  const ops = writes.find(([field]) => field === 'mutate')[1]
  assert.deepEqual(ops.filter((op) => op.path[0] === 'currency' || op.path[0] === 'cnyPerUsd'), [
    { op: 'set', path: ['currency'], value: 'CNY' },
    { op: 'set', path: ['cnyPerUsd'], value: 0 },
  ])
})
