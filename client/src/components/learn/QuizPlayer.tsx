'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, XCircle, Clock, Trophy, RotateCcw, ChevronRight } from 'lucide-react'
import { useStudentQuiz, useQuizSummary, useSubmitQuiz, type QuizQuestion, type SubmitQuizResult } from '@/lib/api/quizzes'
import Spinner from '@/components/ui/Spinner'

interface Props {
  lessonId: string
  onPassed?: () => void  // callback when quiz is passed (e.g. navigate to next lesson)
}

type Phase = 'summary' | 'taking' | 'result'

export function QuizPlayer({ lessonId, onPassed }: Props) {
  const { data: quiz,    isLoading: quizLoading }    = useStudentQuiz(lessonId)
  const { data: summary, isLoading: summaryLoading } = useQuizSummary(lessonId)
  const submit = useSubmitQuiz(lessonId)

  const [phase,   setPhase]   = useState<Phase>('summary')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result,  setResult]  = useState<SubmitQuizResult | null>(null)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /* Start timer when taking phase begins */
  useEffect(() => {
    if (phase === 'taking' && quiz?.timeLimit) {
      setTimeLeft(quiz.timeLimit * 60)
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev === null || prev <= 1) {
            clearInterval(timerRef.current!)
            void handleSubmit()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const handleSubmit = async () => {
    if (!quiz) return
    const answerList = quiz.questions.map(q => ({
      questionId: q.id,
      answer:     answers[q.id] ?? '',
    }))
    const res = await submit.mutateAsync(answerList)
    setResult(res)
    setPhase('result')
    if (res.passed) onPassed?.()
  }

  const startQuiz = () => {
    setAnswers({})
    setResult(null)
    setPhase('taking')
  }

  if (quizLoading || summaryLoading) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-2xl bg-[var(--color-bg-muted)]">
        <Spinner size={24} />
      </div>
    )
  }

  if (!quiz) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-2xl bg-[var(--color-bg-muted)]">
        <p className="text-sm text-[var(--color-text-muted)]">No quiz found for this lesson.</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-[var(--color-bg-surface)]" style={{ borderColor: 'var(--color-border)' }}>
      <AnimatePresence mode="wait">
        {phase === 'summary' && (
          <SummaryPanel key="summary" quiz={quiz} summary={summary} onStart={startQuiz} />
        )}
        {phase === 'taking' && (
          <TakingPanel key="taking" quiz={quiz} answers={answers} timeLeft={timeLeft}
            onAnswer={(qid, ans) => setAnswers(prev => ({ ...prev, [qid]: ans }))}
            onSubmit={handleSubmit} isPending={submit.isPending} />
        )}
        {phase === 'result' && result && (
          <ResultPanel key="result" result={result} passPercent={quiz.passPercent}
            onRetry={startQuiz} />
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─── Summary panel (before attempt) ─────────────── */
function SummaryPanel({ quiz, summary, onStart }: {
  quiz:    { passPercent: number; timeLimit: number | null; questions: QuizQuestion[] }
  summary: { hasAttempted: boolean; bestScore: number | null; passed: boolean; attempts: number } | undefined
  onStart: () => void
}) {
  const hasPassed = summary?.passed ?? false

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="p-8 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl mx-auto"
        style={{ background: hasPassed ? 'rgba(34,197,94,0.10)' : 'rgba(0,87,184,0.10)' }}>
        <Trophy size={28} style={{ color: hasPassed ? '#22C55E' : '#0057b8' }} />
      </div>

      <h2 className="mb-1 text-xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
        {hasPassed ? 'Quiz completed!' : 'Ready for the quiz?'}
      </h2>
      <p className="mb-6 text-sm" style={{ color: 'var(--color-text-muted)' }}>
        {quiz.questions.length} questions · Pass at {quiz.passPercent}%
        {quiz.timeLimit ? ` · ${quiz.timeLimit} min limit` : ''}
      </p>

      {summary?.hasAttempted && (
        <div className="mb-6 inline-flex items-center gap-4 rounded-2xl px-6 py-3"
          style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}>
          <div>
            <p className="text-[11px] uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Best score</p>
            <p className="text-lg font-bold" style={{ color: hasPassed ? '#22C55E' : '#EF4444' }}>
              {summary.bestScore?.toFixed(0) ?? 0}%
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Attempts</p>
            <p className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>{summary.attempts}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Status</p>
            <p className="text-sm font-bold" style={{ color: hasPassed ? '#22C55E' : '#F59E0B' }}>
              {hasPassed ? '✓ Passed' : 'Not yet'}
            </p>
          </div>
        </div>
      )}

      <button onClick={onStart}
        className="inline-flex items-center gap-2 rounded-xl px-8 py-3 text-sm font-bold text-white"
        style={{ background: 'var(--color-primary)' }}>
        {summary?.hasAttempted ? <><RotateCcw size={14} />Retry quiz</> : <><ChevronRight size={14} />Start quiz</>}
      </button>
    </motion.div>
  )
}

/* ─── Taking panel ────────────────────────────────── */
function TakingPanel({ quiz, answers, timeLeft, onAnswer, onSubmit, isPending }: {
  quiz:      { passPercent: number; questions: QuizQuestion[] }
  answers:   Record<string, string>
  timeLeft:  number | null
  onAnswer:  (qid: string, ans: string) => void
  onSubmit:  () => void
  isPending: boolean
}) {
  const answered = Object.keys(answers).filter(k => answers[k] !== '').length

  const fmtTime = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  const timeWarn = timeLeft !== null && timeLeft < 60

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {answered}/{quiz.questions.length} answered
        </p>
        {timeLeft !== null && (
          <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold"
            style={{ background: timeWarn ? 'rgba(239,68,68,0.08)' : 'var(--color-bg-subtle)', color: timeWarn ? '#EF4444' : 'var(--color-text-secondary)' }}>
            <Clock size={13} />
            {fmtTime(timeLeft)}
          </div>
        )}
        {/* Progress bar */}
        <div className="h-1.5 w-32 overflow-hidden rounded-full" style={{ background: 'var(--color-bg-subtle)' }}>
          <div className="h-full rounded-full transition-all"
            style={{ width: `${(answered / quiz.questions.length) * 100}%`, background: 'var(--color-primary)' }} />
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-6 p-6">
        {quiz.questions.map((q, qi) => (
          <QuestionItem key={q.id} question={q} index={qi} answer={answers[q.id] ?? ''} onAnswer={onAnswer} />
        ))}
      </div>

      {/* Submit */}
      <div className="border-t px-6 py-4" style={{ borderColor: 'var(--color-border)' }}>
        <button onClick={onSubmit} disabled={isPending}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-60"
          style={{ background: 'var(--color-primary)' }}>
          {isPending ? <Spinner size={14} /> : null}
          Submit quiz ({answered}/{quiz.questions.length} answered)
        </button>
      </div>
    </motion.div>
  )
}

function QuestionItem({ question: q, index, answer, onAnswer }: {
  question: QuizQuestion
  index:    number
  answer:   string
  onAnswer: (qid: string, ans: string) => void
}) {
  return (
    <div>
      <p className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{ background: 'var(--color-primary)' }}>{index + 1}</span>
        {q.text}
        {q.points > 1 && <span className="ml-2 text-[11px] font-normal" style={{ color: 'var(--color-text-muted)' }}>({q.points} pts)</span>}
      </p>

      {q.type === 'short' ? (
        <input value={answer} onChange={e => onAnswer(q.id, e.target.value)}
          placeholder="Type your answer…"
          className="w-full rounded-xl border px-4 py-2.5 text-sm text-[var(--color-text-primary)] outline-none focus:border-orange-400"
          style={{ borderColor: 'var(--color-border)' }}
        />
      ) : (
        <div className="space-y-2">
          {q.choices.map((c, ci) => {
            const val = String(ci)
            const chosen = answer === val
            return (
              <button key={ci} onClick={() => onAnswer(q.id, val)}
                className="flex w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left text-sm transition-colors"
                style={{
                  borderColor: chosen ? '#0057b8' : 'var(--color-border)',
                  background:  chosen ? 'rgba(0,87,184,0.06)' : 'var(--color-bg-inset)',
                  color: 'var(--color-text-secondary)',
                }}>
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors"
                  style={{ borderColor: chosen ? '#0057b8' : 'var(--color-text-muted)', background: chosen ? '#0057b8' : 'transparent' }}>
                  {chosen && <span className="h-2 w-2 rounded-full bg-[var(--color-bg-surface)]" />}
                </span>
                {c}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─── Result panel ────────────────────────────────── */
function ResultPanel({ result, passPercent, onRetry }: {
  result:      SubmitQuizResult
  passPercent: number
  onRetry:     () => void
}) {
  const pct = result.scorePercent

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-6">
      {/* Score ring */}
      <div className="mb-6 flex flex-col items-center">
        <div className="relative mb-3">
          <svg width={100} height={100}>
            <circle cx={50} cy={50} r={42} fill="none" stroke="var(--color-bg-subtle)" strokeWidth={8} />
            <motion.circle cx={50} cy={50} r={42} fill="none"
              stroke={result.passed ? '#22C55E' : '#EF4444'} strokeWidth={8}
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 42}
              initial={{ strokeDashoffset: 2 * Math.PI * 42 }}
              animate={{ strokeDashoffset: 2 * Math.PI * 42 - (pct / 100) * 2 * Math.PI * 42 }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              style={{ transformOrigin: '50% 50%', transform: 'rotate(-90deg)' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold" style={{ color: result.passed ? '#22C55E' : '#EF4444' }}>
              {pct.toFixed(0)}%
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result.passed
            ? <><CheckCircle2 size={18} style={{ color: 'var(--color-success)' }} /><span className="font-bold text-green-600">Passed!</span></>
            : <><XCircle size={18} style={{ color: 'var(--color-danger)' }} /><span className="font-bold text-red-500">Not passed</span></>}
        </div>
        <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {result.score}/{result.maxScore} points · Pass threshold: {passPercent}%
        </p>
      </div>

      {/* Breakdown */}
      <div className="mb-6 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-muted)' }}>Answer breakdown</p>
        {result.breakdown.map((b, i) => (
          <div key={b.questionId} className="flex items-start gap-3 rounded-xl p-3"
            style={{ background: b.correct ? 'rgba(34,197,94,0.05)' : 'rgba(239,68,68,0.05)', border: `1px solid ${b.correct ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}` }}>
            <span className="mt-0.5 flex-shrink-0">
              {b.correct
                ? <CheckCircle2 size={14} style={{ color: 'var(--color-success)' }} />
                : <XCircle size={14} style={{ color: 'var(--color-danger)' }} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>Question {i + 1}</p>
              {!b.correct && (
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Correct: <span className="font-semibold">{b.correctAnswer}</span>
                </p>
              )}
              {b.explanation && (
                <p className="mt-0.5 text-xs italic" style={{ color: 'var(--color-text-muted)' }}>{b.explanation}</p>
              )}
            </div>
            <span className="text-xs font-semibold" style={{ color: b.correct ? '#22C55E' : '#EF4444' }}>
              {b.correct ? `+${b.points}` : '0'}
            </span>
          </div>
        ))}
      </div>

      {!result.passed && (
        <button onClick={onRetry}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white"
          style={{ background: 'var(--color-primary)' }}>
          <RotateCcw size={14} />Try again
        </button>
      )}
    </motion.div>
  )
}
