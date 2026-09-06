import type { Response } from 'express'
import type { ApiSuccessResponse, ApiErrorResponse, PaginationMeta } from '@/types/index.ts'
import { toAssetUrl } from '@/utils/assetUrl.ts'

/* Rewrite every stored R2 public URL (pub-*.r2.dev/<key>) in a response to the
   asset proxy, so images keep loading now that the bucket is private. Done at
   the serialized-JSON level so it catches URLs from ANY serializer/model, not
   just the few DTOs. toAssetUrl leaves protected prefixes (videos/, kyc/)
   untouched. */
const R2_URL = /https?:\/\/[a-z0-9-]+\.r2\.dev\/[^"\\]+/gi
function rewriteR2Urls(json: string): string {
  return json.includes('.r2.dev') ? json.replace(R2_URL, m => toAssetUrl(m) ?? m) : json
}

/* ─── Success response ──────────────────────────────
   Usage: sendSuccess(res, data, 'Created', 201)
───────────────────────────────────────────────────── */
export function sendSuccess<T>(
  res: Response,
  data: T,
  message?: string,
  statusCode = 200,
  meta?: PaginationMeta,
): Response {
  const body: ApiSuccessResponse<T> = {
    success: true,
    data,
    ...(message && { message }),
    ...(meta && { meta }),
  }
  return res.status(statusCode).type('application/json').send(rewriteR2Urls(JSON.stringify(body)))
}

/* ─── Error response ────────────────────────────────
   Usage: sendError(res, 'UNAUTHORIZED', 'Invalid token', 401)
───────────────────────────────────────────────────── */
export function sendError(
  res: Response,
  code: string,
  message: string,
  statusCode = 400,
  details?: unknown,
): Response {
  const body: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
  }
  return res.status(statusCode).json(body)
}

/* ─── Pagination meta builder ───────────────────────
   Usage: buildPaginationMeta(totalCount, page, perPage)
───────────────────────────────────────────────────── */
export function buildPaginationMeta(
  total_count: number,
  page: number,
  per_page: number,
): PaginationMeta {
  const total_pages = Math.ceil(total_count / per_page)
  return {
    total_count,
    page,
    per_page,
    total_pages,
    has_next: page < total_pages,
    has_prev: page > 1,
  }
}

/* ─── Pagination params parser ──────────────────────
   Usage: parsePagination(req.query)
───────────────────────────────────────────────────── */
export function parsePagination(query: Record<string, unknown>): {
  page: number
  per_page: number
  offset: number
} {
  const page     = Math.max(1, parseInt(String(query['page'] ?? 1), 10))
  const per_page = Math.min(100, Math.max(1, parseInt(String(query['per_page'] ?? 20), 10)))
  return { page, per_page, offset: (page - 1) * per_page }
}
