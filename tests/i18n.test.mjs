import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dictionaries, fallbackLocale, translate } from '../src/i18n.js'

test('English is the fallback locale', () => {
  assert.equal(fallbackLocale, 'en')
  assert.ok(dictionaries.en, 'the fallback dictionary must exist')
})

test('the dictionaries are exactly the locales the harness ships', () => {
  // The harness ships only zh and en, so another dictionary is unreachable.
  assert.deepEqual(Object.keys(dictionaries).sort(), ['en', 'zh'])
})

test('no Chinese string is a leftover copy of the English', () => {
  // Catches a key copied into zh but never translated.
  const allowed = new Set(['statusLoading'])
  const copied = Object.keys(dictionaries.en).filter(
    (key) => !allowed.has(key) && dictionaries.zh[key] === dictionaries.en[key],
  )
  assert.deepEqual(copied, [], 'these keys were never actually translated')
})

test('the header label, balance breakdown and chart labels are translated', () => {
  const surface = [
    'statusLine',
    'statusDisabled',
    'statusWaiting',
    'statusWarn',
    'statusPaused',
    'bannerPaused',
    'bannerWarn',
    'balance',
    'granted',
    'toppedUp',
    'spent10m',
    'spent1h',
    'spent24h',
    'chartTitle',
    'chartNoData',
    'chartCollecting',
    'chartNote',
    'dismiss',
  ]
  for (const key of surface) {
    assert.notEqual(dictionaries.zh[key], dictionaries.en[key], `${key} is still English`)
    assert.match(dictionaries.zh[key], /[\u4e00-\u9fff]/, `${key} has no Chinese characters`)
  }
})

test('every dictionary carries exactly the same keys', () => {
  const reference = Object.keys(dictionaries.en).sort()
  assert.ok(reference.length > 50, `expected a substantial key set, found ${reference.length}`)
  for (const [locale, dict] of Object.entries(dictionaries)) {
    assert.deepEqual(Object.keys(dict).sort(), reference, `${locale} does not match the English key set`)
  }
})

test('no dictionary has an empty string, which would silently fall back', () => {
  for (const [locale, dict] of Object.entries(dictionaries)) {
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(typeof value, 'string', `${locale}.${key} must be a string`)
      assert.notEqual(value.trim(), '', `${locale}.${key} is empty`)
    }
  }
})

test('every string the UI asks for is defined', () => {
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  const used = new Set([...source.matchAll(/\bt\('([A-Za-z][A-Za-z0-9]*)'/g)].map((match) => match[1]))
  assert.ok(used.size > 30, `expected to find string keys in the client, found ${used.size}`)

  const missing = [...used].filter((key) => !(key in dictionaries.en))
  assert.deepEqual(missing, [], 'the UI asks for keys no dictionary defines')
})

test('the placeholders a dictionary declares are the ones the UI passes', () => {
  for (const [locale, dict] of Object.entries(dictionaries)) {
    for (const [key, value] of Object.entries(dict)) {
      const placeholders = [...value.matchAll(/\{([a-zA-Z]+)\}/g)].map((match) => match[1])
      const english = [...dictionaries.en[key].matchAll(/\{([a-zA-Z]+)\}/g)].map((match) => match[1])
      assert.deepEqual(
        [...placeholders].sort(),
        [...english].sort(),
        `${locale}.${key} declares different placeholders than English`,
      )
    }
  }
})

test('substitution replaces every placeholder', () => {
  assert.equal(translate('en', 'statusWarn', { minutes: 3 }), 'pausing in 3 min')
  assert.equal(translate('en', 'presetAdded', { count: 2, zone: 'Asia/Dubai' }), 'Added 2 window(s) in Asia/Dubai. Not saved yet.')
  assert.equal(translate('zh', 'statusWarn', { minutes: 3 }), '3 分钟后暂停')
})

test('a region-tagged locale resolves to its primary subtag', () => {
  assert.equal(translate('zh-CN', 'dismiss'), dictionaries.zh.dismiss)
  assert.equal(translate('zh-TW', 'dismiss'), dictionaries.zh.dismiss)
  assert.equal(translate('en-GB', 'dismiss'), dictionaries.en.dismiss)
})

test('an unknown locale falls back to English rather than showing a key', () => {
  assert.equal(translate('de', 'dismiss'), dictionaries.en.dismiss)
  assert.equal(translate('nonsense', 'dismiss'), dictionaries.en.dismiss)
  assert.equal(translate(undefined, 'dismiss'), dictionaries.en.dismiss)
})

test('an unknown key returns the key itself, never undefined', () => {
  assert.equal(translate('en', 'noSuchKey'), 'noSuchKey')
  assert.equal(translate('zh', 'noSuchKey'), 'noSuchKey')
})
