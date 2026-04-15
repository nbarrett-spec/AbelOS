/**
 * Structured logger with JSON output in production and human-readable output in development.
 * No external dependencies — uses built-in console and ANSI colors.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  ts: string;
  level: Level;
  msg: string;
  requestId?: string;
  [key: string]: unknown;
  err?: {
    name: string;
    message: string;
    stack?: string;
  };
}

// ANSI color codes for development
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Format a log entry for production (single-line JSON)
 */
function formatProduction(entry: LogEntry): string {
  return JSON.stringify(entry);
}

/**
 * Format a log entry for development (human-readable)
 */
function formatDevelopment(entry: LogEntry): string {
  const { ts, level, msg, requestId, err, ...rest } = entry;

  const levelColor =
    level === 'debug'
      ? colors.gray
      : level === 'info'
      ? colors.cyan
      : level === 'warn'
      ? colors.yellow
      : colors.red;

  const levelTag = `${levelColor}[${level.toUpperCase()}]${colors.reset}`;
  const timeTag = `${colors.gray}${ts}${colors.reset}`;
  const reqTag = requestId ? ` [${requestId}]` : '';

  let output = `${timeTag} ${levelTag}${reqTag} ${msg}`;

  // Add context if present
  const contextKeys = Object.keys(rest).filter(k => rest[k] !== undefined);
  if (contextKeys.length > 0) {
    const contextStr = contextKeys
      .map(k => {
        const val = rest[k];
        if (typeof val === 'object') {
          return `${k}=${JSON.stringify(val)}`;
        }
        return `${k}=${val}`;
      })
      .join(' ');
    output += ` ${colors.gray}${contextStr}${colors.reset}`;
  }

  // Add error details if present
  if (err) {
    output += `\n  ${colors.red}${err.name}: ${err.message}${colors.reset}`;
    if (err.stack) {
      output += `\n  ${colors.gray}${err.stack}${colors.reset}`;
    }
  }

  return output;
}

/**
 * Extract error details from an Error object
 */
function extractErrorDetails(err: unknown): LogEntry['err'] | undefined {
  if (!err) return undefined;

  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }

  // Handle non-Error objects
  const errStr = String(err);
  return {
    name: 'UnknownError',
    message: errStr,
  };
}

/**
 * Send error to Sentry if available
 */
function sendToSentry(level: Level, msg: string, err: unknown): void {
  try {
    const sentry = (globalThis as any).Sentry;
    if (!sentry) return;

    if (level === 'error' && err) {
      sentry.captureException(err instanceof Error ? err : new Error(msg));
    }
  } catch {
    // Silently fail; don't break logging if Sentry fails
  }
}

/**
 * Core logging function
 */
function log(
  level: Level,
  msg: string,
  err: unknown = undefined,
  ctx: LogContext = {}
): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...ctx,
  };

  // Only add error details if error is provided
  if (err !== undefined) {
    entry.err = extractErrorDetails(err);
  }

  const formatted = isProduction
    ? formatProduction(entry)
    : formatDevelopment(entry);

  // Write to stdout
  process.stdout.write(formatted + '\n');

  // Send to Sentry on error level
  if (level === 'error') {
    sendToSentry(level, msg, err);
  }
}

/**
 * Public logger API
 */
export const logger = {
  debug: (msg: string, ctx?: LogContext) => {
    log('debug', msg, undefined, ctx);
  },

  info: (msg: string, ctx?: LogContext) => {
    log('info', msg, undefined, ctx);
  },

  warn: (msg: string, ctx?: LogContext) => {
    log('warn', msg, undefined, ctx);
  },

  error: (msg: string, err?: unknown, ctx?: LogContext) => {
    log('error', msg, err, ctx);
    // Fire-and-forget persistence to the ServerError table so /admin/errors
    // can show server-side failures the same way it shows client beacons.
    //
    // Dynamic import is deliberate — prisma.ts imports this logger for slow-
    // query warnings, and server-errors.ts imports prisma. A static import
    // here would create a load-time cycle (prisma → logger → server-errors
    // → prisma) where server-errors sees a partially-initialized prisma.
    // Deferring to runtime breaks the cycle because the first logger.error
    // call happens long after all three modules have finished initializing.
    import('@/lib/server-errors')
      .then((m) => m.recordServerError(msg, err, ctx))
      .catch(() => {
        // swallow — persistence must never break the logger itself
      });
  },
};

/**
 * Get request ID from headers or generate a new UUID
 */
export function getRequestId(req: Request): string {
  const existingId = req.headers.get('x-request-id');
  if (existingId) return existingId;

  // Generate a new UUID v4
  return crypto.randomUUID();
}
