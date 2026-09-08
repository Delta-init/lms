/**
 * provision-ai-academy-student.ts — grant a student full AI-academy access in
 * the LMS and email them a one-click login link.
 *
 * Does exactly what an AI-academy purchase does, by hand:
 *   • creates a passwordless account if the email has none,
 *   • enrols them in BOTH courses — 'ai' (Malayalam) + 'ai-academy-english',
 *   • approves the enrolment (full access, not "pending"),
 *   • puts them under the Bangalore (India) org,
 *   • emails a login link that signs them in and opens the English course.
 *
 * Idempotent on the email: re-running won't double-enrol. It DOES send a fresh
 * login link each time, so use it to (re)send the invite.
 *
 * IMPORTANT: run this on the server whose CLIENT_URL points at the real student
 * app (e.g. production), or the emailed link will be a localhost URL the
 * recipient can't use. SMTP must be configured for the mail to actually send.
 *
 *   bun src/scripts/provision-ai-academy-student.ts <email> "<name>" <phone>
 *
 * Example:
 *   bun src/scripts/provision-ai-academy-student.ts kamarudheen.pk@gmail.com "Kamarudheen P K" +971502658975
 */
import '@/config/timezone.ts'
import 'dotenv/config'
import { connectDatabase, disconnectDatabase } from '@/config/database.ts'
import { OrderService } from '@/services/order.service.ts'
import { AuthService } from '@/services/auth.service.ts'
import { logger } from '@/utils/logger.ts'

const [email, name, phone] = process.argv.slice(2)
if (!email) {
  console.error('usage: bun src/scripts/provision-ai-academy-student.ts <email> "<name>" <phone>')
  process.exit(1)
}

async function main() {
  await connectDatabase()
  const orders = new OrderService()
  const auth = new AuthService()

  // Enrol in both AI-academy courses (approved, Bangalore org). Idempotent on
  // orderId — keyed on the email so re-running is safe.
  const result = await orders.provisionExternalPurchase({
    email: email!,
    ...(name ? { name } : {}),
    ...(phone ? { phone } : {}),
    orderId: `manual:${email!.toLowerCase().trim()}`,
  })
  logger.info({ email, ...result }, 'AI-academy access provisioned')

  // Email the one-click login link — lands on the English course. A fresh link
  // is minted every run, so this doubles as "resend the invite".
  const { link } = await auth.inviteToCourse(email!, {
    next: '/courses/ai-academy-english',
    ...(name ? { name } : {}),
    courseName: 'AI Academy',
  })

  console.log(`\n✅ ${email}`)
  console.log(`   account:  ${result.created ? 'created' : 'existing'}`)
  console.log(`   enrolled: ${result.enrolled.join(', ')} (approved, Bangalore org)`)
  console.log(`   login link (also emailed): ${link}\n`)

  await disconnectDatabase()
  process.exit(0)
}

main().catch((err) => {
  console.error('provision failed:', err)
  process.exit(1)
})
