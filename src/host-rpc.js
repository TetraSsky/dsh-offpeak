// Connection requires a leading slash here and rejects "/api" as reserved.
export const CHANNEL = '/offpeak'

const MAX_BODY_BYTES = 64 * 1024
const ENDPOINT_SEGMENT = /^[A-Za-z0-9_$.-]+$/

const failure = (code, message) => ({ ok: false, error: { code, message, details: {} } })

const send = (res, status, body, contentType) => {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': contentType, 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

const sendJson = (res, status, body) => send(res, status, body, 'application/json')
const sendText = (res, status, text) => send(res, status, text, 'text/plain')

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })

const endpointOf = (url) => {
  const path = String(url ?? '').split('?')[0]
  if (!path.startsWith(`${CHANNEL}/`)) return undefined
  const endpoint = path.slice(CHANNEL.length + 1)
  return ENDPOINT_SEGMENT.test(endpoint) ? endpoint : undefined
}

// Serves host-only facts to the browser half, borrowing Connection's own request fence.
export const installRpcChannel = ({ ctx, report = () => {}, handlers }) => {
  const webServer = ctx.get('webServer')
  if (!webServer || typeof webServer.register !== 'function') {
    report('rpc route unavailable', { hasWebServer: Boolean(webServer) })
    return null
  }

  const serve = async (req, res) => {
    // Resolved per request: Connection may activate after this route is registered.
    const connection = ctx.get('connection')
    if (typeof connection?.requestRejection === 'function') {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) {
        sendText(res, rejection, rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
    }

    const endpoint = endpointOf(req.url)
    if (req.method !== 'POST' || endpoint === undefined) {
      sendText(res, 404, 'not found')
      return
    }

    let envelope
    try {
      envelope = JSON.parse(await readBody(req))
    } catch {
      sendText(res, 400, 'body is not JSON')
      return
    }

    if (
      !envelope ||
      envelope.type !== 'client-request' ||
      typeof envelope.rpcId !== 'string' ||
      typeof envelope.method !== 'string'
    ) {
      sendText(res, 400, 'invalid envelope')
      return
    }

    if (envelope.method !== endpoint) {
      sendJson(res, 200, {
        type: 'server-response',
        rpcId: envelope.rpcId,
        result: failure('bad-request', `method ${JSON.stringify(envelope.method)} does not match endpoint ${JSON.stringify(endpoint)}`),
      })
      return
    }

    const handler = handlers[endpoint]
    const result =
      handler === undefined
        ? failure('not-found', `unknown endpoint: ${endpoint}`)
        : await Promise.resolve()
            .then(() => handler(envelope.payload, undefined))
            .then(
              (value) => ({ ok: true, value }),
              (error) => failure('internal', String((error && error.message) || error)),
            )

    sendJson(res, 200, { type: 'server-response', rpcId: envelope.rpcId, result })
  }

  try {
    const disposer = ctx.effect(() => webServer.register({ kind: 'prefix', path: CHANNEL, handler: serve }))
    report('rpc route registered', {
      channel: CHANNEL,
      endpoints: Object.keys(handlers),
      guarded: typeof ctx.get('connection')?.requestRejection === 'function',
    })
    return disposer
  } catch (error) {
    report('rpc route registration failed', { channel: CHANNEL, message: String((error && error.message) || error) })
    return null
  }
}
