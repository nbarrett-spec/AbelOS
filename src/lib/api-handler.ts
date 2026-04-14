/**
 * Error handling wrapper for API route handlers.
 * Wraps async route handlers with try-catch and structured error logging.
 */

import { logger, getRequestId } from './logger';

/**
 * Wrap a route handler with error handling and logging.
 *
 * Usage:
 *   export const POST = withErrorHandling(async (req) => {
 *     // your route logic here
 *     return Response.json({ success: true })
 *   })
 */
export function withErrorHandling<T>(
  handler: (req: Request) => Promise<Response | T>
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const requestId = getRequestId(req);
    const pathname = new URL(req.url).pathname;
    const method = req.method;

    try {
      const result = await handler(req);

      // If handler returns a Response, return it directly
      if (result instanceof Response) {
        return result;
      }

      // Otherwise wrap in a Response
      return Response.json(result);
    } catch (err) {
      logger.error('api_route_error', err, {
        requestId,
        path: pathname,
        method,
      });

      return Response.json(
        {
          error: 'Internal server error',
          requestId,
        },
        { status: 500 }
      );
    }
  };
}
