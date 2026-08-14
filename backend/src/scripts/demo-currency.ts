/* Fixtures for the per-academy currency work: one paid course in each academy
   so the admin panel has something to price. Titles carry `demo-cur`;
   --clean removes exactly those. */
import mongoose from 'mongoose'
import { env } from '@/config/env.ts'
import { CourseModel, OrganizationModel, UserModel } from '@/models/schema.ts'
import { hashPassword } from '@/utils/hash.ts'

const TAG = 'demo-cur'
const ADMIN = 'demo-cur-admin@delta.local'
const clean = process.argv.includes('--clean')

await mongoose.connect(env.DATABASE_URL)
await CourseModel.deleteMany({ title: new RegExp(TAG) })
await UserModel.deleteMany({ email: ADMIN })

if (!clean) {
  const instructor = await UserModel.findOne({ role: 'instructor' }).select('_id').lean()
  await UserModel.create({
    name: 'Currency Demo Admin', email: ADMIN,
    passwordHash: await hashPassword('DemoAssign1'),
    role: 'super_admin', isActive: true, isEmailVerified: true,
  })
  for (const org of await OrganizationModel.find().lean()) {
    const slug = (org as any).slug
    for (const [i, price] of [79.99, 149].entries()) {
      await CourseModel.create({
        title: `${slug === 'dubai' ? 'Dubai' : 'Bangalore'} Paid Course ${i + 1} (${TAG})`,
        slug: `${TAG}-${slug}-${i}-${Date.now()}`,
        description: 'Fixture course for the per-academy currency display.',
        price, isFree: false, status: 'published', language: 'English',
        level: 'beginner', instructorId: instructor?._id, organizationId: org._id,
      })
    }
  }
  console.log(`created ${ADMIN} / DemoAssign1 and 2 paid courses per academy`)
} else {
  console.log('removed demo-cur fixtures')
}
await mongoose.disconnect()
