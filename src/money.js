// Unknown codes show their code; a wrong symbol would misstate the amount.
const SYMBOLS = { CNY: '¥', USD: '$' }

export const currencySymbol = (currency) =>
  typeof currency === 'string' ? SYMBOLS[currency.trim().toUpperCase()] ?? '' : ''

// The symbol is the currency's own: a CNY figure never wears a dollar sign.
export const formatMoney = (value, currency) => {
  // `?? 0` is not enough: Number('x') is NaN and renders as "NaN".
  const numeric = Number(value)
  const amount = (Number.isFinite(numeric) ? numeric : 0).toFixed(2)
  const symbol = currencySymbol(currency)
  if (symbol !== '') return `${symbol}${amount}`
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : ''
  return code === '' ? amount : `${amount} ${code}`
}

// Rate from the API's currency to the one shown; 1 means relabel only.
export const conversionRate = (apiCurrency, displayCurrency, cnyPerUsd) => {
  const from = typeof apiCurrency === 'string' ? apiCurrency.trim().toUpperCase() : ''
  const to = typeof displayCurrency === 'string' ? displayCurrency.trim().toUpperCase() : ''
  const rate = Number(cnyPerUsd)
  if (!(rate > 0) || from === '' || to === '' || from === to) return 1
  if (from === 'USD' && to === 'CNY') return rate
  if (from === 'CNY' && to === 'USD') return 1 / rate
  return 1
}
