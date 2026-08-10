/**
 * Database seed script.
 * Run with: bun run seed
 *
 * Wipes the database and populates:
 *   1 admin, 2 instructors, 6 categories,
 *   ~10 published courses, each with 3-5 sections × 4-8 lessons.
 */
import 'dotenv/config'
import mongoose from 'mongoose'
import { env } from '@/config/env.ts'
import {
  UserModel, CategoryModel, CourseModel,
  SectionModel, LessonModel,
} from '@/models/schema.ts'
import { hashPassword } from '@/utils/hash.ts'

/* ─── Environment guard ─────────────────────────────────────────
   This script DELETES every user, course, enrolment, order and review
   before repopulating. It is a local-development tool, and the fallback
   credentials below are published in a public repository — so it must
   never run against a deployed database.

   SEED_ALLOW_WIPE=true overrides the refusal, for a disposable staging
   box where wiping is the intent.
──────────────────────────────────────────────────────────────── */
if (env.NODE_ENV === 'production' && process.env['SEED_ALLOW_WIPE'] !== 'true') {
  console.error('❌  Refusing to seed: NODE_ENV=production.')
  console.error('    `bun run seed` deletes every user, course, enrolment and order.')
  console.error('    Set SEED_ALLOW_WIPE=true only if this database is disposable.')
  process.exit(1)
}

/* ─── Sample data ─────────────────────────────────────
   Credentials fall back to the published dev defaults so `bun run seed`
   keeps working with no setup. Override them via the environment for any
   database that is reachable by anyone but you. */
const SEEDED_FROM_ENV = !!(process.env['SEED_ADMIN_PASSWORD'] ?? process.env['SEED_INSTRUCTOR_PASSWORD'])

const ADMIN = {
  name: 'LMS Admin',
  email:    process.env['SEED_ADMIN_EMAIL']    ?? 'admin@lms.local',
  password: process.env['SEED_ADMIN_PASSWORD'] ?? 'Admin1234',
}

const INSTRUCTOR_PASSWORD = process.env['SEED_INSTRUCTOR_PASSWORD'] ?? 'Student1234'

const INSTRUCTORS = [
  { name: 'Sarah Chen',   email: 'sarah@lms.local',   password: INSTRUCTOR_PASSWORD,
    headline: 'Senior product designer · 12y',
    bio: 'Former design lead at notable consumer products. Teaches design systems and user research.',
    avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200' },
  { name: 'Alex Kim',     email: 'alex@lms.local',    password: INSTRUCTOR_PASSWORD,
    headline: 'Full-stack engineer · React + TypeScript',
    bio: 'Engineer with a focus on TypeScript, React, and modern frontend tooling.',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200' },
]

const CATEGORIES = [
  { name: 'Design',        slug: 'design',        description: 'UI/UX, visual design, design systems', icon: '🎨' },
  { name: 'Development',   slug: 'development',   description: 'Web, mobile, and systems programming', icon: '💻' },
  { name: 'Data Science',  slug: 'data-science',  description: 'Analytics, ML, and statistics',         icon: '📊' },
  { name: 'Business',      slug: 'business',      description: 'Entrepreneurship, finance, and ops',    icon: '💼' },
  { name: 'Marketing',     slug: 'marketing',     description: 'Growth, SEO, and content',              icon: '📣' },
  { name: 'Personal Dev',  slug: 'personal-dev',  description: 'Productivity and soft skills',          icon: '🌱' },
]

const COURSES = [
  { title: 'UI/UX Design Mastery',           slug: 'ui-ux-design-mastery',     categorySlug: 'design',       instructor: 0, price: 49.99, isFree: false, level: 'intermediate', tags: ['design', 'figma', 'ux'],         thumb: 'https://images.unsplash.com/photo-1558655146-364adaf1fcc9?w=800' },
  { title: 'TypeScript from Zero to Hero',   slug: 'typescript-zero-hero',     categorySlug: 'development',  instructor: 1, price: 0,     isFree: true,  level: 'beginner',     tags: ['typescript', 'javascript'],      thumb: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=800' },
  { title: 'React Advanced Patterns',        slug: 'react-advanced-patterns',  categorySlug: 'development',  instructor: 1, price: 0,     isFree: true,  level: 'advanced',     tags: ['react', 'patterns'],             thumb: 'https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=800' },
  { title: 'Python for Data Science',        slug: 'python-data-science',      categorySlug: 'data-science', instructor: 1, price: 69.99, isFree: false, level: 'beginner',     tags: ['python', 'data-science', 'ml'],  thumb: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800' },
  { title: 'Full-Stack Next.js 15',          slug: 'fullstack-nextjs-15',      categorySlug: 'development',  instructor: 1, price: 0,     isFree: true,  level: 'intermediate', tags: ['nextjs', 'react', 'fullstack'],  thumb: 'https://images.unsplash.com/photo-1555066931-4365d14431b9?w=800' },
  { title: 'Brand Identity Design',          slug: 'brand-identity-design',    categorySlug: 'design',       instructor: 0, price: 44.99, isFree: false, level: 'beginner',     tags: ['branding', 'design', 'logo'],    thumb: 'https://images.unsplash.com/photo-1626785774625-ddcddc3445e9?w=800' },
  { title: 'Design Systems in Figma',        slug: 'design-systems-figma',     categorySlug: 'design',       instructor: 0, price: 0,     isFree: true,  level: 'intermediate', tags: ['design', 'figma'],               thumb: 'https://images.unsplash.com/photo-1611224923853-80b023f02d71?w=800' },
  { title: 'Intro to Marketing Funnels',     slug: 'marketing-funnels-intro',  categorySlug: 'marketing',    instructor: 0, price: 0,     isFree: true,  level: 'beginner',     tags: ['marketing', 'growth'],           thumb: 'https://images.unsplash.com/photo-1432888622747-4eb9a8f5a07d?w=800' },
  { title: 'Productivity Foundations',       slug: 'productivity-foundations', categorySlug: 'personal-dev', instructor: 1, price: 0,     isFree: true,  level: 'beginner',     tags: ['productivity', 'habits'],        thumb: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800' },
  { title: 'Financial Modeling 101',         slug: 'financial-modeling-101',   categorySlug: 'business',     instructor: 1, price: 79.99, isFree: false, level: 'intermediate', tags: ['finance', 'business'],           thumb: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800' },
]

/* Public test video — Big Buck Bunny (royalty-free).
   For URL-only storage, any course's lesson points at this. */
const SAMPLE_VIDEO = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'

const SECTION_TEMPLATES: { title: string; lessons: string[] }[] = [
  { title: 'Getting Started',  lessons: ['Welcome', 'Setting up your workspace', 'Course roadmap'] },
  { title: 'Core Concepts',    lessons: ['Fundamentals', 'Mental models', 'Common pitfalls', 'Worked example'] },
  { title: 'Going Deeper',     lessons: ['Advanced patterns', 'Edge cases', 'Performance', 'Case study'] },
  { title: 'Hands-On Project', lessons: ['Project setup', 'Implementation', 'Iteration', 'Polish & ship'] },
  { title: 'Wrap-Up',          lessons: ['Recap', 'Where to go next'] },
]

/* ─── Seed ──────────────────────────────────────────── */

async function seed() {
  console.log('🌱  Seeding database…')
  await mongoose.connect(env.DATABASE_URL,{
    maxPoolSize:       10,
    serverSelectionTimeoutMS: 5_000,
    socketTimeoutMS:   45_000,
    connectTimeoutMS:  10_000,
    authSource: "admin"
  })

  /* 1. Wipe collections */
  await Promise.all([
    UserModel.deleteMany({}).exec(),
    CategoryModel.deleteMany({}).exec(),
    CourseModel.deleteMany({}).exec(),
    SectionModel.deleteMany({}).exec(),
    LessonModel.deleteMany({}).exec(),
  ])
  // also wipe refresh tokens, enrollments, lesson_progress, reviews if present
  for (const c of ['refreshtokens', 'enrollments', 'lessonprogresses', 'reviews']) {
    try { await mongoose.connection.db?.collection(c).deleteMany({}) } catch { /* collection may not exist yet */ }
  }
  console.log('  ✓ cleared')

  /* 2. Users */
  const adminHash = await hashPassword(ADMIN.password)
  const admin = await UserModel.create({
    name: ADMIN.name, email: ADMIN.email, passwordHash: adminHash,
    role: 'admin', isVerified: true, isActive: true,
  })

  const instructors = await Promise.all(
    INSTRUCTORS.map(async (i) => UserModel.create({
      name: i.name, email: i.email, passwordHash: await hashPassword(i.password),
      role: 'instructor', isVerified: true, isActive: true,
      headline: i.headline, bio: i.bio, avatarUrl: i.avatarUrl,
    })),
  )
  console.log(`  ✓ users: 1 admin + ${instructors.length} instructors`)

  /* 3. Categories */
  const categories = await CategoryModel.insertMany(CATEGORIES)
  const catBySlug = new Map(categories.map(c => [c.slug, c._id]))
  console.log(`  ✓ categories: ${categories.length}`)

  /* 4. Courses + sections + lessons */
  let totalSections = 0
  let totalLessons  = 0

  for (const c of COURSES) {
    const sectionCount = 3 + Math.floor(Math.random() * 3)  // 3-5 sections
    const sectionTpls  = SECTION_TEMPLATES.slice(0, sectionCount)

    // approximate duration — we'll fill in after creating lessons
    const courseDoc = await CourseModel.create({
      title: c.title,
      slug:  c.slug,
      description: `Comprehensive course on ${c.title.toLowerCase()}. Covers core concepts through hands-on projects with real-world examples.`,
      thumbnailUrl: c.thumb,
      price:        c.price,
      isFree:       c.isFree,
      status:       'published',
      level:        c.level,
      language:     'English',
      tags:         c.tags,
      instructorId: instructors[c.instructor]!._id,
      categoryId:   catBySlug.get(c.categorySlug),
      durationMins: 0,
      enrolledCount: Math.floor(Math.random() * 3000),
      ratingAvg:    0,
      ratingCount:  0,
    })

    let courseDuration = 0

    for (let si = 0; si < sectionTpls.length; si++) {
      const tpl = sectionTpls[si]!
      const section = await SectionModel.create({
        courseId: courseDoc._id,
        title:    tpl.title,
        order:    si,
      })
      totalSections++

      for (let li = 0; li < tpl.lessons.length; li++) {
        const dur = 5 + Math.floor(Math.random() * 18)  // 5-22 mins
        await LessonModel.create({
          sectionId:    section._id,
          courseId:     courseDoc._id,
          title:        tpl.lessons[li]!,
          type:         'video',
          contentUrl:   SAMPLE_VIDEO,
          durationMins: dur,
          order:        li,
          isFree:       si === 0 && li === 0,  // first lesson is a free preview
        })
        totalLessons++
        courseDuration += dur
      }
    }

    await CourseModel.updateOne({ _id: courseDoc._id }, { $set: { durationMins: courseDuration } }).exec()
  }
  console.log(`  ✓ courses: ${COURSES.length} (${totalSections} sections, ${totalLessons} lessons)`)

  await mongoose.disconnect()
  console.log('🌱  Done.\n')
  if (SEEDED_FROM_ENV) {
    console.log(`   Admin login:      ${ADMIN.email}   / (from SEED_ADMIN_PASSWORD)`)
    console.log('   Instructor login: sarah@lms.local   / (from SEED_INSTRUCTOR_PASSWORD)')
  } else {
    console.log(`   Admin login:      ${ADMIN.email}      / ${ADMIN.password}`)
    console.log(`   Instructor login: sarah@lms.local      / ${INSTRUCTOR_PASSWORD}`)
  }
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
