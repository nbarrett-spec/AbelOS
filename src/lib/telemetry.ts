/**
 * Lightweight telemetry + Sentry helpers.
 * Dynamically imports @sentry/nextjs if available.
 */

type Severity = 'debug' | 'info' | 'warning' | 'error' | 'fatal'

let sentryModule: any = null

/**
 * Lazily load Sentry module (avoid hard dependency issues in build)
 */
async function getSentry() {
  if (sentryModule !== null) return sentryModule
  try {
    sentryModule = await import('@sentry/nextjs')
    return sentryModule
  } catch {
    sentryModule = false
    return null
  }
}

/**
 * Capture an exception with optional context
 */
export async function captureException(err: unknown, context?: Record<string, unknown>) {
  try {
    const Sentry = await getSentry()
    if (!Sentry) return

    if (context) {
      Sentry.withScope((scope: any) => {
        Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v))
        Sentry.captureException(err)
      })
    } else {
      Sentry.captureException(err)
    }
  } catch {
    // fall through silently
  }
}

/**
 * Capture a message with optional context
 */
export async function captureMessage(
  msg: string,
  level: Severity = 'info',
  context?: Record<string, unknown>
) {
  try {
    const Sentry = await getSentry()
    if (!Sentry) return

    if (context) {
      Sentry.withScope((scope: any) => {
        Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v))
        Sentry.captureMessage(msg, level)
      })
    } else {
      Sentry.captureMessage(msg, level)
    }
  } catch {
    // fall through silently
  }
}

/**
 * Time an async operation and emit a breadcrumb
 */
export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    try {
      const Sentry = await getSentry()
      if (Sentry) {
        Sentry.addBreadcrumb({
          category: 'perf',
          message: name,
          data: { durationMs: Date.now() - start },
          level: 'info',
        })
      }
    } catch {
      // ignore breadcrumb errors
    }
    return result
  } catch (err) {
    await captureException(err, { op: name, durationMs: Date.now() - start })
    throw err
  }
}
