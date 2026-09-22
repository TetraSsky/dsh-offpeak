import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { conversionRate, currencySymbol, formatMoney } from '../src/money.js'

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

test('the symbol is chosen by the setting or the API, never by the interface language', () => {
  // formatMoney takes no locale: a Chinese UI showing a USD balance still shows $, and a
  // forced currency shows its own symbol in either language.
  assert.equal(formatMoney.length, 2, 'formatMoney must take exactly (value, currency)')
  assert.equal(formatMoney(39.78, 'USD'), formatMoney(39.78, 'USD'))
})

test('without a rate the figure is never converted, whatever is displayed', () => {
  assert.equal(conversionRate('USD', 'CNY', 0), 1, 'no rate means no conversion')
  assert.equal(conversionRate('USD', 'CNY', undefined), 1)
  assert.equal(conversionRate('USD', 'CNY', -3), 1, 'a negative rate is not a rate')
  assert.equal(conversionRate('USD', 'CNY', Number.NaN), 1)
  assert.equal(conversionRate('USD', 'USD', 7.2), 1, 'same currency on both sides')
  assert.equal(conversionRate(null, 'CNY', 7.2), 1, 'an unknown API currency cannot be converted')
  assert.equal(conversionRate('USD', null, 7.2), 1)
})

test('a rate converts between the two currencies DeepSeek bills in', () => {
  assert.equal(conversionRate('USD', 'CNY', 7.2), 7.2)
  assert.equal(conversionRate('CNY', 'USD', 7.2), 1 / 7.2)
  assert.equal(conversionRate('usd', 'cny', 7.2), 7.2, 'codes are matched case-insensitively')
})

test('a converted balance states the currency it was converted into', () => {
  // ¥ for a USD account only means something if the figure was converted, so the pair
  // moves together: rate 7.2 on 39.56 renders as a yuan amount.
  const rate = conversionRate('USD', 'CNY', 7.2)
  assert.equal(formatMoney(39.56 * rate, 'CNY'), '¥284.83')
  assert.equal(formatMoney(39.56, 'CNY'), '¥39.56', 'rate 0 relabels, it does not convert')
})

test('the client never hardcodes a currency symbol', () => {
  const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.equal(source.includes('$${'), false, 'a hardcoded $ template was reintroduced')
  assert.equal(/['"`]\$['"`]/.test(source), false, 'a hardcoded $ literal was reintroduced')
  assert.match(source, /from '\.\/money\.js'/, 'the client must use the shared formatter')
})
