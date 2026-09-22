// DeepSeek bills in CNY and USD. Any other code falls back to the code itself rather
// than guessing a symbol, because a wrong symbol misstates the amount.
const SYMBOLS = { CNY: '¥', USD: '$' }

export const currencySymbol = (currency) =>
  typeof currency === 'string' ? SYMBOLS[currency.trim().toUpperCase()] ?? '' : ''

/**
 * Format an amount in its own currency. The symbol follows the currency the API
 * reported, never the interface language: showing ¥ for a USD balance because the UI is
 * Chinese would misreport the figure.
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
