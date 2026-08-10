import axios from 'axios'
import { useImpersonationStore } from '@/store/impersonation.store'
import { useOrgStore } from '@/store/org.store'

/**
 * Admin API client.
 * Base URL: /api/v1  — proxied to the backend via next.config.ts rewrites.
 * This keeps all requests same-origin so httpOnly cookies work without any
 * CORS or SameSite friction.
 */
export const api = axios.create({
  baseURL:         '/api/v1',
  withCredentials: true,
  timeout:         15_000,
  headers: { 'Content-Type': 'application/json' },
})

/* ── Request interceptor — inject impersonation token ── */
api.interceptors.request.use(config => {
  if (typeof window !== 'undefined') {
    const token = useImpersonationStore.getState().token
    if (token) {
      config.headers = config.headers ?? {}
      config.headers['Authorization'] = `Bearer ${token}`
    }
    const orgId = useOrgStore.getState().activeOrgId
    if (orgId) {
      config.headers = config.headers ?? {}
      config.headers['X-Organization-Id'] = orgId
    }
  }
  return config
})

/* ── Response interceptor — 401 → try refresh → retry → login ── */
let isRefreshing  = false
let refreshQueue: Array<(ok: boolean) => void> = []

function drainQueue(ok: boolean) {
  refreshQueue.forEach(fn => fn(ok))
  refreshQueue = []
}

api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config

    if (err.response?.status !== 401 || original?._retry) {
      return Promise.reject(err)
    }

    if (typeof window === 'undefined') return Promise.reject(err)
    if (window.location.pathname === '/login') return Promise.reject(err)

    /* An expired IMPERSONATION token cannot be refreshed: /admin/auth/refresh
       renews the admin's own cookie, and the request would just be retried
       with the same dead Bearer. Before M-02 this was invisible because the
       token lived as long as a session; with short-lived tokens it surfaces as
       an unrecoverable 401 loop. End impersonation and return the admin to
       their own identity instead. */
    if (useImpersonationStore.getState().token) {
      useImpersonationStore.getState().endImpersonation()
      window.location.href = '/users?impersonation=expired'
      return Promise.reject(err)
    }

    original._retry = true

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push(ok => ok ? resolve(api(original)) : reject(err))
      })
    }

    isRefreshing = true
    try {
      await axios.post('/api/v1/admin/auth/refresh', null, { withCredentials: true })
      isRefreshing = false
      drainQueue(true)
      return api(original)
    } catch (refreshErr: any) {
      isRefreshing = false
      drainQueue(false)
      // Only a definitive auth rejection (401) means the session is really
      // gone. Rate limiting (429), timeouts, or network hiccups are
      // transient — don't force-logout an active user over those.
      if (refreshErr?.response?.status === 401) {
        window.location.href = '/login'
      }
      return Promise.reject(err)
    }
  },
)

/* ── Typed helpers ──────────────────────────────── */
export async function apiGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.get<{ success: true; data: T }>(url, { params })
  return res.data.data
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.post<{ success: true; data: T }>(url, body)
  return res.data.data
}

export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.patch<{ success: true; data: T }>(url, body)
  return res.data.data
}

export async function apiDelete<T>(url: string): Promise<T> {
  const res = await api.delete<{ success: true; data: T }>(url)
  return res.data.data
}
