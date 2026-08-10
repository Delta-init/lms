/**
 * Catch-all proxy: forwards every /api/v1/* request to the backend and
 * EXPLICITLY copies all response headers (including Set-Cookie) back to the
 * browser. Next.js `rewrites` silently drop Set-Cookie, so we use a real
 * route handler instead.
 */
import { NextRequest, NextResponse } from 'next/server'
import { pickClientIp } from '@/lib/clientIp'

const BACKEND = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

type Context = { params: Promise<{ path: string[] }> }

async function proxy(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const { path } = await ctx.params
  const pathStr   = path.join('/')
  const search    = req.nextUrl.search
  const url       = `${BACKEND}/api/v1/${pathStr}${search}`

  // Forward relevant incoming headers
  const fwdHeaders = new Headers()
  const ct = req.headers.get('content-type')
  if (ct) fwdHeaders.set('content-type', ct)
  const cookie = req.headers.get('cookie')
  if (cookie) fwdHeaders.set('cookie', cookie)
  const auth = req.headers.get('authorization')
  if (auth) fwdHeaders.set('authorization', auth)
  const orgId = req.headers.get('x-organization-id')
  if (orgId) fwdHeaders.set('x-organization-id', orgId)

  /* Relay the admin's real address so the backend can rate-limit per person
     instead of per proxy (M-11). This fetch is server-to-server, so without it
     every admin looks like this server and they all share one bucket.

     A dedicated header + shared secret is the only relay that survives the hop:
     nginx rewrites X-Real-IP and appends to X-Forwarded-For, and any header a
     browser can set is forgeable by anyone calling the API directly. With
     PROXY_SHARED_SECRET unset nothing is sent and behaviour is unchanged. */
  const proxySecret = process.env.PROXY_SHARED_SECRET
  if (proxySecret) {
    const clientIp = pickClientIp(req.headers)
    if (clientIp) {
      fwdHeaders.set('x-lms-client-ip', clientIp)
      fwdHeaders.set('x-lms-proxy-secret', proxySecret)
    }
  }

  /* arrayBuffer(), NOT text(): multipart uploads carry raw binary, and decoding
     those bytes as UTF-8 replaces every invalid sequence with U+FFFD. That
     destroyed the leading magic bytes of every JPEG/PNG/PDF the admin panel
     uploaded, so the backend's signature check rejected them with a message
     that blamed the file rather than this line. The client proxy always did
     this correctly; this one had drifted. */
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const body    = hasBody ? await req.arrayBuffer() : undefined

  let backendRes: Response
  try {
    backendRes = await fetch(url, {
      method:  req.method,
      headers: fwdHeaders,
      body,
    })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: 'PROXY_ERROR', message: String(err) } },
      { status: 502 },
    )
  }

  // Build response, copying ALL headers from the backend (incl. Set-Cookie)
  const resHeaders = new Headers()
  backendRes.headers.forEach((val, key) => {
    // Skip hop-by-hop headers that must not be forwarded
    if (['transfer-encoding', 'connection', 'keep-alive', 'upgrade'].includes(key.toLowerCase())) return
    resHeaders.append(key, val)
  })

  return new NextResponse(backendRes.body, {
    status:  backendRes.status,
    headers: resHeaders,
  })
}

export const GET     = proxy
export const POST    = proxy
export const PUT     = proxy
export const PATCH   = proxy
export const DELETE  = proxy
export const OPTIONS = proxy
