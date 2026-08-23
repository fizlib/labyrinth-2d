import type uWS from 'uWebSockets.js';

import { isAdminApiOriginAllowed } from './adminApi.js';
import {
  TutorialServiceError,
  createTutorialSession,
  updateTutorialSession,
} from './tutorialService.js';

const MAX_TUTORIAL_BODY_BYTES = 8 * 1024;

interface RequestContext {
  aborted: boolean;
  corsOrigin: string | null;
  abortBody?: () => void;
}

function writeCorsHeaders(res: uWS.HttpResponse, corsOrigin: string | null): void {
  if (corsOrigin) {
    res.writeHeader('Access-Control-Allow-Origin', corsOrigin);
    res.writeHeader('Vary', 'Origin');
  }
  res.writeHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.writeHeader('Access-Control-Allow-Methods', 'POST, PATCH, OPTIONS');
  res.writeHeader('Cache-Control', 'no-store');
}

function statusText(status: number): string {
  const labels: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    409: 'Conflict',
    413: 'Payload Too Large',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
  };
  return labels[status] ?? 'Internal Server Error';
}

function sendJson(
  res: uWS.HttpResponse,
  context: RequestContext,
  status: number,
  payload: unknown,
): void {
  if (context.aborted) return;
  res.cork(() => {
    res.writeStatus(`${status} ${statusText(status)}`);
    writeCorsHeaders(res, context.corsOrigin);
    res.writeHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  });
}

function bearerToken(header: string): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

function readJsonBody(
  res: uWS.HttpResponse,
  context: RequestContext,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    context.abortBody = () => {
      if (settled) return;
      settled = true;
      reject(new Error('Request aborted'));
    };
    res.onData((chunk, isLast) => {
      if (context.aborted || settled) return;
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_TUTORIAL_BODY_BYTES) {
        settled = true;
        reject(
          new TutorialServiceError(413, 'BODY_TOO_LARGE', 'Request body is too large.'),
        );
        return;
      }
      chunks.push(buffer);
      if (!isLast) return;
      settled = true;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Expected an object.');
        }
        resolve(value as Record<string, unknown>);
      } catch {
        reject(
          new TutorialServiceError(
            400,
            'INVALID_JSON',
            'A valid JSON object is required.',
          ),
        );
      }
    });
  });
}

export function registerTutorialApi(app: uWS.TemplatedApp): void {
  app.any('/tutorial-api/*', (res, req) => {
    const method = req.getMethod().toLowerCase();
    const path = req.getUrl().replace(/\/$/, '');
    const origin = req.getHeader('origin');
    const host = req.getHeader('x-forwarded-host') || req.getHeader('host');
    // uWebSockets only guarantees that HttpRequest can be read while this
    // synchronous route callback is running. Capture every header needed by
    // the asynchronous body handler before yielding to onData.
    const authorization = req.getHeader('authorization');
    const context: RequestContext = { aborted: false, corsOrigin: origin || null };

    if (!isAdminApiOriginAllowed(origin, host)) {
      sendJson(res, context, 403, {
        error: { code: 'ORIGIN_FORBIDDEN', message: 'Origin is not allowed.' },
      });
      return;
    }
    if (method === 'options') {
      res.cork(() => {
        res.writeStatus('204 No Content');
        writeCorsHeaders(res, context.corsOrigin);
        res.end();
      });
      return;
    }
    if (method !== 'post' && method !== 'patch') {
      sendJson(res, context, 405, {
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' },
      });
      return;
    }

    res.onAborted(() => {
      context.aborted = true;
      context.abortBody?.();
    });
    const bodyPromise = readJsonBody(res, context);
    void (async () => {
      try {
        const body = await bodyPromise;
        if (method === 'post' && path === '/tutorial-api/sessions') {
          sendJson(
            res,
            context,
            201,
            await createTutorialSession(bearerToken(authorization), body),
          );
          return;
        }
        const sessionMatch = /^\/tutorial-api\/sessions\/([^/]+)$/.exec(path);
        if (method === 'patch' && sessionMatch?.[1]) {
          sendJson(
            res,
            context,
            200,
            await updateTutorialSession(decodeURIComponent(sessionMatch[1]), body),
          );
          return;
        }
        throw new TutorialServiceError(404, 'NOT_FOUND', 'Tutorial endpoint not found.');
      } catch (error) {
        if (context.aborted) return;
        if (error instanceof TutorialServiceError) {
          sendJson(res, context, error.status, {
            error: { code: error.code, message: error.message },
          });
          return;
        }
        console.error(
          '[Tutorial API] Request failed:',
          error instanceof Error ? error.message : error,
        );
        sendJson(res, context, 500, {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'The tutorial event could not be recorded.',
          },
        });
      }
    })();
  });
}
