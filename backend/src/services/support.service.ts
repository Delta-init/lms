import { Types } from 'mongoose'
import {
  SupportTicketModel,
  type ISupportTicket,
  type SupportTicketStatus,
  type SupportCategory,
} from '@/models/schema.ts'
import { NotificationService } from '@/services/notification.service.ts'
import { logger } from '@/utils/logger.ts'

export interface ProgramStat {
  program: string; label: string; total: number; open: number; pending: number
  resolved: number; closed: number; unread: number; avgResponseHours: number; responded: number
}

export class SupportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'SupportError'
  }
}

type Requester = {
  id:              string
  role:            'student' | 'instructor' | 'admin' | '4x_admin' | 'digital_marketing_admin' | 'ai_admin' | 'super_admin' | 'sub_admin' | 'support'
  categoryScope?:  '4x-trading' | 'digital-marketing' | 'ai'
  organizationId?: string
}

const isStaff = (r: Requester) =>
  r.role === 'admin' || r.role === 'super_admin' || r.role === 'sub_admin' || r.role === 'support'
  || r.role === '4x_admin' || r.role === 'digital_marketing_admin' || r.role === 'ai_admin'

/* ─── Tenant isolation ─────────────────────────────────
   Returns the org predicate for a caller, or null when no
   scoping applies:
     • super_admin sees every organization
     • a caller with no org context is not scoped
   Tickets that predate organizationId stay visible to everyone. */
const orgScope = (r?: Requester): Record<string, unknown> | null => {
  if (!r || r.role === 'super_admin')                                   return null
  if (!r.organizationId || !Types.ObjectId.isValid(r.organizationId))   return null
  return {
    $or: [
      { organizationId: new Types.ObjectId(r.organizationId) },
      { organizationId: null },
      { organizationId: { $exists: false } },
    ],
  }
}

/** Upper bound on a free-text search term before it reaches $regex. */
const MAX_SEARCH_LEN = 100
/** Hard ceiling on messages per ticket — keeps the doc well under Mongo's 16 MB limit. */
const MAX_MESSAGES   = 200

const notifSvc = new NotificationService()

export class SupportService {
  /* ── Client opens a new ticket ─────────────────────── */
  async create(
    requester: Requester,
    input: { subject: string; category?: SupportCategory; message: string; program?: string },
  ): Promise<ISupportTicket> {
    const ticketData: Record<string, unknown> = {
      userId:         new Types.ObjectId(requester.id),
      subject:        input.subject.trim(),
      category:       input.category ?? 'other',
      program:        input.program ?? undefined,
      status:         'open',
      messages:       [{
        senderId:   new Types.ObjectId(requester.id),
        senderRole: 'student',
        body:       input.message.trim(),
        createdAt:  new Date(),
      }],
      lastMessageAt:  new Date(),
      lastSenderRole: 'student',
      userUnread:     false,
      adminUnread:    true,
    }
    if (requester.organizationId && Types.ObjectId.isValid(requester.organizationId)) {
      ticketData['organizationId'] = new Types.ObjectId(requester.organizationId)
    }
    const ticket = await SupportTicketModel.create(ticketData)
    return this.populate(ticket.id)
  }

  /* ── Client: list my tickets ───────────────────────── */
  async listForUser(userId: string): Promise<ISupportTicket[]> {
    return SupportTicketModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ lastMessageAt: -1 })
      .populate('userId', 'name email avatarUrl')
      .exec()
  }

  /* ── Admin: list all tickets (scoped by program and org if set) */
  async listAll(filter: { status?: string; search?: string; program?: string } = {}, requester?: Requester): Promise<ISupportTicket[]> {
    const query: Record<string, unknown> = {}
    if (filter.status && filter.status !== 'all') query['status'] = filter.status
    if (filter.search?.trim()) {
      const escaped = filter.search.trim().slice(0, MAX_SEARCH_LEN).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      query['subject'] = { $regex: escaped, $options: 'i' }
    }
    if (filter.program) query['program'] = filter.program
    const scoped = orgScope(requester)
    if (scoped) Object.assign(query, scoped)
    return SupportTicketModel
      .find(query)
      .sort({ lastMessageAt: -1 })
      .limit(200)
      .populate('userId', 'name email avatarUrl')
      .exec()
  }

  /* ── Admin: status counts (scoped by program and org if set) ── */
  async adminStats(program?: string, requester?: Requester): Promise<{ open: number; pending: number; resolved: number; closed: number; unread: number; total: number }> {
    const base: Record<string, unknown> = program ? { program } : {}
    const scoped = orgScope(requester)
    if (scoped) Object.assign(base, scoped)
    const [open, pending, resolved, closed, unread, total] = await Promise.all([
      SupportTicketModel.countDocuments({ ...base, status: 'open' }),
      SupportTicketModel.countDocuments({ ...base, status: 'pending' }),
      SupportTicketModel.countDocuments({ ...base, status: 'resolved' }),
      SupportTicketModel.countDocuments({ ...base, status: 'closed' }),
      SupportTicketModel.countDocuments({ ...base, adminUnread: true }),
      SupportTicketModel.countDocuments(base),
    ])
    return { total, open, pending, resolved, closed, unread }
  }

  /* ── View a single ticket (owner or staff) ─────────── */
  async getOne(ticketId: string, requester: Requester): Promise<ISupportTicket> {
    if (!Types.ObjectId.isValid(ticketId)) throw new SupportError('INVALID_ID', 'Invalid ticket id', 400)
    const ticket = await SupportTicketModel.findById(ticketId)
    if (!ticket) throw new SupportError('NOT_FOUND', 'Ticket not found', 404)
    this.assertAccess(ticket, requester)

    // Clear the unread flag for whoever is viewing
    if (isStaff(requester) && ticket.adminUnread) { ticket.adminUnread = false; await ticket.save() }
    else if (!isStaff(requester) && ticket.userUnread) { ticket.userUnread = false; await ticket.save() }

    return this.populate(ticketId)
  }

  /* ── Add a reply (owner or staff) ──────────────────── */
  async addMessage(ticketId: string, requester: Requester, body: string): Promise<ISupportTicket> {
    if (!Types.ObjectId.isValid(ticketId)) throw new SupportError('INVALID_ID', 'Invalid ticket id', 400)
    const ticket = await SupportTicketModel.findById(ticketId)
    if (!ticket) throw new SupportError('NOT_FOUND', 'Ticket not found', 404)
    this.assertAccess(ticket, requester)
    if (ticket.status === 'closed') throw new SupportError('TICKET_CLOSED', 'This ticket is closed. Open a new one if you still need help.', 400)
    if (ticket.messages.length >= MAX_MESSAGES) throw new SupportError('TICKET_MESSAGE_LIMIT', `This ticket has reached its ${MAX_MESSAGES}-message limit. Open a new one to continue.`, 400)

    const staff = isStaff(requester)
    ticket.messages.push({
      senderId:   new Types.ObjectId(requester.id),
      senderRole: staff ? 'admin' : 'student',
      body:       body.trim(),
      createdAt:  new Date(),
    })
    ticket.lastMessageAt  = new Date()
    ticket.lastSenderRole = staff ? 'admin' : 'student'
    ticket.status      = staff ? 'pending' : 'open'
    ticket.userUnread  = staff ? true  : ticket.userUnread
    ticket.adminUnread = staff ? false : true
    await ticket.save()

    if (staff) {
      void notifSvc.create(String(ticket.userId), {
        kind:  'system',
        title: `Support replied: ${ticket.subject}`,
        body:  body.trim().slice(0, 140),
        link:  '/support',
      }).catch(err => logger.error({ err }, '[support] reply notification failed'))
    }

    return this.populate(ticketId)
  }

  /* ── Admin: change ticket status ───────────────────── */
  async setStatus(ticketId: string, status: SupportTicketStatus, requester: Requester): Promise<ISupportTicket> {
    if (!Types.ObjectId.isValid(ticketId)) throw new SupportError('INVALID_ID', 'Invalid ticket id', 400)
    const ticket = await SupportTicketModel.findById(ticketId)
    if (!ticket) throw new SupportError('NOT_FOUND', 'Ticket not found', 404)
    this.assertAccess(ticket, requester)
    ticket.status = status
    await ticket.save()
    return this.populate(ticketId)
  }

  /* ── Admin: per-program performance stats ──────────── */
  async adminPerformance(): Promise<ProgramStat[]> {
    const programs: { id: string; label: string }[] = [
      { id: 'ai',                 label: 'AI' },
      { id: '4x-trading',        label: 'FOREX' },
      { id: 'digital-marketing', label: 'Digital Marketing' },
    ]
    return Promise.all(programs.map(async prog => {
      const tickets = await SupportTicketModel.find({ program: prog.id }).lean()
      const total    = tickets.length
      const open     = tickets.filter(t => t.status === 'open').length
      const pending  = tickets.filter(t => t.status === 'pending').length
      const resolved = tickets.filter(t => t.status === 'resolved').length
      const closed   = tickets.filter(t => t.status === 'closed').length
      const unread   = tickets.filter(t => t.adminUnread).length
      const times = tickets
        .map(t => {
          const first = (t.messages as any[]).find((m: any) => m.senderRole === 'admin')
          if (!first) return null
          return (new Date(first.createdAt).getTime() - new Date(t.createdAt).getTime()) / 3_600_000
        })
        .filter((r): r is number => r !== null)
      const avgResponseHours = times.length
        ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10
        : 0
      return { program: prog.id, label: prog.label, total, open, pending, resolved, closed, unread, avgResponseHours, responded: times.length }
    }))
  }

  /* ── helpers ───────────────────────────────────────── */
  private assertAccess(ticket: ISupportTicket, requester: Requester): void {
    if (!isStaff(requester)) {
      // clients can only view their own tickets
      if (String(ticket.userId) !== requester.id) {
        throw new SupportError('FORBIDDEN', 'You do not have access to this ticket', 403)
      }
      return
    }
    // staff are confined to their own organization; tickets with no
    // organizationId predate the field and stay readable by everyone
    const scoped = orgScope(requester)
    if (scoped && ticket.organizationId && String(ticket.organizationId) !== requester.organizationId) {
      throw new SupportError('FORBIDDEN', 'You do not have access to this ticket', 403)
    }
    // category-scoped admins can only see their program's tickets
    if (requester.categoryScope) {
      if (ticket.program && ticket.program !== requester.categoryScope) {
        throw new SupportError('FORBIDDEN', 'You do not have access to this ticket', 403)
      }
    }
  }

  private async populate(ticketId: string): Promise<ISupportTicket> {
    return SupportTicketModel
      .findById(ticketId)
      .populate('userId', 'name email avatarUrl')
      .populate('messages.senderId', 'name avatarUrl role')
      .exec() as unknown as ISupportTicket
  }
}
