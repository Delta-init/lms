import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '@/middleware/auth.middleware.ts'
import { validate } from '@/middleware/validate.middleware.ts'
import { authRateLimit } from '@/middleware/rateLimit.middleware.ts'
import { TotpService } from '@/services/totp.service.ts'
import { sendSuccess } from '@/utils/response.ts'
import type { Request, Response, NextFunction } from 'express'

const router  = Router()
const totpSvc = new TotpService()

/* POST /auth/2fa/setup — re-authenticate, then generate a TOTP secret.
   The password is required because this hands back the secret, and whoever
   holds the secret controls whether the account has a second factor. Without
   it a borrowed session could enable 2FA against an authenticator the real
   owner does not have, locking them out unrecoverably (NEW-01). */
router.post('/setup', authenticate, authRateLimit,
  validate(z.object({ password: z.string().min(1, 'Password is required') })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await totpSvc.setup(req.user!.id, (req.body as { password: string }).password)
      sendSuccess(res, result, '2FA setup initiated — scan the QR code in your authenticator app, then call /enable')
    } catch (err) { next(err) }
  })

/* POST /auth/2fa/enable — verifies the first TOTP code; activates 2FA */
router.post('/enable', authenticate, authRateLimit,
  validate(z.object({ code: z.string().length(6, 'Code must be 6 digits').regex(/^\d+$/) })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await totpSvc.enable(req.user!.id, (req.body as { code: string }).code)
      sendSuccess(res, null, 'Two-factor authentication enabled.')
    } catch (err) { next(err) }
  })

/* POST /auth/2fa/disable — re-authenticate with password, then removes 2FA */
router.post('/disable', authenticate, authRateLimit,
  validate(z.object({ password: z.string().min(1) })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await totpSvc.disable(req.user!.id, (req.body as { password: string }).password)
      sendSuccess(res, null, 'Two-factor authentication disabled.')
    } catch (err) { next(err) }
  })

/* GET /auth/2fa/status — current 2FA status */
router.get('/status', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await totpSvc.status(req.user!.id)
    sendSuccess(res, result)
  } catch (err) { next(err) }
})

export default router
