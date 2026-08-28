/* ─────────────────────────────────────────────────────
   Verify the BACKUP mailbox can actually send.

   Builds the backup transport from exactly the same env keys the email
   service uses (SMTP_BACKUP_*), verifies the SMTP handshake, then sends one
   real message so delivery is proven end to end rather than assumed.

   The primary mailbox is never touched.

   Usage:  bun run verify-backup-mail <recipient>
───────────────────────────────────────────────────── */
import nodemailer from 'nodemailer'

const to = process.argv[2]
if (!to) {
  console.error('Usage: bun run verify-backup-mail <recipient@example.com>')
  process.exit(1)
}

const host = process.env['SMTP_BACKUP_HOST']
const port = Number(process.env['SMTP_BACKUP_PORT'] ?? 587)
const user = process.env['SMTP_BACKUP_USER']
const pass = process.env['SMTP_BACKUP_PASS']
const from = process.env['SMTP_BACKUP_EMAIL_FROM'] ?? process.env['EMAIL_FROM']

const missing = Object.entries({ SMTP_BACKUP_HOST: host, SMTP_BACKUP_USER: user, SMTP_BACKUP_PASS: pass })
  .filter(([, v]) => !v).map(([k]) => k)
if (missing.length) {
  console.error(`Backup mailbox is not configured — missing: ${missing.join(', ')}`)
  process.exit(2)
}

const secure = process.env['SMTP_BACKUP_SECURE']
  ? process.env['SMTP_BACKUP_SECURE'] === 'true'
  : port === 465

console.log(`Backup mailbox : ${user}`)
console.log(`From header    : ${from}`)
console.log(`Server         : ${host}:${port} (secure=${secure})`)
console.log(`Recipient      : ${to}\n`)

const transporter = nodemailer.createTransport({ host, port, secure, auth: { user: user!, pass: pass! } })

try {
  await transporter.verify()
  console.log('✓ SMTP handshake + credentials accepted')
} catch (err) {
  console.error('✗ SMTP verify FAILED — the backup would not work in a failover')
  console.error(err)
  process.exit(3)
}

const stamp = new Date().toISOString()
try {
  const info = await transporter.sendMail({
    from,
    to,
    subject: `Delta LMS — backup mailbox test (${stamp})`,
    text: [
      'This message was sent by the BACKUP mailbox, not the primary one.',
      '',
      `Backup account : ${user}`,
      `From header    : ${from}`,
      `Sent at        : ${stamp}`,
      '',
      'If you are reading this, failover will work when the primary mailbox',
      'reaches its daily sending limit.',
    ].join('\n'),
    html: `
      <div style="font-family:system-ui,Segoe UI,sans-serif;max-width:520px;line-height:1.6">
        <h2 style="margin:0 0 8px">Backup mailbox test</h2>
        <p style="margin:0 0 16px;color:#444">
          This message was sent by the <strong>backup</strong> mailbox, not the primary one.
        </p>
        <table style="border-collapse:collapse;font-size:14px">
          <tr><td style="padding:4px 12px 4px 0;color:#666">Backup account</td><td><code>${user}</code></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666">From header</td><td><code>${from}</code></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666">Sent at</td><td><code>${stamp}</code></td></tr>
        </table>
        <p style="margin:16px 0 0;color:#444">
          If you are reading this, failover will work when the primary mailbox
          reaches its daily sending limit.
        </p>
      </div>`,
  })

  console.log('✓ Message accepted by the server')
  console.log(`  messageId : ${info.messageId}`)
  console.log(`  accepted  : ${JSON.stringify(info.accepted)}`)
  console.log(`  rejected  : ${JSON.stringify(info.rejected)}`)
  console.log(`  response  : ${info.response}`)
  if ((info.rejected ?? []).length > 0) process.exit(4)
} catch (err) {
  console.error('✗ SEND FAILED')
  console.error(err)
  process.exit(5)
} finally {
  transporter.close()
}

console.log('\nBackup mailbox is working.')
