/**
 * export-course.ts — dump full course data (course + sections + nested lessons
 * + quizzes + assignments) to JSON files. READ ONLY — never writes to the DB.
 *
 *   EXPORT_DB_URL=mongodb://localhost:27017/lms \
 *   OUT_DIR=/tmp/out \
 *   bun src/scripts/export-course.ts "AI Academy"
 *
 * Any argv words are treated as title search terms (case-insensitive regex).
 * Defaults to "AI Academy" when none are given. Every matching course is
 * written to <OUT_DIR>/course-<slug>.json.
 */
import mongoose from 'mongoose'
import { writeFileSync, mkdirSync } from 'node:fs'
import {
  CourseModel, SectionModel, LessonModel, QuizModel, AssignmentModel,
} from '@/models/schema.ts'

const DB_URL  = process.env.EXPORT_DB_URL || process.env.DATABASE_URL || 'mongodb://localhost:27017/lms'
const OUT_DIR = process.env.OUT_DIR || process.cwd()
const terms   = process.argv.slice(2).filter(a => !a.startsWith('--'))
const SEARCH  = terms.length ? terms : ['AI Academy']

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  await mongoose.connect(DB_URL)
  const safeHost = DB_URL.replace(/\/\/[^@]*@/, '//***@')
  console.log(`🔌 Connected: ${safeHost}`)
  console.log(`🔎 Search terms: ${SEARCH.map(t => `"${t}"`).join(', ')}\n`)

  if (process.argv.includes('--dbs')) {
    const admin = mongoose.connection.getClient().db().admin()
    const { databases } = await admin.listDatabases()
    console.log('\nDatabases on this server:')
    for (const d of databases) console.log(`  • ${d.name}`)
    /* Also peek at learning paths & categories in the current DB */
    const { LearningPathModel, CategoryModel } = await import('@/models/schema.ts')
    const paths = await LearningPathModel.find({}).select('title slug').lean()
    const cats  = await CategoryModel.find({}).select('name slug').lean()
    console.log(`\nLearningPaths in "${mongoose.connection.name}": ${paths.length}`)
    for (const p of paths as Array<{ title?: string }>) console.log(`  • ${p.title}`)
    console.log(`Categories: ${cats.map((c: { name?: string }) => c.name).join(', ')}`)
    await mongoose.disconnect()
    process.exit(0)
  }

  if (process.argv.includes('--list')) {
    const all = await CourseModel.find({}).select('title slug program status').sort({ title: 1 }).lean()
    console.log(`\n${all.length} course(s) total:`)
    for (const c of all as Array<{ title?: string; slug?: string; program?: string; status?: string }>) {
      console.log(`  • ${c.title}  [slug=${c.slug}, program=${c.program ?? '-'}, status=${c.status}]`)
    }
    await mongoose.disconnect()
    process.exit(0)
  }

  const seen = new Set<string>()
  let written = 0

  for (const term of SEARCH) {
    const courses = await CourseModel.find({ title: { $regex: term, $options: 'i' } }).lean()
    console.log(`"${term}" → ${courses.length} course(s)`)

    for (const c of courses) {
      const id = String((c as { _id: unknown })._id)
      if (seen.has(id)) continue
      seen.add(id)

      const [sections, lessons, quizzes, assignments] = await Promise.all([
        SectionModel.find({ courseId: id }).sort({ order: 1 }).lean(),
        LessonModel.find({ courseId: id }).sort({ order: 1 }).lean(),
        QuizModel.find({ courseId: id }).lean(),
        AssignmentModel.find({ courseId: id }).lean(),
      ])

      const lessonsOf = (sid: unknown) =>
        lessons.filter(l => String((l as { sectionId?: unknown }).sectionId) === String(sid))

      const data = {
        _meta: {
          exportedAt: new Date().toISOString(),
          source:     safeHost,
          counts: {
            sections: sections.length,
            lessons: lessons.length,
            quizzes: quizzes.length,
            assignments: assignments.length,
          },
        },
        course:   c,
        sections: sections.map(s => ({ ...s, lessons: lessonsOf((s as { _id: unknown })._id) })),
        /* Lessons with no/unknown sectionId (shouldn't normally happen) */
        orphanLessons: lessons.filter(l => {
          const sid = String((l as { sectionId?: unknown }).sectionId)
          return !sections.some(s => String((s as { _id: unknown })._id) === sid)
        }),
        quizzes,
        assignments,
      }

      const slug = (c as { slug?: string }).slug || id
      const file = `${OUT_DIR}/course-${slug}.json`
      writeFileSync(file, JSON.stringify(data, null, 2))
      written++
      console.log(`   ✅ ${(c as { title?: string }).title}`)
      console.log(`      → ${file}  (${sections.length} sections, ${lessons.length} lessons)`)
    }
  }

  console.log(`\nDone. Wrote ${written} file(s).`)
  await mongoose.disconnect()
  process.exit(0)
}

main().catch(err => { console.error('export failed:', err); process.exit(1) })
