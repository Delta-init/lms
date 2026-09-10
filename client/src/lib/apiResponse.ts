/* ─────────────────────────────────────────────────────
   Read a fetch() response that is SUPPOSED to be JSON.

   `await res.json()` assumes the body is JSON before anything has checked
   that it is. Between the browser and this app sit a reverse proxy and a
   Next.js rewrite, and both answer failures with their own HTML error page —
   nginx returns one for a body over `client_max_body_size` (413) and for a
   backend that is restarting or slow (502/504). Parsing that HTML throws, and
   the SyntaxError is what the user ends up reading:

     Chrome   Unexpected token '<', "<!DOCTYPE "... is not valid JSON
     Safari   The string did not match the expected pattern.

   Two engines describing one event, and neither tells a student anything they
   can act on. Worse, the throw happens BEFORE the `res.ok` check, so the
   status code — the one piece of information that would explain the failure —
   is never read at all.

   So: take the body as text, try to parse it, and when it is not JSON turn
   the STATUS into a sentence a person can act on.
───────────────────────────────────────────────────── */

export interface JsonEnvelope<T> {
  success: boolean
  data?:   T
  error?:  { code?: string; message?: string }
}

/** What a non-JSON response of this status actually means to whoever sent it. */
function describe(status: number): string {
  if (status === 413) return 'The file is too large for the server to accept. Please choose a smaller image and try again.'
  if (status === 429) return 'Too many attempts. Please wait a few minutes and try again.'
  if (status === 502 || status === 503 || status === 504)
    return 'The server is not responding right now. Please try again in a moment.'
  if (status >= 500) return `The server hit an error (${status}). Please try again in a moment.`
  if (status === 404) return 'That address could not be reached (404). Please refresh the page and try again.'
  if (status >= 400) return `The request was rejected (${status}). Please try again.`
  /* A 2xx that is not JSON — an empty body, or a proxy that answered instead
     of the app. Nothing here is worth quoting back to a student. */
  return 'The server sent a response this page could not read. Please try again.'
}

export type ReadResult<T> =
  | { ok: true;  body: JsonEnvelope<T> }
  | { ok: false; message: string }

/**
 * `ok` reports whether the body could be READ, not whether the request
 * succeeded — check `res.ok` separately. Splitting the two is the point: an
 * error the API sent deliberately still carries its own message, while a page
 * the API never wrote gets one derived from the status.
 */
export async function readJson<T>(res: Response): Promise<ReadResult<T>> {
  const text = await res.text()
  try {
    return { ok: true, body: JSON.parse(text) as JsonEnvelope<T> }
  } catch {
    return { ok: false, message: describe(res.status) }
  }
}
