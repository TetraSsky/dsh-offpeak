// DeepSeek bills in CNY and USD. Any other code falls back to the code itself rather
// than guessing a symbol, because a wrong symbol misstates the amount.
const SYMBOLS = { CNY: '¥', USD: '$' }

export const currencySymbol = (currency) =>
  typeof currency === 'string' ? SYMBOLS[currency.trim().toUpperCase()] ?? '' : ''

/**
 * Format an amount in the given currency. The symbol is the currency's own, so a CNY
 * figure never wears a dollar sign and the other way round.
 */
export const formatMoney = (value, currency) => {
  // `?? 0` is not enough: Number('x') is NaN, and NaN.toFixed(2) renders "NaN".
  const numeric = Number(value)
  const amount = (Number.isFinite(numeric) ? numeric : 0).toFixed(2)
  const symbol = currencySymbol(currency)
  if (symbol !== '') return `${symbol}${amount}`
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : ''
  return code === '' ? amount : `${amount} ${code}`
}

/**
 * Multiplier taking an amount from the currency the API reported to the one the user
 * asked for on screen. DeepSeek bills in CNY or USD, so one rate quoted as CNY per USD
 * covers both directions. No rate, or the same currency on both sides, returns 1: the
 * figure is then shown exactly as the API returned it, and only the symbol changes.
 */
export const conversionRate = (apiCurrency, displayCurrency, cnyPerUsd) => {
  const from = typeof apiCurrency === 'string' ? apiCurrency.trim().toUpperCase() : ''
  const to = typeof displayCurrency === 'string' ? displayCurrency.trim().toUpperCase() : ''
  const rate = Number(cnyPerUsd)
  if (!(rate > 0) || from === '' || to === '' || from === to) return 1
  if (from === 'USD' && to === 'CNY') return rate
  if (from === 'CNY' && to === 'USD') return 1 / rate
  return 1
}
