import type { Request, Response, NextFunction } from 'express'
import { AuthService } from '@/services/auth.service.ts'
import { sendSuccess } from '@/utils/response.ts'
import { verifyAccessToken } from '@/utils/jwt.ts'
import {
  setAuthCookies,
  clearAuthCookies,
  REFRESH_COOKIE,
  setAdminAuthCookies,
  clearAdminAuthCookies,
  ADMIN_REFRESH_COOKIE,
} from '@/utils/authCookies.ts'

/* ─────────────────────────────────────────────────────
   AuthController
   ─────────────────────────────────────────────────────
   Thin HTTP layer — no business logic here.
   Tokens are issued as httpOnly cookies, never returned
   in the JSON body (browsers attach them automatically).
───────────────────────────────────────────────────── */
function sessionMeta(req: Request): { userAgent?: string; ip?: string } {
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
  /* Express resolves req.ip via `trust proxy = 1`, so it handles X-Forwarded-For. */
  const ip = req.ip
  return { userAgent, ip }
}

export class AuthController {
  private readonly service = new AuthService()

  /* ── POST /auth/register ────────────────────────── */
  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.register(req.body, sessionMeta(req))

      /* Verification-first mode (M-05): no session, and deliberately the same
         answer a taken address gets — that identity is the whole point. */
      if ('verificationRequired' in result) {
        sendSuccess(
          res,
          { verificationRequired: true },
          'Check your inbox to finish setting up your account.',
          201,
        )
        return
      }

      setAuthCookies(res, result.tokens)
      sendSuccess(res, { user: result.user }, 'Account created successfully', 201)
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/login ─────────────────────────────
     An account with 2FA enabled gets a challenge instead
     of cookies; every other account gets exactly the
     response shape it always got. */
  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.login(req.body, sessionMeta(req))
      if ('twoFactorRequired' in result) {
        sendSuccess(
          res,
          { twoFactorRequired: true, challengeToken: result.challengeToken },
          'Enter the code from your authenticator app to finish signing in',
        )
        return
      }
      setAuthCookies(res, result.tokens)
      sendSuccess(res, { user: result.user }, 'Signed in successfully')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/login/2fa ───────────────────────── */
  loginTwoFactor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { challengeToken, code } = req.body as { challengeToken: string; code: string }
      const { user, tokens } = await this.service.loginTwoFactor(challengeToken, code, sessionMeta(req))
      setAuthCookies(res, tokens)
      sendSuccess(res, { user }, 'Signed in successfully')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/refresh ─────────────────────────── */
  refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawToken = req.cookies?.[REFRESH_COOKIE]

      if (!rawToken) {
        res.status(401).json({
          success: false,
          error: { code: 'MISSING_REFRESH_TOKEN', message: 'Refresh session not found' },
        })
        return
      }

      const tokens = await this.service.refresh(rawToken, sessionMeta(req))
      setAuthCookies(res, tokens)
      sendSuccess(res, null, 'Session refreshed')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/logout ──────────────────────────── */
  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawToken = req.cookies?.[REFRESH_COOKIE]
      if (rawToken) await this.service.logout(rawToken)
      clearAuthCookies(res)
      sendSuccess(res, null, 'Signed out successfully')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /admin/auth/login ─────────────────────────
     Admin-portal login — sets lms_admin_at / lms_admin_rt
     cookies only. Client lms_at is left completely untouched
     so both portals can maintain independent sessions.
  ──────────────────────────────────────────────────── */
  adminLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.login(req.body, sessionMeta(req), 'admin')
      if ('twoFactorRequired' in result) {
        sendSuccess(
          res,
          { twoFactorRequired: true, challengeToken: result.challengeToken },
          'Enter the code from your authenticator app to finish signing in',
        )
        return
      }
      if (result.user.role === 'student') {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'This portal is for admins and instructors only.' },
        })
        return
      }
      setAdminAuthCookies(res, result.tokens)
      sendSuccess(res, { user: result.user }, 'Signed in successfully')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /admin/auth/login/2fa ─────────────────────
     Second factor for the admin portal — same challenge,
     but it ends in the lms_admin_* cookies. */
  adminLoginTwoFactor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { challengeToken, code } = req.body as { challengeToken: string; code: string }
      const { user, tokens } = await this.service.loginTwoFactor(challengeToken, code, sessionMeta(req), 'admin')
      if (user.role === 'student') {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'This portal is for admins and instructors only.' },
        })
        return
      }
      setAdminAuthCookies(res, tokens)
      sendSuccess(res, { user }, 'Signed in successfully')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /admin/auth/refresh ───────────────────── */
  adminRefresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawToken = req.cookies?.[ADMIN_REFRESH_COOKIE]
      if (!rawToken) {
        res.status(401).json({ success: false, error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token' } })
        return
      }
      const tokens = await this.service.refresh(rawToken, sessionMeta(req), 'admin')
      const { role } = await verifyAccessToken(tokens.access_token)
      if (role === 'student') {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'This portal is for admins and instructors only.' },
        })
        return
      }
      setAdminAuthCookies(res, tokens)
      sendSuccess(res, null, 'Session refreshed')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /admin/auth/logout ─────────────────────── */
  adminLogout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawToken = req.cookies?.[ADMIN_REFRESH_COOKIE]
      if (rawToken) await this.service.logout(rawToken)
      clearAdminAuthCookies(res)
      sendSuccess(res, null, 'Signed out successfully')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/logout-all ──────────────────────── */
  logoutAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.service.logoutAll(req.user!.id)
      clearAuthCookies(res)
      sendSuccess(res, null, 'All sessions revoked')
    } catch (err) {
      next(err)
    }
  }

  /* ── GET /auth/me ───────────────────────────────── */
  me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.service.getMe(req.user!.id)
      sendSuccess(res, { user })
    } catch (err) {
      next(err)
    }
  }

  /* ── PATCH /auth/me ─────────────────────────────── */
  updateMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.service.updateMe(req.user!.id, req.body)
      sendSuccess(res, { user }, 'Profile updated')
    } catch (err) {
      next(err)
    }
  }

  /* ── PATCH /auth/me/enrollment-docs ────────────── */
  updateEnrollmentDocs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.service.updateEnrollmentDocs(req.user!.id, req.body)
      sendSuccess(res, { user }, 'Documents updated')
    } catch (err) {
      next(err)
    }
  }

  /* ── PATCH /auth/me/complete-registration ──────── */
  completeRegistration = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.service.completeRegistration(req.user!.id, req.body)
      sendSuccess(res, { user }, 'Registration submitted. Pending admin approval.')
    } catch (err) {
      next(err)
    }
  }

  /* ── PATCH /auth/me/password ────────────────────── */
  changePassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string }
      const tokens = await this.service.changePassword(req.user!.id, currentPassword, newPassword, sessionMeta(req))
      setAuthCookies(res, tokens)
      sendSuccess(res, null, 'Password changed successfully. Other devices have been signed out.')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/forgot-password ───────────────────
     Always returns 200 to prevent account enumeration. */
  forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.body as { email: string }
      await this.service.forgotPassword(email)
      sendSuccess(res, null, 'If an account exists with that email, a reset link has been sent.')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/reset-password ──────────────────── */
  resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token, password } = req.body as { token: string; password: string }
      await this.service.resetPassword(token, password)
      sendSuccess(res, null, 'Password reset successfully. You can sign in now.')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/verify-email ────────────────────── */
  verifyEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.body as { token: string }
      await this.service.verifyEmail(token)
      sendSuccess(res, null, 'Email verified.')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/resend-verification ─────────────── */
  resendVerification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.service.resendVerification(req.user!.id)
      sendSuccess(res, null, 'Verification email sent.')
    } catch (err) {
      next(err)
    }
  }

  /* ── GET /auth/sessions ─────────────────────────── */
  listSessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const currentRefreshToken = req.cookies?.[REFRESH_COOKIE]
      const sessions = await this.service.listSessions(req.user!.id, currentRefreshToken)
      sendSuccess(res, sessions)
    } catch (err) {
      next(err)
    }
  }

  /* ── DELETE /auth/sessions/:id ──────────────────── */
  revokeSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const currentRefreshToken = req.cookies?.[REFRESH_COOKIE]
      const { revokedCurrent } = await this.service.revokeSession(
        req.user!.id,
        String(req.params['id'] ?? ''),
        currentRefreshToken,
      )
      if (revokedCurrent) clearAuthCookies(res)
      sendSuccess(res, { revokedCurrent }, 'Session revoked.')
    } catch (err) {
      next(err)
    }
  }

  /* ── POST /auth/deactivate ──────────────────────── */
  deactivateAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { password } = req.body as { password: string }
      await this.service.deactivateAccount(req.user!.id, password)
      clearAuthCookies(res)
      sendSuccess(res, null, 'Account deactivated. You have been signed out.')
    } catch (err) {
      next(err)
    }
  }

  /* ── DELETE /auth/account ───────────────────────── */
  deleteAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { password } = req.body as { password: string }
      await this.service.deleteAccount(req.user!.id, password)
      clearAuthCookies(res)
      sendSuccess(res, null, 'Account permanently deleted.')
    } catch (err) {
      next(err)
    }
  }
}
