import React from 'react'
import {
  DEEPSEEK_PEAK_PRESET,
  SCHEDULE_ZONE_CHOICES,
  computeState,
  convertHHMM,
  formatHHMM,
  formatOffset,
  isValidZone,
  observesDST,
  parseHHMM,
  presetWindowsFor,
  utcOffsetMinutes,
  wallClock,
  wallToInstant,
} from './core.js'
import { fallbackLocale, translate } from './i18n.js'
import { conversionRate, formatMoney } from './money.js'
import { BUCKET_MS, WINDOW_BUCKETS, bucketLabel, spendBars, windowRangeLabel } from './spend.js'

const NS = 'offpeak'
const h = React.createElement

const WEEKDAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']


const TONE = {
  disabled: 'var(--dsw-alias-label-tertiary)',
  idle: 'var(--dsw-alias-state-success-primary)',
  warn: 'var(--dsw-alias-state-warn-primary)',
  paused: 'var(--dsw-alias-state-error-primary)',
}

const toneFor = (state) => {
  if (state.state === 'PAUSED') return TONE.paused
  if (state.state === 'WARN') return TONE.warn
  if (state.reason === 'disabled' || state.reason === 'bad-zone') return TONE.disabled
  return TONE.idle
}

const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// Projects a schedule wall-clock time into the viewer's zone, for the "your time" annotation.
const localTimeFor = (scheduleZone, hhmm, viewerZone) => {
  const minutes = parseHHMM(hhmm)
  if (minutes === null || !isValidZone(scheduleZone) || !isValidZone(viewerZone)) return ''
  const wall = wallClock(scheduleZone, new Date())
  const instant = wallToInstant(scheduleZone, wall.y, wall.mo, wall.d, minutes)
  if (instant === null) return ''
  return formatHHMM(wallClock(viewerZone, new Date(instant)).minutes)
}

const formatBalance = (balance, money) =>
  balance && balance.total !== null && balance.total !== undefined ? money(balance.total) : ''

const describe = (state, config, t) => {
  if (state.state === 'PAUSED') {
    const resume =
      state.resumeAt === null || state.resumeAt === undefined
        ? null
        : wallClock(config.scheduleZone, new Date(state.resumeAt)).minutes
    return t('statusPaused', { time: resume === null ? '?' : formatHHMM(resume) })
  }
  if (state.state === 'WARN') return t('statusWarn', { minutes: state.minutesUntil })
  if (state.reason === 'disabled') return t('statusDisabled')
  if (state.reason === 'weekday-off') return t('statusOffPeakDay')
  return t('statusWaiting')
}

// Before the settings scope resolves there is no state to describe, only the scope's own
// status word, which arrives in English from the settings transport.
const describeAvailability = (status, t) => {
  if (status === 'loading') return t('statusLoading')
  if (status === 'unavailable') return t('statusUnavailable')
  return status
}

const useScope = (scope) =>
  React.useSyncExternalStore(
    (onChange) => scope.subscribe(onChange),
    () => scope.getSnapshot(),
  )

const useNow = (intervalMs) => {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

const useLocaleId = (locale) => {
  const subscribe = React.useCallback(
    (onChange) => (locale && locale.subscribe ? locale.subscribe(onChange) : () => {}),
    [locale],
  )
  const read = React.useCallback(() => {
    try {
      return locale?.getSnapshot?.().active ?? fallbackLocale
    } catch {
      return fallbackLocale
    }
  }, [locale])
  return React.useSyncExternalStore(subscribe, read)
}

const currentLocaleId = (locale) => {
  try {
    return locale?.getSnapshot?.().active ?? fallbackLocale
  } catch {
    return fallbackLocale
  }
}

const styles = {
  // Inline in the conversation header, never fixed, so it cannot mask other chrome.
  entry: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  chart: {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: 0,
    zIndex: 70,
    width: '340px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px',
    borderRadius: '10px',
    background: 'var(--dsw-alias-bg-layer-3)',
    border: '1px solid var(--dsw-alias-border-l2)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
  },
  chartHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
  bars: { display: 'flex', alignItems: 'flex-end', gap: '2px', height: '90px' },
  emptyChart: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '90px',
    borderRadius: '8px',
    border: '1px dashed var(--dsw-alias-border-l2)',
    color: 'var(--dsw-alias-label-tertiary)',
    fontSize: '12px',
  },
  bar: { flex: '1 1 0', minHeight: '2px', borderRadius: '2px 2px 0 0' },
  spends: { display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '12px' },
  balanceWrap: { position: 'relative', display: 'inline-flex' },
  balance: {
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    color: 'var(--dsw-alias-label-primary)',
    // Inherit so the figure matches the header text instead of reading as a small link.
    font: 'inherit',
    padding: 0,
  },
  bubble: {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: 0,
    zIndex: 70,
    width: '270px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px 12px',
    borderRadius: '10px',
    fontSize: '12px',
    background: 'var(--dsw-alias-bg-layer-3)',
    color: 'var(--dsw-alias-label-primary)',
    border: '1px solid var(--dsw-alias-border-l2)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
    pointerEvents: 'none',
  },
  pill: {
    pointerEvents: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    borderRadius: '999px',
    fontSize: '12px',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-primary)',
    border: '1px solid var(--dsw-alias-border-l1)',
  },
  banner: {
    pointerEvents: 'auto',
    maxWidth: '420px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '10px 14px',
    borderRadius: '10px',
    fontSize: '12px',
    background: 'var(--dsw-alias-bg-layer-3)',
    color: 'var(--dsw-alias-label-primary)',
    border: '1px solid var(--dsw-alias-border-l2)',
  },
  bannerActions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  chip: {
    pointerEvents: 'auto',
    // Flex with a gap: as plain inline content the message and its buttons touch.
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    padding: '4px 12px',
    borderRadius: '999px',
    fontSize: '12px',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-secondary)',
    border: '1px solid var(--dsw-alias-border-l1)',
  },
  button: {
    cursor: 'pointer',
    fontSize: '12px',
    padding: '3px 10px',
    borderRadius: '6px',
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-primary)',
  },
  primaryButton: {
    cursor: 'pointer',
    fontSize: '12px',
    padding: '3px 10px',
    borderRadius: '6px',
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-button-primary-fill)',
    color: 'var(--dsw-alias-label-primary-foreground)',
  },
  error: { color: 'var(--dsw-alias-state-error-primary)' },
  dot: { width: '8px', height: '8px', borderRadius: '50%', flex: '0 0 auto' },
  page: { display: 'flex', flexDirection: 'column', gap: '18px', padding: '4px 2px', fontSize: '13px' },
  section: { display: 'flex', flexDirection: 'column', gap: '10px' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' },
  label: { color: 'var(--dsw-alias-label-primary)' },
  hint: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', marginTop: '2px' },
  control: {
    fontSize: '12px',
    padding: '4px 8px',
    borderRadius: '6px',
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-primary)',
  },
  windowCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid var(--dsw-alias-border-l1)',
    background: 'var(--dsw-alias-bg-layer-2)',
  },
  windowHead: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
  warnRow: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
  spacer: { flex: '1 1 auto' },
  days: { display: 'flex', gap: '4px', flexWrap: 'wrap' },
  dayToggle: (active) => ({
    cursor: 'pointer',
    fontSize: '11px',
    padding: '2px 7px',
    borderRadius: '5px',
    border: `1px solid ${active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
    background: active ? 'var(--dsw-alias-brand-primary)' : 'transparent',
    color: active ? 'var(--dsw-alias-label-primary-foreground)' : 'var(--dsw-alias-label-secondary)',
  }),
  divider: { height: '1px', background: 'var(--dsw-alias-border-l1)' },
}

function Switch({ checked, onChange, disabled }) {
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': checked,
      disabled,
      onClick: () => onChange(!checked),
      style: {
        width: '38px',
        height: '22px',
        padding: '2px',
        borderRadius: '999px',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: checked ? 'flex-end' : 'flex-start',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: checked ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-3)',
        transition: 'background 120ms ease',
      },
    },
    h('span', {
      style: {
        width: '16px',
        height: '16px',
        borderRadius: '50%',
        background: checked ? 'var(--dsw-alias-label-primary-foreground)' : 'var(--dsw-alias-label-tertiary)',
        transition: 'background 120ms ease',
      },
    }),
  )
}

function Row({ label, hint, children }) {
  return h(
    'div',
    { style: styles.row },
    h('div', null, h('div', { style: styles.label }, label), hint ? h('div', { style: styles.hint }, hint) : null),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, children),
  )
}

function DayPicker({ value, onChange, t }) {
  return h(
    'div',
    { style: styles.days },
    WEEKDAY_KEYS.map((key, index) => {
      const day = index + 1
      const active = (value ?? []).includes(day)
      return h(
        'button',
        {
          key,
          type: 'button',
          style: styles.dayToggle(active),
          onClick: () => onChange(active ? value.filter((entry) => entry !== day) : [...(value ?? []), day].sort()),
        },
        t(key),
      )
    }),
  )
}

// Remembered for the page rather than for the component: the header entry remounts every
// time the slot switches session, and a notice the user dismissed must not come back with
// it. A reload drops it on purpose, so a freshly loaded page warns again.
let dismissedOccurrence = null

// Remembered for the page for the same reason: the balance and the chart arrive from
// asynchronous reads, so a rebuilt entry must start from the last figures instead of
// painting a header without them and adding the number a frame later.
const remembered = { balance: null, balanceError: '', chart: null }

function HeaderEntry({ scope, locale, connection }) {
  const snapshot = useScope(scope)
  const localeId = useLocaleId(locale)
  const t = (key, vars) => translate(localeId, key, vars)
  const now = useNow(1000)

  const [dismissedFor, setDismissedFor] = React.useState(dismissedOccurrence)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [balance, setBalance] = React.useState(remembered.balance)
  const [balanceError, setBalanceError] = React.useState(remembered.balanceError)
  const [chartOpen, setChartOpen] = React.useState(false)
  const [chartData, setChartData] = React.useState(remembered.chart)
  const [hoveringBalance, setHoveringBalance] = React.useState(false)

  const config = snapshot.value
  const ready = snapshot.status === 'ready' && config !== undefined
  const state = ready ? computeState(now, config) : { state: snapshot.status, reason: snapshot.status }

  const showBalance = ready && config.showBalance === true && connection !== undefined

  // The history carries its own currency, so amounts stay labelled when the balance
  // endpoint is unavailable. A forced currency relabels; only a rate converts.
  const apiCurrency = chartData?.currency ?? balance?.currency ?? null
  const displayCurrency = ready && config.currency !== undefined && config.currency !== 'auto' ? config.currency : apiCurrency
  const rate = conversionRate(apiCurrency, displayCurrency, ready ? config.cnyPerUsd : 0)
  const money = (value) => formatMoney(value * rate, displayCurrency)

  // Written through to the page-scoped copy as well, so the next mount starts from it.
  const rememberBalance = (value, message) => {
    remembered.balance = value
    remembered.balanceError = message
    setBalance(value)
    setBalanceError(message)
  }

  // Polled whenever the balance is on screen, not only when the chart is open: the hover breakdown needs the same series.
  React.useEffect(() => {
    if ((!showBalance && !chartOpen) || connection === undefined) return undefined
    let cancelled = false
    const load = async () => {
      try {
        const result = await connection.rpc.call('/offpeak', 'history', null)
        if (!cancelled && result.ok) {
          remembered.chart = result.value
          setChartData(result.value)
        }
      } catch {
        // keep the previous series rather than blanking the view
      }
    }
    void load()
    const id = setInterval(load, 60000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [showBalance, chartOpen, connection])

  React.useEffect(() => {
    if (!showBalance) {
      rememberBalance(null, '')
      return undefined
    }
    let cancelled = false
    const load = async () => {
      try {
        const result = await connection.rpc.call('/offpeak', 'balance', null)
        if (cancelled) return
        if (result.ok) {
          rememberBalance(result.value, '')
        } else {
          rememberBalance(null, result.error.message)
        }
      } catch (cause) {
        if (!cancelled) rememberBalance(remembered.balance, String((cause && cause.message) || cause))
      }
    }
    void load()
    const id = setInterval(load, 300000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [showBalance, connection])

  const bannerWorthy = ready && (state.state === 'PAUSED' || state.state === 'WARN')
  const showBanner = bannerWorthy && dismissedFor !== state.occurrenceId

  const run = async (action) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(String((cause && cause.message) || cause))
    } finally {
      setBusy(false)
    }
  }

  if (ready && config.showStatus === false) return null

  const bars = chartData ? spendBars(chartData.samples, chartData.now, WINDOW_BUCKETS, BUCKET_MS) : null
  const peak = bars ? Math.max(...bars.map((value) => value ?? 0), 0.000001) : 1

  return h(
    'div',
    { style: styles.entry },
    h('span', null, t('statusLine', { status: ready ? describe(state, config, t) : describeAvailability(snapshot.status, t) })),
    // Trailing, so it separates the label from the balance instead of running them together.
    h('span', { style: { ...styles.dot, background: ready ? toneFor(state) : TONE.disabled } }),
    showBalance
      ? balance !== null
        ? h(
            'span',
            { style: styles.balanceWrap },
            h(
              'button',
              {
                type: 'button',
                style: styles.balance,
                onClick: () => setChartOpen((open) => !open),
                onMouseEnter: () => setHoveringBalance(true),
                onMouseLeave: () => setHoveringBalance(false),
              },
              formatBalance(balance, money),
            ),
            hoveringBalance && !chartOpen
              ? h(
                  'div',
                  { style: styles.bubble },
                  h(
                    'div',
                    null,
                    `${formatBalance(balance, money)} ${t('balance')}`,
                    balance.granted !== null || balance.toppedUp !== null
                      ? ` (${t('granted')} ${money(balance.granted)} · ${t('toppedUp')} ${money(balance.toppedUp)})`
                      : '',
                  ),
                  chartData
                    ? h(
                        'div',
                        { style: styles.spends },
                        h(
                          'span',
                          null,
                          `${t('spent10m')} ${money(chartData.spends.m10)} ${windowRangeLabel(chartData.now, 10 * 60 * 1000)}`,
                        ),
                        h(
                          'span',
                          null,
                          `${t('spent1h')} ${money(chartData.spends.h1)} ${windowRangeLabel(chartData.now, 60 * 60 * 1000)}`,
                        ),
                        h('span', null, `${t('spent24h')} ${money(chartData.spends.h24)}`),
                      )
                    : null,
                  h('div', { style: styles.hint }, t('chartNote')),
                )
              : null,
          )
        : balanceError !== ''
          ? h('span', { style: styles.error }, balanceError)
          : null
      : null,
    ready
      ? h(
          'button',
          {
            type: 'button',
            style: styles.button,
            disabled: busy,
            onClick: () => run(() => scope.set('enabled', !config.enabled)),
          },
          config.enabled ? t('disableAction') : t('enableAction'),
        )
      : null,
    showBanner
      ? h(
          'span',
          { style: styles.chip },
          state.state === 'PAUSED'
            ? t('bannerPaused', {
                time: state.resumeAt
                  ? formatHHMM(wallClock(config.scheduleZone, new Date(state.resumeAt)).minutes)
                  : '?',
              })
            : t('bannerWarn', { minutes: state.minutesUntil }),
          h(
            'button',
            {
              type: 'button',
              style: styles.button,
              onClick: () => {
                dismissedOccurrence = state.occurrenceId
                setDismissedFor(state.occurrenceId)
              },
            },
            t('dismiss'),
          ),
        )
      : null,
    error ? h('span', { style: styles.error }, error) : null,
    chartOpen && bars
      ? h(
          'div',
          { style: styles.chart },
          h(
            'div',
            { style: styles.chartHead },
            h('span', { style: styles.label }, t('chartTitle')),
            h('button', { type: 'button', style: styles.button, onClick: () => setChartOpen(false) }, '×'),
          ),
          bars.some((value) => value !== null)
            ? h(
                'div',
                { style: styles.bars },
                bars.map((value, index) =>
                  h('div', {
                    key: index,
                    title: `${bucketLabel(index, chartData.now, WINDOW_BUCKETS, BUCKET_MS)} · ${
                      value === null ? t('chartNoData') : money(value)
                    }`,
                    style: {
                      ...styles.bar,
                      height: `${Math.max(2, ((value ?? 0) / peak) * 100)}%`,
                      background: value === null ? 'var(--dsw-alias-border-l1)' : 'var(--dsw-alias-state-error-primary)',
                    },
                  }),
                ),
              )
            : h('div', { style: styles.emptyChart }, t('chartCollecting')),
          h(
            'div',
            { style: styles.spends },
            h('span', null, `${t('spent10m')} ${money(chartData.spends.m10)}`),
            h('span', null, `${t('spent1h')} ${money(chartData.spends.h1)}`),
            h('span', null, `${t('spent24h')} ${money(chartData.spends.h24)}`),
          ),
          h('div', { style: styles.hint }, t('chartNote')),
        )
      : null,
  )
}

const toDraft = (config) => ({
  windows: (config.windows ?? []).map((window) => ({ ...window })),
  scheduleZone: config.scheduleZone,
  displayZone: config.displayZone ?? 'schedule',
  activeDays: [...(config.activeDays ?? [])],
  warnMinutes: config.warnMinutes,
  routeFilter: config.routeFilter,
  currency: config.currency ?? 'auto',
  cnyPerUsd: config.cnyPerUsd ?? 0,
})

function SettingsPage({ scope, locale }) {
  const snapshot = useScope(scope)
  const localeId = useLocaleId(locale)
  const t = (key, vars) => translate(localeId, key, vars)
  const browser = React.useMemo(browserZone, [])

  const config = snapshot.value
  // Seeded from the config already in hand, so the page paints on the first render
  // instead of flashing the placeholder until the effect runs.
  const [draft, setDraft] = React.useState(() => (config ? toDraft(config) : null))
  const [dirty, setDirty] = React.useState(false)
  const [message, setMessage] = React.useState(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!config || dirty) return
    setDraft(toDraft(config))
  }, [config, dirty])

  if (snapshot.status !== 'ready' || !config || !draft) {
    return h(
      'div',
      { style: styles.page },
      h('div', { style: styles.hint }, t('statusLine', { status: describeAvailability(snapshot.status, t) })),
    )
  }

  const patch = (changes) => {
    setDraft((current) => ({ ...current, ...changes }))
    setDirty(true)
    setMessage(null)
  }

  const viewerZone = draft.displayZone === 'browser' ? browser : draft.scheduleZone

  const writeImmediately = async (field, value) => {
    setMessage(null)
    try {
      await scope.set(field, value)
    } catch (cause) {
      setMessage({ kind: 'error', text: `${t('saveFailed')}: ${String((cause && cause.message) || cause)}` })
    }
  }

  const save = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await scope.mutate([
        { op: 'set', path: ['windows'], value: draft.windows },
        { op: 'set', path: ['scheduleZone'], value: draft.scheduleZone },
        { op: 'set', path: ['displayZone'], value: draft.displayZone },
        { op: 'set', path: ['activeDays'], value: draft.activeDays },
        { op: 'set', path: ['warnMinutes'], value: Number(draft.warnMinutes) },
        { op: 'set', path: ['routeFilter'], value: draft.routeFilter },
        { op: 'set', path: ['currency'], value: draft.currency },
        { op: 'set', path: ['cnyPerUsd'], value: Number(draft.cnyPerUsd) },
      ])
      setDirty(false)
      setMessage({ kind: 'ok', text: t('saved') })
    } catch (cause) {
      setMessage({ kind: 'error', text: `${t('saveFailed')}: ${String((cause && cause.message) || cause)}` })
    } finally {
      setBusy(false)
    }
  }

  const addWindow = () =>
    patch({
      windows: [
        ...draft.windows,
        { id: `w${Date.now().toString(36)}`, pauseAt: '09:00', resumeAt: '12:00', days: [...draft.activeDays] },
      ],
    })

  const updateWindow = (index, changes) =>
    patch({ windows: draft.windows.map((window, at) => (at === index ? { ...window, ...changes } : window)) })

  const removeWindow = (index) => patch({ windows: draft.windows.filter((_, at) => at !== index) })

  // Adds the peak windows in the zone the user chose, without rewriting that choice.
  const applyPreset = () => {
    const target = draft.scheduleZone
    const incoming = presetWindowsFor(target)
    const key = (window) => `${window.pauseAt}|${window.resumeAt}`
    const existing = new Set(draft.windows.map(key))
    const added = incoming.filter((window) => !existing.has(key(window)))

    patch({ windows: [...draft.windows, ...added] })
    setMessage({
      kind: 'ok',
      text: added.length > 0 ? t('presetAdded', { count: added.length, zone: target }) : t('presetExists'),
    })
  }

  const pinToPricingZone = () =>
    patch({
      scheduleZone: DEEPSEEK_PEAK_PRESET.zone,
      windows: draft.windows.map((window) => ({
        ...window,
        pauseAt: convertHHMM(draft.scheduleZone, DEEPSEEK_PEAK_PRESET.zone, window.pauseAt),
        resumeAt: convertHHMM(draft.scheduleZone, DEEPSEEK_PEAK_PRESET.zone, window.resumeAt),
      })),
    })

  const zoneOptions = [...new Set([draft.scheduleZone, browser, ...SCHEDULE_ZONE_CHOICES])]
    .filter(isValidZone)
    .map((zone) => ({ zone, offset: utcOffsetMinutes(zone, Date.now()) }))
    .sort((left, right) => left.offset - right.offset || left.zone.localeCompare(right.zone))

  const windowRows = draft.windows.length
    ? draft.windows.map((window, index) => {
        const localFrom = localTimeFor(draft.scheduleZone, window.pauseAt, viewerZone)
        const localTo = localTimeFor(draft.scheduleZone, window.resumeAt, viewerZone)
        return h(
          'div',
          { key: window.id ?? index, style: styles.windowCard },
          h(
            'div',
            { style: styles.windowHead },
            h('span', { style: styles.label }, `${window.pauseAt} - ${window.resumeAt}`),
            localFrom && localTo && viewerZone !== draft.scheduleZone
              ? h('span', { style: styles.hint }, `${localFrom} - ${localTo} ${t('localTime')}`)
              : null,
            h('span', { style: styles.spacer }),
            h('button', { type: 'button', style: styles.button, onClick: () => removeWindow(index) }, t('remove')),
          ),
          h(
            'div',
            { style: styles.windowHead },
            h('span', { style: styles.hint }, t('pauseAt')),
            h('input', {
              type: 'time',
              style: styles.control,
              value: window.pauseAt,
              onChange: (event) => updateWindow(index, { pauseAt: event.target.value }),
            }),
            h('span', { style: styles.hint }, t('resumeAt')),
            h('input', {
              type: 'time',
              style: styles.control,
              value: window.resumeAt,
              onChange: (event) => updateWindow(index, { resumeAt: event.target.value }),
            }),
          ),
          h(
            'div',
            { style: styles.windowHead },
            h('span', { style: styles.hint }, t('days')),
            h(DayPicker, { value: window.days, onChange: (days) => updateWindow(index, { days }), t }),
          ),
        )
      })
    : h('div', { style: styles.hint }, t('windowsEmpty'))

  return h(
    'div',
    { style: styles.page },
    h(
      'div',
      null,
      h('div', { style: { fontSize: '15px', fontWeight: 600 } }, t('title')),
      h('div', { style: styles.hint }, t('subtitle')),
    ),
    h(
      Row,
      { label: t('enable') },
      h(Switch, { checked: config.enabled, onChange: (value) => writeImmediately('enabled', value) }),
    ),
    h('div', { style: styles.divider }),
    h(
      'div',
      { style: styles.section },
      h(
        Row,
        {
          label: t('scheduleZone'),
          hint: draft.scheduleZone === DEEPSEEK_PEAK_PRESET.zone ? t('scheduleZonePinned') : t('scheduleZoneHint'),
        },
        h(
          'select',
          { style: styles.control, value: draft.scheduleZone, onChange: (event) => patch({ scheduleZone: event.target.value }) },
          zoneOptions.map((entry) =>
            h('option', { key: entry.zone, value: entry.zone }, `${entry.zone} (${formatOffset(entry.offset)})`),
          ),
        ),
      ),
      observesDST(draft.scheduleZone)
        ? h(
            'div',
            { style: styles.warnRow },
            h('span', { style: styles.hint }, t('dstWarning', { zone: draft.scheduleZone })),
            h('button', { type: 'button', style: styles.button, onClick: pinToPricingZone }, t('pinToPricingZone')),
          )
        : null,
      h(
        Row,
        { label: t('displayZone') },
        h(
          'select',
          { style: styles.control, value: draft.displayZone, onChange: (event) => patch({ displayZone: event.target.value }) },
          h('option', { value: 'schedule' }, t('displayZoneSchedule')),
          h('option', { value: 'browser' }, `${t('displayZoneBrowser')} (${browser}, ${formatOffset(utcOffsetMinutes(browser, Date.now()))})`),
        ),
      ),
    ),
    h('div', { style: styles.divider }),
    h(
      'div',
      { style: styles.section },
      h('div', { style: styles.label }, t('windows')),
      windowRows,
      h(
        'div',
        { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button', { type: 'button', style: styles.button, onClick: addWindow }, t('addWindow')),
        h('button', { type: 'button', style: styles.button, onClick: applyPreset }, t('applyPreset')),
      ),
      h('div', { style: styles.hint }, t('presetNote')),
    ),
    h('div', { style: styles.divider }),
    h(
      'div',
      { style: styles.section },
      h(
        Row,
        { label: t('activeDays'), hint: t('activeDaysHint') },
        h(DayPicker, { value: draft.activeDays, onChange: (days) => patch({ activeDays: days }), t }),
      ),
      h(
        Row,
        { label: t('warnMinutes') },
        h('input', {
          type: 'number',
          min: 0,
          style: { ...styles.control, width: '80px' },
          value: draft.warnMinutes,
          onChange: (event) => patch({ warnMinutes: event.target.value }),
        }),
      ),
      h(
        Row,
        { label: t('routeFilter') },
        h(
          'select',
          { style: styles.control, value: draft.routeFilter, onChange: (event) => patch({ routeFilter: event.target.value }) },
          h('option', { value: 'all' }, t('routeAll')),
          h('option', { value: 'deepseek-official' }, t('routeDeepSeek')),
        ),
      ),
      h(
        Row,
        { label: t('showBalance'), hint: t('showBalanceHint') },
        h(Switch, { checked: config.showBalance === true, onChange: (value) => writeImmediately('showBalance', value) }),
      ),
      h(
        Row,
        { label: t('currency'), hint: t('currencyHint') },
        h(
          'select',
          {
            style: styles.control,
            value: draft.currency,
            onChange: (event) => patch({ currency: event.target.value }),
          },
          h('option', { value: 'auto' }, t('currencyAuto')),
          h('option', { value: 'CNY' }, '¥ CNY'),
          h('option', { value: 'USD' }, '$ USD'),
        ),
      ),
      draft.currency === 'auto'
        ? null
        : h(
            Row,
            { label: t('cnyPerUsd'), hint: t('cnyPerUsdHint') },
            h('input', {
              type: 'number',
              min: 0,
              step: 0.01,
              style: { ...styles.control, width: '80px' },
              value: draft.cnyPerUsd,
              onChange: (event) => patch({ cnyPerUsd: Number(event.target.value) }),
            }),
          ),
      h(
        Row,
        { label: t('showStatus'), hint: t('showStatusHint') },
        h(Switch, { checked: config.showStatus !== false, onChange: (value) => writeImmediately('showStatus', value) }),
      ),
    ),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
      h('button', { type: 'button', style: styles.primaryButton, disabled: busy || !dirty, onClick: save }, t('save')),
      dirty ? h('span', { style: styles.hint }, t('dirty')) : null,
      message ? h('span', { style: message.kind === 'error' ? styles.error : styles.hint }, message.text) : null,
    ),
  )
}

export const inject = ['slots', 'settingsScope', 'locale']

export function apply(ctx) {
  const slots = ctx.get('slots')
  const binder = ctx.get('settingsScope')
  const locale = ctx.get('locale')

  if (!slots || !binder) {
    console.error('[offpeak] client apply aborted; slots=', !!slots, 'settingsScope=', !!binder)
    return
  }

  const scope = binder.bind({ namespace: NS })

  slots.inject('conversation.session.header.utilities', () =>
    slots.register({ name: 'conversation.session.header.utilities', id: 'offpeak-status', order: 50 }, () =>
      h(HeaderEntry, { scope, locale, connection: ctx.get('connection') }),
    ),
  )

  slots.inject('settings.section', () =>
    slots.register(
      { name: 'settings.section', id: 'offpeak', order: 25, label: () => translate(currentLocaleId(locale), 'sectionLabel') },
      () => h(SettingsPage, { scope, locale }),
    ),
  )
}
