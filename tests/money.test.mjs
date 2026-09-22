import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { currencySymbol, formatMoney } from '../src/money.js'

test('the symbol follows the currency the API reported', () => {
  assert.equal(formatMoney(39.78, 'USD'), '$39.78')
  assert.equal(formatMoney(39.78, 'CNY'), '¥39.78')
})

test('a currency with no known symbol shows its code rather than guessing one', () => {
  // A wrong symbol misstates the amount, which is worse than an unfamiliar code.
  assert.equal(formatMoney(39.78, 'CHF'), '39.78 CHF')
  assert.equal(currencySymbol('CHF'), '')
})

test('an unknown currency is never silently rendered as dollars', () => {
  assert.equal(formatMoney(12.5, 'SEK').startsWith('$'), false)
  assert.equal(formatMoney(12.5, undefined).startsWith('$'), false)
  assert.equal(formatMoney(12.5, null).startsWith('$'), false)
})

test('an absent currency still formats the number', () => {
  assert.equal(formatMoney(12.5), '12.50')
  assert.equal(formatMoney(12.5, ''), '12.50')
})

test('currency codes are matched case- and whitespace-insensitively', () => {
  assert.equal(formatMoney(1, 'cny'), '¥1.00')
  assert.equal(formatMoney(1, ' usd '), '$1.00')
})

test('a missing or unparseable amount reads as zero, never NaN', () => {
  assert.equal(formatMoney(undefined, 'USD'), '$0.00')
  assert.equal(formatMoney(null, 'USD'), '$0.00')
  assert.equal(formatMoney(Number.NaN, 'USD'), '$0.00')
  assert.equal(formatMoney('not a number', 'USD'), '$0.00')
})

test('amounts always carry two decimals', () => {
  assert.equal(formatMoney(0, 'USD'), '$0.00')
  assert.equal(formatMoney(1.005, 'USD'), '$1.00')
  assert.equal(formatMoney(1234.5, 'CNY'), '¥1234.50')
})

test('the symbol is not a function of the interface language', () => {
  // formatMoney takes no locale, so a Chinese UI showing a USD balance still shows $.
  // This is the regression guard for a hardcoded symbol in the client.
  assert.equal(formatMoney.length, 2, 'formatMoney must take exactly (value, currency)')
  assert.equal(formatMoney(39.78, 'USD'), formatMoney(39.78, 'USD'))
})

test('the client never hardcodes a currency symbol', () => {
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.equal(source.includes('$${'), false, 'a hardcoded $ template was reintroduced')
  assert.equal(/['"`]\$['"`]/.test(source), false, 'a hardcoded $ literal was reintroduced')
  assert.match(source, /from '\.\/money\.js'/, 'the client must use the shared formatter')
})
