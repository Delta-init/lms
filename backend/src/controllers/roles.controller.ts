import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import {
  RoleModel, UserModel,
  PERMISSION_RESOURCES, type IResourcePermission,
} from '@/models/schema.ts'
import { sendSuccess } from '@/utils/response.ts'

/* ── Helpers ────────────────────────────────────────────────── */

/** Build a full permissions array ensuring every resource is present */
function normalizePermissions(incoming: Partial<IResourcePermission>[]): IResourcePermission[] {
  const map = new Map(incoming.map(p => [p.resource, p]))
  return PERMISSION_RESOURCES.map(r => {
    const p = map.get(r)
    return {
      resource:    r,
      create:      p?.create      ?? false,
      read:        p?.read        ?? false,
      update:      p?.update      ?? false,
      delete:      p?.delete      ?? false,
      list:        p?.list        ?? false,
      list_basic:  p?.list_basic  ?? false,
      impersonate: r === 'users' ? (p?.impersonate ?? false) : false,
    }
  })
}

/* ── Controller ─────────────────────────────────────────────── */
export class RolesController {

  /* GET /admin/roles — list all roles */
  list = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const roles = await RoleModel.find()
        .sort({ isSystem: -1, name: 1 })
        .lean({ virtuals: true })
      // `.lean()` skips the toJSON `id` virtual (no mongoose-lean-virtuals plugin),
      // so map `_id` → `id` explicitly — same pattern as bookings/live-classes routes.
      sendSuccess(res, roles.map((r: any) => ({ ...r, id: r.id ?? String(r._id) })))
    } catch (err) { next(err) }
  }

  /* POST /admin/roles — create a new custom role */
  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { name, description } = req.body as { name: string; description?: string }

      const exists = await RoleModel.findOne({ name: name.trim() })
      if (exists) {
        res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'A role with this name already exists.' } })
        return
      }

      const role = await RoleModel.create({
        name:        name.trim(),
        description: description?.trim(),
        isSystem:    false,
        permissions: normalizePermissions([]),
      })
      sendSuccess(res, role.toObject(), 'Role created', 201)
    } catch (err) { next(err) }
  }

  /* PATCH /admin/roles/:id — update name / description */
  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id   = String(req.params['id'] ?? '')
      const role = await RoleModel.findById(id)
      if (!role) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Role not found' } }); return }
      if (role.isSystem) { res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'System roles cannot be modified' } }); return }

      const { name, description } = req.body as { name?: string; description?: string }
      if (name !== undefined)        role.name        = name.trim()
      if (description !== undefined) role.description = description.trim() || undefined

      await role.save()
      sendSuccess(res, role.toObject())
    } catch (err) { next(err) }
  }

  /* PATCH /admin/roles/:id/permissions — replace permission matrix */
  updatePermissions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id   = String(req.params['id'] ?? '')
      const role = await RoleModel.findById(id)
      if (!role) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Role not found' } }); return }
      // The Super Admin role is always unrestricted — protect it from being stripped.
      if (role.isSystem && role.name === 'Super Admin') {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'The Super Admin role always has full access and cannot be modified.' } }); return
      }

      const { permissions } = req.body as { permissions: Partial<IResourcePermission>[] }
      role.permissions = normalizePermissions(permissions ?? [])
      await role.save()
      sendSuccess(res, role.toObject())
    } catch (err) { next(err) }
  }

  /* DELETE /admin/roles/:id — delete a non-system role */
  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id   = String(req.params['id'] ?? '')
      const role = await RoleModel.findById(id)
      if (!role) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Role not found' } }); return }
      if (role.isSystem) { res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'System roles cannot be deleted' } }); return }

      await role.deleteOne()
      /* Unassign this role from all users who held it */
      await UserModel.updateMany(
        { customRoleId: new Types.ObjectId(id) },
        { $unset: { customRoleId: 1 } },
      )
      sendSuccess(res, { deleted: true })
    } catch (err) { next(err) }
  }

  /* PATCH /admin/users/:userId/assign-role — assign or remove custom role */
  assignRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = String(req.params['userId'] ?? '')
      const { roleId } = req.body as { roleId: string | null }

      const user = await UserModel.findById(userId)
      if (!user) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } }); return }

      if (roleId) {
        if (!Types.ObjectId.isValid(roleId)) {
          res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid role ID' } }); return
        }
        const role = await RoleModel.findById(roleId)
        if (!role) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Role not found' } }); return }
        user.customRoleId = new Types.ObjectId(roleId) as any
      } else {
        user.customRoleId = undefined
      }

      await user.save()
      sendSuccess(res, { userId, roleId: roleId ?? null })
    } catch (err) { next(err) }
  }

  /* Impersonation used to have a second implementation here, reachable at
     POST /admin/users/:userId/impersonate — except Express matched the earlier
     registration of the same path, so it never ran (P-25). Its route is gone,
     and the handler is removed with it rather than left as an unreachable
     second way to mint a session token: it applied different rules to the most
     sensitive endpoint in the system, and minted tokens with no audience
     claim, which would have broken the moment JWT_ENFORCE_AUDIENCE was set
     (L-06). The live implementation is AdminController.impersonateUser. */
}
