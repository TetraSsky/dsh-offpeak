const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const API_KEY_REF = 'DEEPSEEK_API_KEY'
const CACHE_MS = 60000

// DeepSeek's balance envelope, with every field optional.
export const parseBalance = (body, now = Date.now()) => {
  const info = Array.isArray(body?.balance_infos) ? body.balance_infos[0] : undefined
  const asNumber = (value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return {
    at: now,
    available: body?.is_available === true,
    currency: typeof info?.currency === 'string' ? info.currency : null,
    total: asNumber(info?.total_balance),
    granted: asNumber(info?.granted_balance),
    toppedUp: asNumber(info?.topped_up_balance),
  }
}

// Reads the balance with the stored key, which never leaves the host.
export const createBalanceReader = ({ ctx, report = () => {} }) => {
  let cache = { at: 0, value: null }

  const read = async (signal) => {
    if (cache.value !== null && Date.now() - cache.at < CACHE_MS) return cache.value

    const credentials = ctx.get('credentials')
    if (!credentials) throw new Error('the credentials service is unavailable')

    const hit = await credentials.resolve(API_KEY_REF)
    if (!hit || typeof hit.value !== 'string' || hit.value.length === 0) {
      throw new Error(`no ${API_KEY_REF} is stored; add it on the Models page`)
    }

    const response = await fetch(BALANCE_URL, {
      headers: { authorization: `Bearer ${hit.value}`, accept: 'application/json' },
      signal,
    })
    if (!response.ok) throw new Error(`balance request failed with HTTP ${response.status}`)

    const value = parseBalance(await response.json())
    cache = { at: Date.now(), value }
    report('balance read', { currency: value.currency, total: value.total })
    return value
  }

  return {
    read,
    invalidate() {
      cache = { at: 0, value: null }
    },
  }
}
