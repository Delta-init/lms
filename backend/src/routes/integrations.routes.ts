/* ────────────────────────────────────────────────────────────────────────────
   Server-to-server endpoints for CLT Connect.
   ────────────────────────────────────────────────────────────────────────────
   Not reachable by a browser: every route here is signed with the shared HMAC
   secret and carries no cookie session. The direction is CLT → LMS, the
   mirror of services/clt.service.ts going the other way.
──────────────────────────────────────────────────────────────────────────── */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { sendSuccess } from '@/utils/response.ts'
import { verifyCltSignature } from '@/utils/cltSignature.ts'
import { logger } from '@/utils/logger.ts'

const router = Router()

const FAILURE_STATUS: Record<string, number> = {
  MISSING_SIGNATURE: 401,
  STALE_TIMESTAMP:   401,
  BAD_SIGNATURE:     401,
}

const FAILURE_MESSAGE: Record<string, string> = {
  MISSING_SIGNATURE: 'Missing CLT signature headers',
  STALE_TIMESTAMP:   'Request timestamp is out of date',
  BAD_SIGNATURE:     'Bad signature',
}

/* ────────────────────────────────────────────────────────────────────────────
   POST /integrations/handoff/exchange   { code }
   ────────────────────────────────────────────────────────────────────────────
   CLT redeems a one-time code for a freshly minted join ticket.

   POST rather than GET, and the code in the BODY rather than the path, for one
   reason: a code in a URL is written to access logs on both sides. It is
   single-use and short-lived, so the exposure is small — but it costs nothing
   to not create it.

   The signature covers the code itself, not an empty body. Sign nothing and
   the same captured headers could be replayed against a different code for the
   whole freshness window; signing the code binds one signature to one code.
──────────────────────────────────────────────────────────────────────────── */
router.post('/handoff/exchange', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secret = String(process.env['CLT_S2S_SECRET'] ?? '')
    if (!secret) {
      res.status(503).json({
        success: false,
        error: { code: 'INTEGRATION_DISABLED', message: 'CLT integration is not configured' },
      })
      return
    }

    const code = String((req.body as { code?: unknown } | undefined)?.code ?? '')

    const failure = verifyCltSignature(
      {
        timestamp: req.headers['x-clt-timestamp'],
        nonce:     req.headers['x-clt-nonce'],
        signature: req.headers['x-clt-signature'],
      },
      code,
      secret,
    )
    if (failure) {
      logger.warn({ path: '/integrations/handoff/exchange', failure }, 'CLT S2S signature rejected')
      res.status(FAILURE_STATUS[failure] ?? 401).json({
        success: false,
        error: { code: failure, message: FAILURE_MESSAGE[failure] ?? 'Rejected' },
      })
      return
    }

    const { exchangeHandoff, HandoffError } = await import('@/services/classHandoff.service.ts')
    const { JoinError } = await import('@/services/liveClassJoin.service.ts')
    try {
      const out = await exchangeHandoff(code)
      sendSuccess(res, out, 'Handoff exchanged')
    } catch (err: any) {
      /* Both error families carry a status and a code the caller can act on:
         CODE_EXPIRED is "open the class again", NOT_BOOKED is not. Collapsing
         them into one 400 would leave CLT unable to say anything useful. */
      if (err instanceof HandoffError || err instanceof JoinError) {
        res.status(err.status).json({
          success: false,
          error: { code: err.code, message: err.message },
        })
        return
      }
      throw err
    }
  } catch (err) { next(err) }
})

export default router
