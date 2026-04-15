/**
 * Next.js instrumentation hook for initializing Sentry at runtime and
 * installing process-level error hooks that feed the ServerError table.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Why hook the process and not just use withErrorHandling?
 *   Route-handler wrappers only catch errors thrown on the request path.
 *   They miss:
 *     - unhandled rejections from fire-and-forget promises
 *     - errors thrown in setTimeout / setImmediate callbacks
 *     - errors thrown from cron jobs that don't already use finishCronRun
 *     - errors from background async work kicked off by a request but
 *       completed after the response flushed
 *   A process-level hook captures all of them and guarantees the
 *   ServerError table is our canonical "everything that went wrong"
 *   feed — not just the subset developers remembered to log.
 *
 * Installed at most once per process (Lambda warm-start is fine — the
 * guard keeps us from stacking handlers on subsequent register() calls).
 */

let processHooksInstalled = false

function installProcessHooks() {
  if (processHooksInstalled) return
  processHooksInstalled = true

  // Dynamic import: instrumentation.ts runs before most of the app module
  // graph is initialized, and logger.ts pulls in env, which we want to
  // allow to finish booting before any logger.error call executes. The
  // .then() handler is fire-and-forget because the process is either
  // about to crash (uncaughtException) or already recovering.
  const forwardToLogger = (
    level: 'uncaughtException' | 'unhandledRejection',
    err: unknown
  ) => {
    import('./lib/logger')
      .then(({ logger }) => {
        logger.error(level, err, { source: 'instrumentation' })
      })
      .catch(() => {
        // Absolute last resort — logger itself is broken. Fall back to
        // console so there's at least a trace in Vercel logs.
        // eslint-disable-next-line no-console
        console.error(`[instrumentation] ${level}`, err)
      })
  }

  process.on('uncaughtException', (err) => {
    forwardToLogger('uncaughtException', err)
  })

  process.on('unhandledRejection', (reason) => {
    forwardToLogger('unhandledRejection', reason)
  })
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
    installProcessHooks()
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}
