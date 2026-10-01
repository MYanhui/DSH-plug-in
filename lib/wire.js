/**
 * Wire helpers for the `/control-center/api` route: a bounded JSON body reader,
 * a JSON responder, and the request fence.
 *
 * The fence is deliberately narrow. The host webserver carries no
 * authentication of its own, so every mutating route this plugin owns must
 * reject a browser request that did not come from the harness page. Two cheap
 * checks cover the realistic attacks: a cross-origin `Origin` header (a page on
 * another site) and a non-JSON `Content-Type` (which forces a CORS preflight a
 * foreign origin cannot pass). Absent `Origin` — a shell tool, `curl`, the
 * Electron IPC bridge — is allowed, because those callers already run with the
 * user's own authority.
 */

/** Largest request body accepted by the API, in bytes. */
const MAX_BODY_BYTES = 2 * 1024 * 1024

/** Reject anything that is not a same-origin browser request (see the module note). */
export function fenced(req) {
  const origin = req.headers?.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    let host
    try {
      host = new URL(origin).hostname
    } catch {
      return false
    }
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return false
  }
  const type = req.headers?.['content-type']
  if (typeof type === 'string' && !type.toLowerCase().includes('application/json')) return false
  return true
}

/** Read and parse a bounded JSON request body. */
export async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('request body must be a JSON object')
    }
    return parsed
  } catch (error) {
    throw new Error(`malformed JSON body: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Write one JSON response. */
export function json(res, status, body) {
  const payload = JSON.stringify(body)
  try {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload),
      'cache-control': 'no-store',
    })
    res.end(payload)
  } catch {
    // The socket is already gone; nothing left to do.
  }
}

/** A failure carrying a stable wire code. */
export class ControlCenterError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/** Throw a coded wire failure. */
export function fail(code, message) {
  throw new ControlCenterError(code, message)
}
