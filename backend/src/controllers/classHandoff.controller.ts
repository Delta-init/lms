import type { Request, Response, NextFunction } from 'express'
import { sendSuccess } from '@/utils/response.ts'

/* ────────────────────────────────────────────────────────────────────────────
   POST .../live-classes/:id/handoff  — hand this class over to CLT Connect
   ────────────────────────────────────────────────────────────────────────────
   Returns a URL carrying a one-time code, NOT a ticket. The ticket is a bearer
   credential and a URL is the worst place to put one: history, Referer, proxy
   logs, and whatever is on screen when someone shares it.

   Nothing is decided here beyond who is asking. The authorisation runs when
   CLT exchanges the code, so a class cancelled or a booking withdrawn in the
   seconds between clicking and arriving is still honoured.

   ONE HANDLER, MOUNTED TWICE, AND THE MOUNT IS THE POINT
   ─────────────────────────────────────────────────────
   It hangs off the student router behind `authenticate` and off the admin
   router behind `authenticateAdmin`, so the identity it issues for follows
   the PORTAL the click came from.

   It used to be a single route behind `authenticateAny`, which reads whichever
   of the two cookies it finds first and prefers the admin one. The two portals
   are only separated by port in development and may share an apex domain in
   production (COOKIE_DOMAIN), so one browser can hold both cookies at once —
   and then a student pressing "Join the class" on their own dashboard was
   issued the ADMIN's hidden observer ticket, because the admin cookie won the
   precedence contest. Whoever was at the keyboard inherited a session that was
   not theirs. Deciding by mount removes the contest entirely: the student
   router cannot see the admin cookie, so there is nothing to prefer.
──────────────────────────────────────────────────────────────────────────── */
export async function issueClassHandoff(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    /* The BROWSER-facing origin, which is not necessarily the API one.
       CLT_BASE_URL is where the LMS talks to CLT server-to-server; /lms/enter
       is a page served by CLT's SPA. Deployed behind one domain those are the
       same host and this distinction is invisible — split them (a dev setup,
       or an API subdomain) and sending the browser to the API origin yields a
       404 from a URL that looks perfectly correct.

       Falls back to CLT_BASE_URL so single-origin installs need no new
       setting. */
    const base = String(
      process.env['CLT_PUBLIC_URL'] || process.env['CLT_BASE_URL'] || '',
    ).replace(/\/+$/, '')
    if (!base) {
      res.status(503).json({
        success: false,
        error: { code: 'INTEGRATION_DISABLED', message: 'The meeting platform address is not configured.' },
      })
      return
    }

    const { issueHandoff, HANDOFF_TTL_SEC } = await import('@/services/classHandoff.service.ts')
    const { ADMIN_OBSERVER_ROLES } = await import('@/services/liveClassJoin.service.ts')

    /* A student joins as a student; everyone else arrives on the host path,
       where mintHostTicket decides between instructor and observer. */
    const role = req.user!.role
    const kind = (role === 'student') ? 'student' as const : 'host' as const
    const visible = (req.body as { visible?: boolean } | undefined)?.visible === true

    /* Cheap early refusal so an obviously wrong role never gets a code it
       cannot spend. The real check still runs at exchange time. */
    if (kind === 'host' && role !== 'instructor' && !ADMIN_OBSERVER_ROLES.has(role)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Your role cannot host or observe classes.' },
      })
      return
    }

    const { code, expiresIn } = await issueHandoff(
      String(req.params['id'] ?? ''), req.user!.id, kind, { visible },
    )
    sendSuccess(res, {
      url: `${base}/lms/enter?c=${encodeURIComponent(code)}`,
      expiresIn,
      ttlSeconds: HANDOFF_TTL_SEC,
    }, 'Handoff issued')
  } catch (err: any) {
    const { JoinError } = await import('@/services/liveClassJoin.service.ts')
    if (err instanceof JoinError) {
      res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } })
      return
    }
    next(err)
  }
}
