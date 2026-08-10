import mongoose from 'mongoose'
import bcrypt from 'bcrypt'

const MONGO_URI = process.env.DATABASE_URL ?? 'mongodb://localhost:27017/lms'
const EMAIL     = process.env.SUPERADMIN_EMAIL
const PASSWORD  = process.env.SUPERADMIN_PASSWORD
const NAME      = process.env.SUPERADMIN_NAME ?? 'Super Admin'
/* Re-running must not silently reset an existing super-admin's password.
   Set SUPERADMIN_RESET_PASSWORD=true to deliberately rotate it. */
const RESET_PASSWORD = process.env.SUPERADMIN_RESET_PASSWORD === 'true'

/* Credentials are supplied per-environment — never hardcoded. */
if (!EMAIL || !PASSWORD) {
  console.error('❌ SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD must both be set.')
  console.error('   Example: SUPERADMIN_EMAIL=you@example.com SUPERADMIN_PASSWORD=... bun src/scripts/create-super-admin.ts')
  process.exit(1)
}

if (PASSWORD.length < 12) {
  console.error('❌ SUPERADMIN_PASSWORD must be at least 12 characters.')
  process.exit(1)
}

async function main() {
  await mongoose.connect(MONGO_URI)
  console.log('Connected to MongoDB')

  const passwordHash = await bcrypt.hash(PASSWORD!, 12)

  const result = await mongoose.connection.collection('users').updateOne(
    { email: EMAIL },
    {
      $set: {
        name:             NAME,
        email:            EMAIL,
        role:             'super_admin',
        isVerified:       true,
        isActive:         true,
        enrollmentStatus: 'approved',
        provider:         'local',
        updatedAt:        new Date(),
        /* Only overwrite an existing password when explicitly asked to. */
        ...(RESET_PASSWORD ? { passwordHash } : {}),
      },
      $setOnInsert: {
        createdAt: new Date(),
        ...(RESET_PASSWORD ? {} : { passwordHash }),
      },
    },
    { upsert: true },
  )

  if (result.upsertedCount > 0) {
    console.log(`✅ Super admin created: ${EMAIL}`)
  } else {
    console.log(`✅ Super admin updated: ${EMAIL}`)
  }

  await mongoose.disconnect()
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
