import { Types } from 'mongoose'
import { QuizRepository } from '@/repositories/quiz.repository.ts'
import { QuizAttemptRepository } from '@/repositories/quizAttempt.repository.ts'
import { EnrollmentRepository } from '@/repositories/enrollment.repository.ts'
import { LessonModel, type IQuiz, type IQuizQuestion } from '@/models/schema.ts'
import type { QuestionType } from '@/types/index.ts'

export class QuizError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'QuizError'
  }
}

export interface QuizQuestionDto {
  text:          string
  type:          QuestionType
  choices:       string[]
  correctAnswer: string
  points?:       number
  explanation?:  string
}

export interface UpsertQuizDto {
  passPercent?: number
  timeLimit?:   number
  questions:    QuizQuestionDto[]
}

export interface SubmitAnswerDto {
  questionId: string
  answer:     string
}

export class QuizService {
  private readonly quizRepo    = new QuizRepository()
  private readonly attemptRepo = new QuizAttemptRepository()
  private readonly enrollRepo  = new EnrollmentRepository()

  /* The Quiz model carries no per-quiz attempt limit, so this service-wide
     constant caps every quiz. Unlimited submissions let a student brute-force
     the answer key one choice-index at a time. */
  private static readonly MAX_ATTEMPTS = 5

  /* ── Access: caller must be enrolled in the owning course ── */
  private async assertEnrolled(userId: string, courseId: Types.ObjectId | string): Promise<void> {
    const enrolled = await this.enrollRepo.findByUserCourse(userId, courseId)
    if (!enrolled) throw new QuizError('NOT_ENROLLED', 'You must be enrolled in this course', 403)
  }

  /* ── Admin: get quiz for a lesson (or null if none) ── */
  async getByLesson(lessonId: string): Promise<IQuiz | null> {
    return this.quizRepo.findByLesson(lessonId)
  }

  /* ── Admin: create/replace quiz for a lesson ─────── */
  async upsert(lessonId: string, dto: UpsertQuizDto): Promise<IQuiz> {
    const lesson = await LessonModel.findById(lessonId).exec()
    if (!lesson) throw new QuizError('LESSON_NOT_FOUND', 'Lesson not found', 404)
    if (lesson.type !== 'quiz') throw new QuizError('WRONG_TYPE', 'Lesson must be type "quiz"', 400)
    this.validateQuestions(dto.questions)

    return this.quizRepo.upsertForLesson(lessonId, lesson.courseId.toString(), {
      passPercent: dto.passPercent ?? 70,
      timeLimit:   dto.timeLimit,
      questions:   dto.questions.map(q => ({
        _id:           new Types.ObjectId(),
        text:          q.text.trim(),
        type:          q.type,
        choices:       q.choices,
        correctAnswer: q.correctAnswer,
        points:        q.points ?? 1,
        explanation:   q.explanation,
      })) as IQuizQuestion[],
    })
  }

  /* ── Admin: delete quiz (called when lesson is deleted) ── */
  async deleteByLesson(lessonId: string): Promise<void> {
    await this.quizRepo.deleteByLesson(lessonId)
  }

  /* ── Student: submit quiz attempt ─────────────────── */
  async submit(
    userId: string,
    lessonId: string,
    answers: SubmitAnswerDto[],
  ): Promise<{
    score:        number
    maxScore:     number
    scorePercent: number
    passed:       boolean
    attempt:      number
    breakdown:    Array<{ questionId: string; correct: boolean; correctAnswer?: string; points: number; explanation?: string }>
  }> {
    const quiz = await this.quizRepo.findByLesson(lessonId)
    if (!quiz) throw new QuizError('QUIZ_NOT_FOUND', 'No quiz found for this lesson', 404)
    await this.assertEnrolled(userId, quiz.courseId)

    /* Enforce the attempt cap BEFORE scoring so a rejected submission is never recorded. */
    const attemptCount = await this.attemptRepo.countByUserQuiz(userId, quiz.id)
    if (attemptCount >= QuizService.MAX_ATTEMPTS) {
      throw new QuizError(
        'ATTEMPT_LIMIT_REACHED',
        `You have used all ${QuizService.MAX_ATTEMPTS} attempts for this quiz`,
        403,
      )
    }

    const answerMap = new Map(answers.map(a => [a.questionId, a.answer]))
    let score    = 0
    const maxScore = quiz.questions.reduce((sum, q) => sum + q.points, 0)
    const breakdown: Array<{ questionId: string; correct: boolean; correctAnswer: string; points: number; explanation?: string }> = []

    for (const q of quiz.questions) {
      const qid     = q._id.toString()
      const given   = answerMap.get(qid) ?? ''
      let correct   = false

      if (q.type === 'short') {
        correct = given.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()
      } else {
        correct = given === q.correctAnswer
      }

      if (correct) score += q.points
      breakdown.push({ questionId: qid, correct, correctAnswer: q.correctAnswer, points: q.points, explanation: q.explanation })
    }

    const scorePercent = maxScore === 0 ? 0 : Math.round((score / maxScore) * 100)
    const passed       = scorePercent >= quiz.passPercent

    await this.attemptRepo.create({
      userId:        new Types.ObjectId(userId) as any,
      quizId:        new Types.ObjectId(quiz.id) as any,
      lessonId:      new Types.ObjectId(lessonId) as any,
      courseId:      quiz.courseId as any,
      answers:       answers.map(a => ({ questionId: a.questionId, answer: a.answer })),
      score,
      maxScore,
      scorePercent,
      passed,
      attemptNumber: attemptCount + 1,
      completedAt:   new Date(),
    } as any)

    /* A failed attempt returns the aggregate only. Per-question `correct` flags are
       themselves an oracle: submitting every choice index in turn reveals the whole
       answer key in as many attempts as a question has choices. */
    return {
      score,
      maxScore,
      scorePercent,
      passed,
      attempt: attemptCount + 1,
      breakdown: passed ? breakdown : [],
    }
  }

  /* ── Student: quiz summary (for resume / retry UI) ─ */
  async getSummary(userId: string, lessonId: string): Promise<{
    hasAttempted: boolean
    bestScore:    number | null
    passed:       boolean
    attempts:     number
    passPercent:  number
    timeLimit:    number | null
    questionCount: number
  }> {
    const quiz = await this.quizRepo.findByLesson(lessonId)
    if (!quiz) throw new QuizError('QUIZ_NOT_FOUND', 'No quiz found for this lesson', 404)

    const best     = await this.attemptRepo.bestAttempt(userId, quiz.id)
    const attempts = await this.attemptRepo.countByUserQuiz(userId, quiz.id)
    return {
      hasAttempted:  attempts > 0,
      bestScore:     best?.scorePercent ?? null,
      passed:        best?.passed ?? false,
      attempts,
      passPercent:   quiz.passPercent,
      timeLimit:     quiz.timeLimit ?? null,
      questionCount: quiz.questions.length,
    }
  }

  /* ── Student: get quiz questions (hide correctAnswer + explanation) ─ */
  async getForStudent(userId: string, lessonId: string): Promise<{
    id:          string
    passPercent: number
    timeLimit:   number | null
    questions:   Array<{ id: string; text: string; type: QuestionType; choices: string[]; points: number }>
  }> {
    const quiz = await this.quizRepo.findByLesson(lessonId)
    if (!quiz) throw new QuizError('QUIZ_NOT_FOUND', 'No quiz found for this lesson', 404)
    await this.assertEnrolled(userId, quiz.courseId)
    return {
      id:          quiz.id,
      passPercent: quiz.passPercent,
      timeLimit:   quiz.timeLimit ?? null,
      questions:   quiz.questions.map(q => ({
        id:      q._id.toString(),
        text:    q.text,
        type:    q.type,
        choices: q.choices,
        points:  q.points,
      })),
    }
  }

  /* ── Admin: analytics per course ─────────────────── */
  async analyticsForCourse(courseId: string) {
    return this.attemptRepo.analyticsForCourse(courseId)
  }

  /* ── Validation ───────────────────────────────────── */
  private validateQuestions(questions: QuizQuestionDto[]): void {
    if (questions.length === 0) throw new QuizError('NO_QUESTIONS', 'Quiz must have at least 1 question', 400)
    for (const q of questions) {
      if (!q.text?.trim()) throw new QuizError('INVALID_QUESTION', 'Question text is required', 400)
      if (q.type === 'mcq') {
        if (!q.choices || q.choices.length < 2) {
          throw new QuizError('INVALID_CHOICES', 'MCQ questions need ≥2 choices', 400)
        }
        const idx = parseInt(q.correctAnswer, 10)
        if (isNaN(idx) || idx < 0 || idx >= q.choices.length) {
          throw new QuizError('INVALID_ANSWER', `correctAnswer for MCQ must be a valid choice index (0–${q.choices.length - 1})`, 400)
        }
      }
      if (q.type === 'true_false') {
        if (!['0', '1'].includes(q.correctAnswer)) {
          throw new QuizError('INVALID_ANSWER', 'correctAnswer for true/false must be "0" (True) or "1" (False)', 400)
        }
      }
    }
  }
}
