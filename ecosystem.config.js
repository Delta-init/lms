/**
 * PM2 ecosystem for Delta LMS — backend API (load-balanced)
 * ---------------------------------------------------------------------------
 * ⚠ PORT 4000 IS NOT FREE ON THE PRODUCTION HOST — it belongs to the exam
 *   tracker API (nginx: exam-api.deltadigitalacademy.com → localhost:4000).
 *   Instance 0 therefore cannot bind and crash-loops, leaving only instance 1
 *   alive — and with 4000 still listed in the `upstream lms_backend` block,
 *   nginx handed a share of LMS traffic to that other application, which
 *   answered with its own 404 pages. Move this base port to a free one and
 *   update the upstream IN THE SAME CHANGE.
 *
 * Runs N Bun fork instances on consecutive ports starting at 4000:
 *   instance 0 → :4000   (also runs the reminder cron jobs)
 *   instance 1 → :4001
 *
 * `instances` here and the `upstream lms_backend` block in nginx.lms.conf are
 * ONE setting expressed in two files. Change this number and nginx keeps
 * proxying to ports nothing is listening on — connection refused, three
 * strikes, then the port is retried every fail_timeout. Always edit both.
 *
 * nginx `upstream` (see nginx.lms.conf) round-robins across those ports.
 * Bun does NOT support PM2 cluster mode, so we use `fork` + `increment_var`.
 *
 * Install deps first:  cd backend && bun install
 *
 * Start / manage:
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup
 *   pm2 reload ecosystem.config.js   # zero-downtime rolling reload
 *   pm2 logs lms-backend
 *
 * Tune `instances` to your CPU core count (leave 1 core for nginx + mongo).
 * If PM2 can't find `bun`, set interpreter to the absolute path (`which bun`).
 */
module.exports = {
  apps: [
    {
      name: 'lms-backend',
      cwd: './backend',
      script: 'src/index.ts',
      interpreter: 'bun', // ← absolute path if not on PATH, e.g. '/root/.bun/bin/bun'
      exec_mode: 'fork', // cluster mode is NOT supported with the Bun interpreter
      instances: 2, // ← set to (CPU cores - 1); must match nginx upstream
      // NOTE: no `increment_var` — the app derives its listen port from
      // NODE_APP_INSTANCE (see backend/src/index.ts). All forks share PORT=4000
      // as the BASE; instance N listens on 4000+N (4000..4001). Matches nginx upstream.
      autorestart: true,

      /* Stop a process that CANNOT start from restarting for ever.

         Without these two, PM2 restarts a crash-on-boot process indefinitely
         and still reports it `online`. One did exactly that 56,697 times over
         27 hours — burning a whole CPU core, while `pm2 list` showed a green
         row and nothing anywhere said the boot was failing.

         With them PM2 gives up after 10 attempts and the status reads
         `errored`, which is visible at a glance and in any monitor. A healthy
         boot is unaffected: it passes 20s uptime on the first try. */
      min_uptime: '20s',
      max_restarts: 10,
      watch: false,
      max_memory_restart: '500M',
      kill_timeout: 10000, // give in-flight requests 10s to drain on reload (matches graceful shutdown)
      env: {
        NODE_ENV: 'production',
        PORT: 4000, // base port; incremented per instance — MUST match nginx upstream (4000..4001)
      },
      out_file: './logs/backend-out.log',
      error_file: './logs/backend-error.log',
      merge_logs: true,
      time: true,
    },
  ],
}
