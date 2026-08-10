import { Types } from 'mongoose'
import { hasLLM, callLLM, callLLMJSON } from '@/utils/llm.ts'
import { LessonModel, CourseModel } from '@/models/schema.ts'
import { EnrollmentRepository } from '@/repositories/enrollment.repository.ts'

/** Hard ceiling on a single chat generation so a hung model can't pin the request */
const CHAT_TIMEOUT_MS = 30_000

/* ─── Per-user daily allowance  (L-09) ────────────────
   searchRateLimit caps the BURST (30/min) but nothing capped the TOTAL, so a
   single account could run the model continuously and the only ceiling was
   the hardware. This is a cost guard, not an anti-abuse guard — the default is
   set well above what a studying human does in a day, so it should never be
   noticed in normal use, and exists so that one runaway client cannot consume
   the platform's inference capacity.

   Tune with AI_DAILY_MESSAGE_LIMIT; 0 disables the cap entirely. */
const DEFAULT_DAILY_LIMIT = 100

function dailyLimit(): number {
  const raw = Number(process.env['AI_DAILY_MESSAGE_LIMIT'])
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_DAILY_LIMIT
}

/* The app runs on Asia/Dubai (config/timezone.ts sets TZ before any Date is
   constructed), so the local calendar date is what a user means by "today" —
   the allowance resets at local midnight, not at an arbitrary UTC hour.
   'en-CA' formats as YYYY-MM-DD, which sorts and compares cleanly. */
function today(): string {
  return new Date().toLocaleDateString('en-CA')
}

/** Detect Ollama / fetch connection errors so we return 503 instead of 500 */
function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return (
    msg.includes('econnrefused') ||
    msg.includes('fetch failed')  ||
    msg.includes('enotfound')     ||
    msg.includes('etimedout')     ||
    msg.includes('network')       ||
    msg.includes('connect')
  )
}

/** Detect "model not pulled" errors from Ollama */
function isModelNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return msg.includes('model') && (msg.includes('not found') || msg.includes('pull'))
}

export class AIError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'AIError'
  }
}

export interface ChatMessage {
  role:    'user' | 'assistant'
  content: string
}

/* ─────────────────────────────────────────────────────
   AIService
   ─────────────────────────────────────────────────────
   Powers two AI features:

   1. chat()      — lesson-scoped "Ask AI" assistant
   2. autoTag()   — generate tags for a course title+desc
───────────────────────────────────────────────────── */
export class AIService {
  private readonly enrollRepo = new EnrollmentRepository()

  /* ── 7.2  Lesson-scoped AI chat ─────────────────── */
  async chat(
    userId:      string,
    history:     ChatMessage[],
    newMessage:  string,
    lessonId?:   string,
    courseSlug?: string,
  ): Promise<string> {
    if (!hasLLM()) {
      throw new AIError('AI_NOT_CONFIGURED', 'AI (Ollama) is not available on this server.', 503)
    }
    if (!newMessage.trim()) {
      throw new AIError('EMPTY_MESSAGE', 'Message cannot be empty.', 400)
    }

    /* Claimed BEFORE generation, so an abandoned or timed-out request still
       counts — otherwise the cheapest way to exceed the cap would be to hang up
       on every response. */
    await this.#claimDailyAllowance(userId)

    /* Build context from lesson / course */
    const context = await this.buildContext(userId, lessonId, courseSlug)

    const systemPrompt = `You are a helpful AI learning assistant for an online learning platform.
${context}

Guidelines:
- Answer questions clearly and concisely related to the course content above.
- If a question is unrelated to the course, politely redirect the student.
- Use examples when helpful. Format code with backticks.
- Keep responses focused — 1-3 paragraphs unless depth is clearly needed.`

    /* Build message list: trim to last 10 turns to stay within token limits */
    const trimmedHistory = history.slice(-10)
    const messages: ChatMessage[] = [
      ...trimmedHistory,
      { role: 'user', content: newMessage },
    ]

    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new AIError('AI_TIMEOUT', 'The AI assistant took too long to respond. Please try again.', 504)),
          CHAT_TIMEOUT_MS,
        ),
      )
      return await Promise.race([callLLM(systemPrompt, messages), timeout])
    } catch (err: unknown) {
      /* Generation exceeded CHAT_TIMEOUT_MS */
      if (err instanceof AIError) throw err
      /* Ollama offline / unreachable */
      if (isConnectionError(err)) {
        throw new AIError(
          'AI_UNAVAILABLE',
          'The AI assistant is offline. Start Ollama with `ollama serve` and make sure the model is downloaded.',
          503,
        )
      }
      /* Model not downloaded yet */
      if (isModelNotFoundError(err)) {
        const model = (err instanceof Error && err.message.match(/model '([^']+)'/)?.[1]) ?? 'llama3.2:3b'
        throw new AIError(
          'AI_MODEL_NOT_FOUND',
          `AI model "${model}" is not installed. Run in your terminal:\n\n  ollama pull ${model}\n\nThen restart the backend.`,
          503,
        )
      }
      throw err
    }
  }

  /* ── 7.7  Auto-tag a course ─────────────────────── */
  async autoTag(title: string, description?: string): Promise<string[]> {
    if (!hasLLM()) return []

    const systemPrompt = `You are a course tagging assistant. Given a course title and description, return 5–10 relevant skill/technology tags.
Return ONLY a JSON array of lowercase strings, no markdown fences. Example: ["javascript","react","web development"]`

    const userMessage = `Title: "${title}"
Description: ${description?.trim() || 'not provided'}`

    try {
      const tags = await callLLMJSON<string[]>(
        systemPrompt,
        userMessage,
      )
      return Array.isArray(tags) ? tags.slice(0, 10).map(t => String(t).toLowerCase().trim()) : []
    } catch {
      return []
    }
  }

  /* ── Private: claim one message from today's allowance ───────
     Counted on the USER DOCUMENT rather than in memory, so the cap survives a
     restart and holds across PM2 instances — an in-process counter would reset
     on every deploy and give each fork its own full allowance.

     Two steps: increment when the stored day is already today, otherwise start
     a new day at 1. Two requests arriving in the same millisecond on a fresh
     day can both take the second branch and one increment is lost, so the cap
     can over-admit by one per day. That is the right trade for a cost guard —
     a transaction here would buy exactness nobody needs. */
  async #claimDailyAllowance(userId: string): Promise<void> {
    const limit = dailyLimit()
    if (limit === 0) return          /* explicitly disabled */

    const { UserModel } = await import('@/models/schema.ts')
    const day = today()

    const bumped = await UserModel.findOneAndUpdate(
      { _id: userId, 'aiUsage.day': day },
      { $inc: { 'aiUsage.count': 1 } },
      { new: true, projection: { aiUsage: 1 } },
    ).lean()

    if (!bumped) {
      /* No record for today — first message of the day, or ever. */
      await UserModel.findByIdAndUpdate(userId, { $set: { aiUsage: { day, count: 1 } } }).exec()
      return
    }

    const used = (bumped as { aiUsage?: { count?: number } }).aiUsage?.count ?? 0
    if (used > limit) {
      throw new AIError(
        'AI_DAILY_LIMIT',
        `You have reached today's limit of ${limit} AI messages. It resets at midnight.`,
        429,
      )
    }
  }

  /* ── Private: context builder ───────────────────── */
  private async buildContext(userId: string, lessonId?: string, courseSlug?: string): Promise<string> {
    const parts: string[] = []

    /* Resolve lesson — silently skipped when the caller is not entitled to it,
       so a crafted lessonId cannot pull paid content into the prompt.
       Entitlement = enrolled in the course, or the lesson is a free preview
       (mirrors the transcript guard in lessons.routes.ts).
       Module gate — mirrors the booking route and the live-class gate. Note:
       blockedLessons actually stores section/module IDs (legacy misnomer). */
    if (lessonId && Types.ObjectId.isValid(lessonId)) {
      const lesson   = await LessonModel.findById(lessonId).lean().exec()
      const enrolled = lesson ? await this.enrollRepo.findByUserCourse(userId, lesson.courseId) : null
      const blockedIds = (enrolled?.blockedLessons ?? []).map(bid => String(bid))
      const blocked    = !!lesson?.sectionId && blockedIds.includes(String(lesson.sectionId))
      if (lesson && (enrolled || lesson.isFree) && !blocked) {
        parts.push(`Current lesson: "${lesson.title}" (${lesson.type})`)
        if (lesson.contentBody) parts.push(`Lesson notes: ${lesson.contentBody.slice(0, 600)}`)
      }
    }

    /* Resolve course */
    const slug = courseSlug?.trim()
    if (slug) {
      const course = await CourseModel
        .findOne({ slug })
        .select('title description level tags')
        .lean()
        .exec()
      if (course) {
        parts.push(`Course: "${course.title}"`)
        if (course.description) parts.push(`Course description: ${course.description}`)
        if (course.level)       parts.push(`Level: ${course.level}`)
        if (course.tags?.length) parts.push(`Topics: ${course.tags.join(', ')}`)
      }
    }

    return parts.length > 0
      ? `Context:\n${parts.join('\n')}`
      : 'No specific course context is available for this session.'
  }
}
