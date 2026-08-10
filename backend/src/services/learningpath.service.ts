import { Types } from 'mongoose'
import { LearningPathRepository } from '@/repositories/learningpath.repository.ts'
import { buildPaginationMeta, parsePagination } from '@/utils/response.ts'

export class LearningPathError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'LearningPathError'
  }
}

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export class LearningPathService {
  private readonly repo = new LearningPathRepository()

  async listPublished(params: {
    page?:       number
    per_page?:   number
    categoryId?: string
    organizationId?: string
  }) {
    const { page, per_page } = parsePagination({ page: params.page, per_page: params.per_page })
    const { docs, total } = await this.repo.listPublished(
      page, per_page, params.categoryId, params.organizationId,
    )
    return { paths: docs, meta: buildPaginationMeta(total, page, per_page) }
  }

  async getBySlug(slug: string) {
    const path = await this.repo.findBySlug(slug, true)
    if (!path || path.status !== 'published') {
      throw new LearningPathError('PATH_NOT_FOUND', 'Learning path not found', 404)
    }
    return path
  }

  /* ── Admin CRUD ────────────────────────────────────── */

  async adminList(params: { page?: number; per_page?: number; organizationId?: string }) {
    const { page, per_page } = parsePagination({ page: params.page, per_page: params.per_page })
    const { docs, total } = await this.repo.listAll(page, per_page, params.organizationId)
    return { paths: docs, meta: buildPaginationMeta(total, page, per_page) }
  }

  async adminCreate(instructorId: string, dto: {
    title:        string
    description?: string
    thumbnailUrl?: string
    categoryId?:  string
    status?:      'draft' | 'published'
    courses?:     { courseId: string; order: number; isPrerequisite?: boolean }[]
  }, organizationId?: string) {
    const slug = toSlug(dto.title)
    const existing = await this.repo.findBySlug(slug)
    if (existing) throw new LearningPathError('SLUG_EXISTS', 'A learning path with this title already exists', 409)

    const data: Record<string, unknown> = {
      title:        dto.title.trim(),
      slug,
      instructorId: new Types.ObjectId(instructorId),
      status:       dto.status ?? 'draft',
    }
    /* Stamp the owning academy so the path is scoped from birth (P-22). */
    if (organizationId && Types.ObjectId.isValid(organizationId)) {
      data['organizationId'] = new Types.ObjectId(organizationId)
    }
    if (dto.description)   data['description']   = dto.description
    if (dto.thumbnailUrl)  data['thumbnailUrl']   = dto.thumbnailUrl
    if (dto.categoryId)    data['categoryId']     = new Types.ObjectId(dto.categoryId)
    if (dto.courses?.length) {
      data['courses'] = dto.courses.map(c => ({
        courseId:       new Types.ObjectId(c.courseId),
        order:          c.order,
        isPrerequisite: c.isPrerequisite ?? false,
      }))
    }

    return this.repo.create(data as Parameters<typeof this.repo.create>[0])
  }

  /* ── Tenancy then ownership (P-22) ──────────────────
     PATCH used to be open to every instructor on the platform and DELETE to
     every admin, with no owner check and no academy check at all — so any
     instructor could rewrite or unpublish a colleague's path by id, and either
     academy's admin could reach the other's.

     Two gates, in the order the rest of the codebase uses:
       1. ACADEMY — everyone below super_admin is confined to their own. A
          caller with no academy on record is unscoped, and a path that
          predates the field stays reachable, matching every other org filter.
       2. OWNERSHIP — an instructor is further confined to paths they authored.

     Answers 404 rather than 403 throughout, so the endpoint never confirms
     that an id exists in the other academy. */
  async #assertOwned(id: string, userId: string, role: string, organizationId?: string) {
    const existing = await this.repo.findById(id)
    if (!existing) {
      throw new LearningPathError('PATH_NOT_FOUND', 'Learning path not found', 404)
    }

    const pathOrg = (existing as { organizationId?: unknown }).organizationId
    if (role !== 'super_admin' && organizationId && pathOrg
        && String(pathOrg) !== String(organizationId)) {
      throw new LearningPathError('PATH_NOT_FOUND', 'Learning path not found', 404)
    }

    if (role === 'instructor' && String(existing.instructorId) !== String(userId)) {
      throw new LearningPathError('PATH_NOT_FOUND', 'Learning path not found', 404)
    }
    return existing
  }

  async adminUpdate(id: string, dto: {
    title?:        string
    description?:  string
    thumbnailUrl?: string
    categoryId?:   string
    status?:       'draft' | 'published'
    courses?:      { courseId: string; order: number; isPrerequisite?: boolean }[]
  }, actor?: { id: string; role: string; organizationId?: string }) {
    if (!Types.ObjectId.isValid(id)) {
      throw new LearningPathError('INVALID_ID', 'Invalid learning path id', 400)
    }
    if (actor) await this.#assertOwned(id, actor.id, actor.role, actor.organizationId)
    const patch: Record<string, unknown> = {}
    if (dto.title)         patch['title']        = dto.title.trim()
    if (dto.description != null) patch['description'] = dto.description
    if (dto.thumbnailUrl != null) patch['thumbnailUrl'] = dto.thumbnailUrl
    if (dto.categoryId)   patch['categoryId']    = new Types.ObjectId(dto.categoryId)
    if (dto.status)       patch['status']        = dto.status
    if (dto.courses)      patch['courses']       = dto.courses.map(c => ({
      courseId:       new Types.ObjectId(c.courseId),
      order:          c.order,
      isPrerequisite: c.isPrerequisite ?? false,
    }))

    const updated = await this.repo.update(id, patch as Parameters<typeof this.repo.update>[1])
    if (!updated) throw new LearningPathError('PATH_NOT_FOUND', 'Learning path not found', 404)
    return updated
  }

  async adminDelete(id: string, actor?: { id: string; role: string; organizationId?: string }) {
    if (!Types.ObjectId.isValid(id)) {
      throw new LearningPathError('INVALID_ID', 'Invalid learning path id', 400)
    }
    if (actor) await this.#assertOwned(id, actor.id, actor.role, actor.organizationId)
    await this.repo.deleteById(id)
  }
}
