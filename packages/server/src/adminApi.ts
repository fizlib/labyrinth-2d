import type uWS from 'uWebSockets.js';
import type { AdminApiError, AdminRoomSnapshot } from '@labyrinth/shared';

import {
  AdminServiceError,
  authorizeAdmin,
  getAdminOverview,
  getCompletedRound,
  listAdminActivity,
  listAdminUsers,
  listCompletedRounds,
  setAdminUserRole,
  setAdminUserSuspension,
  updateAdminUserProfile,
} from './adminService.js';

const MAX_ADMIN_BODY_BYTES = 16 * 1024;
const DEFAULT_ALLOWED_ORIGINS = [
  'https://falsearrow.com',
  'https://www.falsearrow.com',
] as const;
const allowedOrigins = new Set(
  [
    ...DEFAULT_ALLOWED_ORIGINS,
    ...(process.env.ADMIN_ALLOWED_ORIGINS ?? '').split(','),
  ]
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
);

interface AdminApiDependencies {
  getRooms: () => AdminRoomSnapshot[];
  removeUserFromRooms: (userId: string) => void;
  setUserAdminInRooms: (userId: string, isAdmin: boolean) => void;
}

interface RequestContext {
  aborted: boolean;
  corsOrigin: string | null;
}

export function isAdminApiOriginAllowed(origin: string, host: string): boolean {
  if (!origin) return true;
  const normalized = origin.replace(/\/$/, '');
  return (
    normalized === `http://${host}` ||
    normalized === `https://${host}` ||
    allowedOrigins.has(normalized)
  );
}

function writeCorsHeaders(res: uWS.HttpResponse, corsOrigin: string | null): void {
  if (corsOrigin) {
    res.writeHeader('Access-Control-Allow-Origin', corsOrigin);
    res.writeHeader('Vary', 'Origin');
  }
  res.writeHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.writeHeader('Access-Control-Allow-Methods', 'GET, PATCH, POST, OPTIONS');
  res.writeHeader('Cache-Control', 'no-store');
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

function statusText(status: number): string {
  switch (status) {
    case 200:
      return 'OK';
    case 204:
      return 'No Content';
    case 400:
      return 'Bad Request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not Found';
    case 405:
      return 'Method Not Allowed';
    case 409:
      return 'Conflict';
    case 413:
      return 'Payload Too Large';
    case 502:
      return 'Bad Gateway';
    case 503:
      return 'Service Unavailable';
    default:
      return 'Internal Server Error';
  }
}

function errorPayload(code: string, message: string): AdminApiError {
  return { error: { code, message } };
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
    res.onData((chunk, isLast) => {
      if (context.aborted) return;
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_ADMIN_BODY_BYTES) {
        reject(
          new AdminServiceError(413, 'BODY_TOO_LARGE', 'Request body is too large.'),
        );
        return;
      }
      chunks.push(buffer);
      if (!isLast) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Expected an object.');
        }
        resolve(value as Record<string, unknown>);
      } catch {
        reject(
          new AdminServiceError(400, 'INVALID_JSON', 'A valid JSON object is required.'),
        );
      }
    });
  });
}

function requiredString(
  body: Record<string, unknown>,
  field: string,
  allowEmpty = false,
): string {
  const value = body[field];
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new AdminServiceError(400, 'INVALID_BODY', `${field} is required.`);
  }
  return value;
}

function requiredBoolean(body: Record<string, unknown>, field: string): boolean {
  const value = body[field];
  if (typeof value !== 'boolean') {
    throw new AdminServiceError(400, 'INVALID_BODY', `${field} must be a boolean.`);
  }
  return value;
}

async function handleAdminRequest(
  res: uWS.HttpResponse,
  context: RequestContext,
  method: string,
  path: string,
  query: URLSearchParams,
  accessToken: string | null,
  bodyPromise: Promise<Record<string, unknown>> | null,
  dependencies: AdminApiDependencies,
): Promise<void> {
  try {
    const identity = await authorizeAdmin(accessToken);
    const rooms = dependencies.getRooms();

    if (method === 'get' && path === '/admin-api/overview') {
      sendJson(res, context, 200, await getAdminOverview(rooms));
      return;
    }
    if (method === 'get' && path === '/admin-api/users') {
      sendJson(res, context, 200, await listAdminUsers(query, rooms));
      return;
    }
    if (method === 'get' && path === '/admin-api/rounds') {
      sendJson(res, context, 200, await listCompletedRounds(query));
      return;
    }
    if (method === 'get' && path === '/admin-api/activity') {
      sendJson(res, context, 200, await listAdminActivity(query));
      return;
    }
    const roundMatch = /^\/admin-api\/rounds\/([^/]+)$/.exec(path);
    if (method === 'get' && roundMatch?.[1]) {
      sendJson(res, context, 200, await getCompletedRound(roundMatch[1]));
      return;
    }

    const userMatch = /^\/admin-api\/users\/([^/]+)\/(profile|admin|suspension)$/.exec(
      path,
    );
    if (userMatch?.[1] && userMatch[2] && bodyPromise) {
      const targetId = decodeURIComponent(userMatch[1]);
      const action = userMatch[2];
      const body = await bodyPromise;
      if (method === 'patch' && action === 'profile') {
        const result = await updateAdminUserProfile(
          identity.userId,
          targetId,
          requiredString(body, 'displayName'),
          requiredString(body, 'avatarUrl', true),
          dependencies.getRooms(),
        );
        sendJson(res, context, 200, result);
        return;
      }
      if (method === 'post' && action === 'admin') {
        const isAdmin = requiredBoolean(body, 'isAdmin');
        const result = await setAdminUserRole(
          identity.userId,
          targetId,
          isAdmin,
          dependencies.getRooms(),
          dependencies.setUserAdminInRooms,
        );
        sendJson(res, context, 200, result);
        return;
      }
      if (method === 'post' && action === 'suspension') {
        const suspended = requiredBoolean(body, 'suspended');
        const result = await setAdminUserSuspension(
          identity.userId,
          targetId,
          suspended,
          requiredString(body, 'reason', !suspended),
          dependencies.getRooms(),
          dependencies.removeUserFromRooms,
        );
        sendJson(res, context, 200, result);
        return;
      }
      throw new AdminServiceError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    }

    throw new AdminServiceError(404, 'NOT_FOUND', 'Administrator endpoint not found.');
  } catch (error) {
    if (context.aborted) return;
    if (error instanceof AdminServiceError) {
      sendJson(res, context, error.status, errorPayload(error.code, error.message));
      return;
    }
    console.error(
      '[Admin API] Request failed:',
      error instanceof Error ? error.message : error,
    );
    sendJson(
      res,
      context,
      500,
      errorPayload('INTERNAL_ERROR', 'The administrator request could not be completed.'),
    );
  }
}

export function registerAdminApi(
  app: uWS.TemplatedApp,
  dependencies: AdminApiDependencies,
): void {
  app.any('/admin-api/*', (res, req) => {
    const method = req.getMethod().toLowerCase();
    const path = req.getUrl().replace(/\/$/, '');
    const query = new URLSearchParams(req.getQuery());
    const origin = req.getHeader('origin');
    const host = req.getHeader('x-forwarded-host') || req.getHeader('host');
    const corsOrigin = origin || null;
    const context: RequestContext = { aborted: false, corsOrigin };

    if (!isAdminApiOriginAllowed(origin, host)) {
      sendJson(
        res,
        context,
        403,
        errorPayload('ORIGIN_FORBIDDEN', 'Origin is not allowed.'),
      );
      return;
    }
    if (method === 'options') {
      res.cork(() => {
        res.writeStatus('204 No Content');
        writeCorsHeaders(res, corsOrigin);
        res.end();
      });
      return;
    }

    let rejectBody: ((reason?: unknown) => void) | null = null;
    res.onAborted(() => {
      context.aborted = true;
      rejectBody?.(new Error('Request aborted'));
    });
    const shouldReadBody = method === 'post' || method === 'patch';
    const bodyPromise = shouldReadBody
      ? new Promise<Record<string, unknown>>((resolve, reject) => {
          rejectBody = reject;
          void readJsonBody(res, context).then(resolve, reject);
        })
      : null;
    const token = bearerToken(req.getHeader('authorization'));
    void handleAdminRequest(
      res,
      context,
      method,
      path,
      query,
      token,
      bodyPromise,
      dependencies,
    );
  });
}
