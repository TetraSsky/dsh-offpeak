import test from 'node:test'
import assert from 'node:assert/strict'
import { createBalanceReader, parseBalance } from '../src/balance.js'

test('parseBalance extracts the first entry and tolerates a missing envelope', () => {
  const parsed = parseBalance(
    {
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '110.50', granted_balance: '10.00', topped_up_balance: '100.50' }],
    },
    1234,
  )
  assert.deepEqual(parsed, {
    at: 1234,
    available: true,
    currency: 'CNY',
    total: 110.5,
    granted: 10,
    toppedUp: 100.5,
  })
})

test('parseBalance never fabricates a number', () => {
  assert.equal(parseBalance({}, 1).total, null)
  assert.equal(parseBalance({ balance_infos: [] }, 1).currency, null)
  assert.equal(parseBalance(null, 1).available, false)
  assert.equal(parseBalance({ balance_infos: [{ total_balance: 'n/a' }] }, 1).total, null)
})

const withStubbedFetch = (response, run) => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), auth: init?.headers?.authorization })
    return response
  }
  return Promise.resolve(run(calls)).finally(() => {
    globalThis.fetch = original
  })
}

const contextWithKey = (key) => ({
  get: (name) => (name === 'credentials' ? { resolve: async () => (key === null ? undefined : { value: key }) } : undefined),
})

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body })

test('read sends the stored key to the balance endpoint and returns the parsed figure', async () => {
  await withStubbedFetch(okResponse({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '42.00' }] }), async (calls) => {
    const reader = createBalanceReader({ ctx: contextWithKey('sk-test') })
    const value = await reader.read()

    assert.equal(value.total, 42)
    assert.equal(value.currency, 'CNY')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://api.deepseek.com/user/balance')
    assert.equal(calls[0].auth, 'Bearer sk-test')
  })
})

test('read fails with a useful message when no key is stored', async () => {
  await withStubbedFetch(okResponse({}), async (calls) => {
    const reader = createBalanceReader({ ctx: contextWithKey(null) })
    await assert.rejects(() => reader.read(), /DEEPSEEK_API_KEY/)
    assert.equal(calls.length, 0, 'must not call the API without a key')
  })
})

test('read surfaces an HTTP failure instead of reporting a balance', async () => {
  await withStubbedFetch({ ok: false, status: 401, json: async () => ({}) }, async () => {
    const reader = createBalanceReader({ ctx: contextWithKey('sk-bad') })
    await assert.rejects(() => reader.read(), /HTTP 401/)
  })
})

test('read caches briefly so the UI cannot hammer the API', async () => {
  await withStubbedFetch(okResponse({ balance_infos: [{ total_balance: '5.00' }] }), async (calls) => {
    const reader = createBalanceReader({ ctx: contextWithKey('sk-test') })
    await reader.read()
    await reader.read()
    assert.equal(calls.length, 1, 'second read inside the cache window must not refetch')

    reader.invalidate()
    await reader.read()
    assert.equal(calls.length, 2)
  })
})
