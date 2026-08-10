import { Types } from 'mongoose'
import type { Document, FilterQuery, UpdateQuery, Model, QueryOptions } from 'mongoose'

/* ─────────────────────────────────────────────────────
   BaseRepository<T>
   ─────────────────────────────────────────────────────
   Generic Mongoose repository every domain repo extends.
   Wraps Model<T> with typed, consistent methods.

   Usage:
     class UserRepository extends BaseRepository<IUser> {
       constructor() { super(UserModel) }
       async findByEmail(email: string) { ... }
     }
───────────────────────────────────────────────────── */
export class BaseRepository<T extends Document> {
  constructor(protected readonly model: Model<T>) {}

  /* ── Is this string capable of being an id at all? ───────────────
     Mongoose throws a CastError when a non-ObjectId reaches findById, and a
     CastError is not one of the registered error classes, so it fell through
     the error middleware as a 500 "unexpected error" — a mistyped URL logged
     a stack trace and told the caller the server was broken.

     Answering null is the honest result: no document can carry an id that is
     not an id. Callers already handle null, and none is weakened by it — the
     services still validate and refuse, and every guard that used to run after
     a successful lookup still runs. Fixed here rather than at the seven
     controller call sites so the next one is covered too. */
  protected static isId(id: unknown): id is string {
    return typeof id === 'string' && Types.ObjectId.isValid(id)
  }

  /* ── Find one by string id ──────────────────────── */
  async findById(id: string): Promise<T | null> {
    if (!BaseRepository.isId(id)) return null
    return this.model.findById(id).exec()
  }

  /* ── Find one by filter ─────────────────────────── */
  async findOne(filter: FilterQuery<T>): Promise<T | null> {
    return this.model.findOne(filter).exec()
  }

  /* ── Find many with optional filter + options ───── */
  async findMany(
    filter: FilterQuery<T> = {},
    options: {
      limit?:  number
      skip?:   number
      sort?:   Record<string, 1 | -1>
      select?: string
      populate?: string | string[]
    } = {},
  ): Promise<T[]> {
    let query: any = this.model.find(filter)
    if (options.limit)    query = query.limit(options.limit)
    if (options.skip)     query = query.skip(options.skip)
    if (options.sort)     query = query.sort(options.sort)
    if (options.select)   query = query.select(options.select)
    if (options.populate) {
      const fields = Array.isArray(options.populate)
        ? options.populate
        : [options.populate]
      for (const f of fields) query = query.populate(f)
    }
    return query.exec() as Promise<T[]>
  }

  /* ── Count documents ────────────────────────────── */
  async count(filter: FilterQuery<T> = {}): Promise<number> {
    return this.model.countDocuments(filter).exec()
  }

  /* ── Create one document ────────────────────────── */
  async create(data: Partial<T>): Promise<T> {
    return this.model.create(data)
  }

  /* ── Update by id, returns updated doc ─────────── */
  async updateById(
    id: string,
    update: UpdateQuery<T>,
    options: QueryOptions = {},
  ): Promise<T | null> {
    if (!BaseRepository.isId(id)) return null
    return this.model
      .findByIdAndUpdate(id, update, { new: true, runValidators: true, ...options })
      .exec()
  }

  /* ── Update one by filter ───────────────────────── */
  async updateOne(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
  ): Promise<T | null> {
    return this.model
      .findOneAndUpdate(filter, update, { new: true, runValidators: true })
      .exec()
  }

  /* ── Soft delete (sets isActive = false) ─────────── */
  async softDelete(id: string): Promise<boolean> {
    if (!BaseRepository.isId(id)) return false
    const doc = await this.model
      .findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true })
      .exec()
    return !!doc
  }

  /* ── Hard delete by id ──────────────────────────── */
  async hardDelete(id: string): Promise<boolean> {
    if (!BaseRepository.isId(id)) return false
    const result = await this.model.findByIdAndDelete(id).exec()
    return !!result
  }

  /* ── Hard delete by filter ──────────────────────── */
  async deleteMany(filter: FilterQuery<T>): Promise<number> {
    const result = await this.model.deleteMany(filter).exec()
    return result.deletedCount ?? 0
  }

  /* ── Check if document exists ───────────────────── */
  async exists(filter: FilterQuery<T>): Promise<boolean> {
    const doc = await this.model.exists(filter).exec()
    return !!doc
  }

  /* ── Paginated find with meta ───────────────────── */
  async paginate(
    filter: FilterQuery<T> = {},
    page: number,
    perPage: number,
    sort: Record<string, 1 | -1> = { createdAt: -1 },
  ): Promise<{ docs: T[]; totalCount: number }> {
    const [docs, totalCount] = await Promise.all([
      this.model
        .find(filter)
        .sort(sort)
        .skip((page - 1) * perPage)
        .limit(perPage)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ])
    return { docs, totalCount }
  }
}
