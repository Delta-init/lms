/**
 * send-invite.ts — email a Delta AI Academy invitation + one-click login link
 * into the LMS. The link signs the recipient in and forwards them to a course.
 *
 *   bun src/scripts/send-invite.ts <email> [nextPath] [courseName]
 *
 * Examples:
 *   # default → lands on /my-learning
 *   bun src/scripts/send-invite.ts absharameen625@gmail.com
 *   # straight into the English course interface
 *   bun src/scripts/send-invite.ts absharameen625@gmail.com /courses/ai-academy-english "AI Academy (English)"
 *
 * Creates a passwordless account if the email has none. Requires SMTP to
 * actually deliver; without it the link is still minted and printed.
 */
import '@/config/timezone.ts'
import 'dotenv/config'
import { connectDatabase, disconnectDatabase } from '@/config/database.ts'
import { AuthService } from '@/services/auth.service.ts'
import { logger } from '@/utils/logger.ts'

const [email, nextPath, courseName] = process.argv.slice(2)
if (!email) {
  console.error('usage: bun src/scripts/send-invite.ts <email> [nextPath] [courseName]')
  process.exit(1)
}

async function main() {
  await connectDatabase()
  const auth = new AuthService()
  const { link, created } = await auth.inviteToCourse(email!, {
    next: nextPath || '/courses/ai-academy-english',
    courseName: courseName || 'AI Academy (English)',
  })
  logger.info({ email, created }, 'invite processed')
  console.log(`\n${email}  ${created ? '(new account created)' : '(existing account)'}`)
  console.log(`link: ${link}\n`)
  await disconnectDatabase()
  process.exit(0)
}
main().catch(err => { console.error('send-invite failed:', err); process.exit(1) })
