import { AuditLogModel, type IAuditLog, type AuditAction } from '@/models/schema.ts'
import { Types } from 'mongoose'

export interface CreateAuditLogDto {
  actorId:    string | Types.ObjectId
  actorEmail: string
  actorRole:  string
  action:     AuditAction
  entity:     string
  entityId?:  string
  meta?:      Record<string, unknown>
  ip?:        string
  userAgent?: string
  organizationId?: string
}

export class AuditLogRepository {
  async create(dto: CreateAuditLogDto): Promise<IAuditLog> {
    return AuditLogModel.create({
      actorId:    new Types.ObjectId(String(dto.actorId)),
      actorEmail: dto.actorEmail,
      actorRole:  dto.actorRole,
      action:     dto.action,
      entity:     dto.entity,
      entityId:   dto.entityId,
      meta:       dto.meta,
      ip:         dto.ip,
      userAgent:  dto.userAgent,
      ...(dto.organizationId && Types.ObjectId.isValid(dto.organizationId)
        ? { organizationId: new Types.ObjectId(dto.organizationId) }
        : {}),
    })
  }

  /* `organizationId` scopes the trail to one academy (H-12). Omitted means
     unscoped — the super_admin case. Entries written before the field existed
     have none and stay visible to everyone, matching the convention used by
     every other org filter; `bun run migrate-audit-org` backfills them. */
  async list(page: number, perPage: number, filter: {
    actorId?: string
    action?:  string
    entity?:  string
    organizationId?: string
  } = {}): Promise<{ docs: IAuditLog[]; totalCount: number }> {
    /* String()-coerce every caller-supplied value: req.query can smuggle objects or
       arrays (?action[$ne]=login) that Mongo would otherwise interpret as operators */
    const actorId = filter.actorId ? String(filter.actorId) : undefined

    const q: Record<string, unknown> = {}
    if (actorId && Types.ObjectId.isValid(actorId)) {
      q['actorId'] = new Types.ObjectId(actorId)
    }
    if (filter.action) q['action'] = String(filter.action)
    if (filter.entity) q['entity'] = String(filter.entity)

    const orgId = filter.organizationId
    if (orgId && Types.ObjectId.isValid(orgId)) {
      q['$or'] = [
        { organizationId: new Types.ObjectId(orgId) },
        { organizationId: null },
        { organizationId: { $exists: false } },
      ]
    }

    const [docs, totalCount] = await Promise.all([
      AuditLogModel.find(q).sort({ createdAt: -1 }).skip((page - 1) * perPage).limit(perPage).exec(),
      AuditLogModel.countDocuments(q).exec(),
    ])
    return { docs, totalCount }
  }
}
