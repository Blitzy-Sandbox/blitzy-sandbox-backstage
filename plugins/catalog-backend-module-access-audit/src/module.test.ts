/*
 * Copyright 2024 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { EventEmitter } from 'node:events';
import {
  coreServices,
  createServiceFactory,
} from '@backstage/backend-plugin-api';
import {
  mockCredentials,
  mockServices,
  startTestBackend,
} from '@backstage/backend-test-utils';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { catalogModuleAccessAudit } from './module';

/**
 * Builds a minimal Response-like object using an EventEmitter so that the
 * audit middleware can register `res.on('finish', ...)` and
 * `res.on('close', ...)` listeners. Returns the emitter cast to a Response,
 * plus two helpers (`triggerFinish()` / `triggerClose()`) so tests can
 * simulate the response lifecycle events that drive the audit emission.
 */
function createMockResponse(statusCode = 200): Response & {
  triggerFinish: () => void;
  triggerClose: () => void;
} {
  const emitter = new EventEmitter();
  const res = emitter as unknown as Response & {
    triggerFinish: () => void;
    triggerClose: () => void;
  };
  res.statusCode = statusCode;
  res.triggerFinish = () => {
    emitter.emit('finish');
  };
  res.triggerClose = () => {
    emitter.emit('close');
  };
  return res;
}

/**
 * Builds a minimal Request-like object that covers only the surface the
 * audit middleware reads (`method` and `path`). The empty `headers` map
 * is required so that `MockHttpAuthService.credentials(req)` can safely
 * read `req.headers.authorization` (and fall back to its configured
 * `defaultCredentials` when no token is present) without throwing a
 * `TypeError`. The cast keeps the helper type-safe while sidestepping
 * the full Express Request interface.
 */
function createMockRequest(method: string, path: string): Request {
  return { method, path, headers: {} } as unknown as Request;
}

/**
 * Builds a mock Response that supports `res.json(body)` and
 * `res.end(chunk)` in addition to the EventEmitter lifecycle.
 *
 * @remarks
 *
 * The audit middleware's by-uid response body inspector wraps both
 * `res.json` and `res.end` to recover the canonical entity ref from
 * the catalog backend's response payload. This helper provides
 * pass-through implementations of both methods so tests can simulate
 * a by-uid read whose response body carries an entity envelope, and
 * thereby exercise the body inspection path (which the plain
 * `createMockResponse` cannot do because it has no `json`/`end`
 * surface).
 */
function createMockResponseWithJson(statusCode = 200): Response & {
  triggerFinish: () => void;
  triggerClose: () => void;
} {
  const emitter = new EventEmitter();
  const res = emitter as unknown as Response & {
    triggerFinish: () => void;
    triggerClose: () => void;
  };
  res.statusCode = statusCode;
  // `Response['json']` and `Response['end']` are heavily overloaded
  // generic types whose `this` and return positions are invariant
  // against the enriched `Response & { triggerFinish, triggerClose }`
  // shape used by these tests. Bypass the field's static type by
  // assigning through `any` — the runtime contract still returns the
  // mock response so chainable calls like `res.status(200).json(...)`
  // would also work if any test exercised them.
  (res as any).json = (_body?: unknown) => res;
  (res as any).end = (_chunk?: unknown) => res;
  res.triggerFinish = () => {
    emitter.emit('finish');
  };
  res.triggerClose = () => {
    emitter.emit('close');
  };
  return res;
}

/**
 * Drains the microtask queue across two `setImmediate` boundaries. The
 * middleware schedules audit work inside an async IIFE that awaits up to
 * two promises (credentials resolution → `auditor.createEvent` →
 * `event.success`/`event.fail`); two ticks therefore deterministically
 * push the IIFE to completion before assertions run.
 */
async function flushAsync(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

/**
 * Boots an isolated test backend with the `catalogModuleAccessAudit`
 * module and a fresh set of service mocks, then returns the registered
 * middleware along with the mocks for assertion. Each call produces an
 * independent set of mocks to avoid cross-test state bleed.
 */
async function bootBackend(options?: {
  auditorImpl?: Parameters<typeof mockServices.auditor.mock>[0];
  httpAuthCredentials?: ReturnType<typeof mockCredentials.user>;
  httpAuthFactoryOverride?: ReturnType<typeof createServiceFactory>;
}): Promise<{
  handler: RequestHandler;
  auditorMock: ReturnType<typeof mockServices.auditor.mock>;
  loggerMock: ReturnType<typeof mockServices.logger.mock>;
}> {
  const httpRouterMock = mockServices.httpRouter.mock();
  const auditorMock = mockServices.auditor.mock(options?.auditorImpl);
  const loggerMock = mockServices.logger.mock();

  const httpAuthFactory =
    options?.httpAuthFactoryOverride ??
    mockServices.httpAuth.factory({
      defaultCredentials:
        options?.httpAuthCredentials ?? mockCredentials.user(),
    });

  await startTestBackend({
    features: [
      httpRouterMock.factory,
      auditorMock.factory,
      httpAuthFactory,
      loggerMock.factory,
      catalogModuleAccessAudit,
    ],
  });

  expect(httpRouterMock.use).toHaveBeenCalledTimes(1);
  const handler = httpRouterMock.use.mock.calls[0][0] as RequestHandler;

  return { handler, auditorMock, loggerMock };
}

describe('catalogModuleAccessAudit', () => {
  it('emits an entity-access success event for GET /entities/by-name/:kind/:namespace/:name', async () => {
    const successMock = jest.fn();
    const failMock = jest.fn();
    const { handler, auditorMock } = await bootBackend({
      auditorImpl: {
        createEvent: jest
          .fn()
          .mockResolvedValue({ success: successMock, fail: failMock }),
      },
    });

    const req = createMockRequest(
      'GET',
      '/entities/by-name/component/default/my-service',
    );
    const res = createMockResponse(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    res.triggerFinish();
    await flushAsync();

    expect(auditorMock.createEvent).toHaveBeenCalledTimes(1);
    expect(auditorMock.createEvent).toHaveBeenCalledWith({
      eventId: 'entity-access',
      severityLevel: 'low',
      request: req,
      meta: {
        entityRef: 'component:default/my-service',
        principal: {
          type: 'user',
          userEntityRef: mockCredentials.user().principal.userEntityRef,
        },
        action: 'read',
      },
    });
    expect(successMock).toHaveBeenCalledWith({ meta: { statusCode: 200 } });
    expect(failMock).not.toHaveBeenCalled();
  });

  it('emits an entity-access success event for GET /entities/by-uid/:uid', async () => {
    const successMock = jest.fn();
    const failMock = jest.fn();
    const { handler, auditorMock } = await bootBackend({
      auditorImpl: {
        createEvent: jest
          .fn()
          .mockResolvedValue({ success: successMock, fail: failMock }),
      },
    });

    const req = createMockRequest('GET', '/entities/by-uid/abc-123');
    const res = createMockResponse(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    res.triggerFinish();
    await flushAsync();

    // The module records the opaque UID as `meta.entityUid` whenever the
    // response body inspector did not capture a canonical entity ref
    // (which is the case here because the test does not emit a JSON
    // entity body before triggering finish).
    expect(auditorMock.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'entity-access',
        severityLevel: 'low',
        meta: expect.objectContaining({
          entityUid: 'abc-123',
          action: 'read',
        }),
      }),
    );
    expect(successMock).toHaveBeenCalledWith({ meta: { statusCode: 200 } });
  });

  it('emits a fail event when the response status code is 4xx or 5xx', async () => {
    const successMock = jest.fn();
    const failMock = jest.fn();
    const { handler, auditorMock } = await bootBackend({
      auditorImpl: {
        createEvent: jest
          .fn()
          .mockResolvedValue({ success: successMock, fail: failMock }),
      },
    });

    const req = createMockRequest(
      'GET',
      '/entities/by-name/component/default/missing',
    );
    const res = createMockResponse(404);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    res.triggerFinish();
    await flushAsync();

    expect(auditorMock.createEvent).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledTimes(1);
    const [arg] = failMock.mock.calls[0];
    expect(arg.meta).toEqual({ statusCode: 404 });
    expect(arg.error).toBeInstanceOf(Error);
    expect(successMock).not.toHaveBeenCalled();
  });

  it('records a service principal correctly', async () => {
    const successMock = jest.fn();
    const failMock = jest.fn();
    const { handler, auditorMock } = await bootBackend({
      httpAuthCredentials: mockCredentials.service() as unknown as ReturnType<
        typeof mockCredentials.user
      >,
      auditorImpl: {
        createEvent: jest
          .fn()
          .mockResolvedValue({ success: successMock, fail: failMock }),
      },
    });

    const req = createMockRequest(
      'GET',
      '/entities/by-name/component/default/svc',
    );
    const res = createMockResponse(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    res.triggerFinish();
    await flushAsync();

    expect(auditorMock.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          principal: expect.objectContaining({ type: 'service' }),
        }),
      }),
    );
  });

  it('records an anonymous principal when no credentials are present', async () => {
    const successMock = jest.fn();
    const failMock = jest.fn();
    const { handler, auditorMock } = await bootBackend({
      httpAuthCredentials: mockCredentials.none() as unknown as ReturnType<
        typeof mockCredentials.user
      >,
      auditorImpl: {
        createEvent: jest
          .fn()
          .mockResolvedValue({ success: successMock, fail: failMock }),
      },
    });

    const req = createMockRequest(
      'GET',
      '/entities/by-name/component/default/anon',
    );
    const res = createMockResponse(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    res.triggerFinish();
    await flushAsync();

    expect(auditorMock.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          principal: { type: 'none' },
        }),
      }),
    );
  });

  it('does not emit an event for the catalog collection endpoint', async () => {
    const { handler, auditorMock } = await bootBackend();

    const req = createMockRequest('GET', '/entities');
    const res = createMockResponse(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    res.triggerFinish();
    await flushAsync();

    expect(auditorMock.createEvent).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not emit an event for non-GET methods', async () => {
    const { handler, auditorMock } = await bootBackend();

    const req = createMockRequest(
      'POST',
      '/entities/by-name/component/default/my-service',
    );
    const res = createMockResponse(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    res.triggerFinish();
    await flushAsync();

    expect(auditorMock.createEvent).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not emit an event for the /ancestry sub-route', async () => {
    const { handler, auditorMock } = await bootBackend();

    const req = createMockRequest(
      'GET',
      '/entities/by-name/component/default/my-service/ancestry',
    );
    const res = createMockResponse(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    res.triggerFinish();
    await flushAsync();

    expect(auditorMock.createEvent).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('still records an event (with type:none principal) when credentials resolution throws', async () => {
    const successMock = jest.fn();
    const failMock = jest.fn();
    const throwingHttpAuth = createServiceFactory({
      service: coreServices.httpAuth,
      deps: {},
      factory() {
        return {
          credentials: jest.fn().mockRejectedValue(new Error('bad token')),
          issueUserCookie: jest.fn(),
        } as any;
      },
    });

    const { handler, auditorMock } = await bootBackend({
      auditorImpl: {
        createEvent: jest
          .fn()
          .mockResolvedValue({ success: successMock, fail: failMock }),
      },
      httpAuthFactoryOverride: throwingHttpAuth,
    });

    const req = createMockRequest(
      'GET',
      '/entities/by-name/component/default/svc',
    );
    const res = createMockResponse(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    res.triggerFinish();
    await flushAsync();

    expect(auditorMock.createEvent).toHaveBeenCalledTimes(1);
    expect(auditorMock.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          principal: { type: 'none' },
        }),
      }),
    );
    expect(successMock).toHaveBeenCalledTimes(1);
  });

  it('gracefully degrades when auditor.createEvent rejects (logs a warning, response unaffected)', async () => {
    const createEventMock = jest
      .fn()
      .mockRejectedValue(new Error('auditor exploded'));
    const { handler, auditorMock, loggerMock } = await bootBackend({
      auditorImpl: { createEvent: createEventMock },
    });

    const req = createMockRequest(
      'GET',
      '/entities/by-name/component/default/svc',
    );
    const res = createMockResponse(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    res.triggerFinish();
    await flushAsync();

    expect(auditorMock.createEvent).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('entity-access audit'),
    );
  });

  it('gracefully degrades when event.success() rejects', async () => {
    const successMock = jest
      .fn()
      .mockRejectedValue(new Error('finalize blew up'));
    const { handler, loggerMock } = await bootBackend({
      auditorImpl: {
        createEvent: jest
          .fn()
          .mockResolvedValue({ success: successMock, fail: jest.fn() }),
      },
    });

    const req = createMockRequest(
      'GET',
      '/entities/by-name/component/default/svc',
    );
    const res = createMockResponse(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    res.triggerFinish();
    await flushAsync();

    expect(successMock).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('entity-access audit'),
    );
  });

  it('runs the finalize callback exactly once even if both finish and close fire', async () => {
    const successMock = jest.fn();
    const { handler, auditorMock } = await bootBackend({
      auditorImpl: {
        createEvent: jest
          .fn()
          .mockResolvedValue({ success: successMock, fail: jest.fn() }),
      },
    });

    const req = createMockRequest(
      'GET',
      '/entities/by-name/component/default/svc',
    );
    const res = createMockResponse(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    res.triggerFinish();
    res.triggerClose();
    await flushAsync();

    expect(auditorMock.createEvent).toHaveBeenCalledTimes(1);
    expect(successMock).toHaveBeenCalledTimes(1);
  });

  it('canonicalizes the entity ref to lowercase (matches stringifyEntityRef)', async () => {
    const successMock = jest.fn();
    const { handler, auditorMock } = await bootBackend({
      auditorImpl: {
        createEvent: jest
          .fn()
          .mockResolvedValue({ success: successMock, fail: jest.fn() }),
      },
    });

    const req = createMockRequest(
      'GET',
      '/entities/by-name/Component/Default/MyService',
    );
    const res = createMockResponse(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    res.triggerFinish();
    await flushAsync();

    expect(auditorMock.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          entityRef: 'component:default/myservice',
        }),
      }),
    );
  });

  // ----------------------------------------------------------------
  // Additional coverage tests for the by-uid response body inspector
  // (lines 134-178 and 202-250 of module.ts). The tests above use a
  // bare EventEmitter mock that has no `json`/`end` surface, so the
  // inspector installation aborts inside its try/catch and the body
  // inspection branches never execute. The tests below provide a
  // mock with pass-through `json`/`end` implementations so the
  // inspector can wrap them and the wrapped functions can be
  // exercised end-to-end. These tests are required to meet the
  // ≥80% line-coverage target mandated by AAP §0.8.1.2 for new
  // Authorization/Audit logic.
  // ----------------------------------------------------------------

  it('captures the canonical entity ref from a by-uid res.json body', async () => {
    const successMock = jest.fn();
    const { handler, auditorMock } = await bootBackend({
      auditorImpl: {
        createEvent: jest
          .fn()
          .mockResolvedValue({ success: successMock, fail: jest.fn() }),
      },
    });

    const req = createMockRequest('GET', '/entities/by-uid/uid-1');
    const res = createMockResponseWithJson(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    res.json({
      kind: 'Component',
      metadata: { name: 'my-service', namespace: 'default' },
    });
    res.triggerFinish();
    await flushAsync();

    expect(auditorMock.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          entityRef: 'component:default/my-service',
          entityUid: 'uid-1',
          action: 'read',
        }),
      }),
    );
  });

  it('defaults the namespace to "default" when the by-uid body omits it', async () => {
    const successMock = jest.fn();
    const { handler, auditorMock } = await bootBackend({
      auditorImpl: {
        createEvent: jest
          .fn()
          .mockResolvedValue({ success: successMock, fail: jest.fn() }),
      },
    });

    const req = createMockRequest('GET', '/entities/by-uid/uid-2');
    const res = createMockResponseWithJson(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    // Body omits `metadata.namespace`; canonicalizer must default it.
    res.json({
      kind: 'API',
      metadata: { name: 'public-api' },
    });
    res.triggerFinish();
    await flushAsync();

    expect(auditorMock.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          entityRef: 'api:default/public-api',
        }),
      }),
    );
  });

  it('captures the canonical entity ref from a by-uid res.end JSON string', async () => {
    const successMock = jest.fn();
    const { handler, auditorMock } = await bootBackend({
      auditorImpl: {
        createEvent: jest
          .fn()
          .mockResolvedValue({ success: successMock, fail: jest.fn() }),
      },
    });

    const req = createMockRequest('GET', '/entities/by-uid/uid-3');
    const res = createMockResponseWithJson(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    res.end(
      JSON.stringify({
        kind: 'System',
        metadata: { name: 'payments', namespace: 'team-a' },
      }),
    );
    res.triggerFinish();
    await flushAsync();

    expect(auditorMock.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          entityRef: 'system:team-a/payments',
          entityUid: 'uid-3',
        }),
      }),
    );
  });

  it('captures the canonical entity ref from a by-uid res.end Buffer chunk', async () => {
    const successMock = jest.fn();
    const { handler, auditorMock } = await bootBackend({
      auditorImpl: {
        createEvent: jest
          .fn()
          .mockResolvedValue({ success: successMock, fail: jest.fn() }),
      },
    });

    const req = createMockRequest('GET', '/entities/by-uid/uid-4');
    const res = createMockResponseWithJson(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    res.end(
      Buffer.from(
        JSON.stringify({
          kind: 'Resource',
          metadata: { name: 'db', namespace: 'infra' },
        }),
        'utf8',
      ),
    );
    res.triggerFinish();
    await flushAsync();

    expect(auditorMock.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          entityRef: 'resource:infra/db',
          entityUid: 'uid-4',
        }),
      }),
    );
  });

  it('falls back to entityUid when the by-uid response body is not a JSON entity envelope', async () => {
    const successMock = jest.fn();
    const { handler, auditorMock } = await bootBackend({
      auditorImpl: {
        createEvent: jest
          .fn()
          .mockResolvedValue({ success: successMock, fail: jest.fn() }),
      },
    });

    const req = createMockRequest('GET', '/entities/by-uid/uid-5');
    const res = createMockResponseWithJson(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    // Body is an object but missing `kind`; canonicalizer returns undefined.
    res.json({ metadata: { name: 'incomplete' } });
    res.triggerFinish();
    await flushAsync();

    const [arg] = (auditorMock.createEvent as jest.Mock).mock.calls[0];
    expect(arg.meta.entityRef).toBeUndefined();
    expect(arg.meta.entityUid).toBe('uid-5');
  });

  it('falls back to entityUid when res.end emits a non-JSON string body', async () => {
    const successMock = jest.fn();
    const { handler, auditorMock } = await bootBackend({
      auditorImpl: {
        createEvent: jest
          .fn()
          .mockResolvedValue({ success: successMock, fail: jest.fn() }),
      },
    });

    const req = createMockRequest('GET', '/entities/by-uid/uid-6');
    const res = createMockResponseWithJson(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    // Garbage body — JSON.parse will throw, but the audit must still
    // record the UID instead of crashing.
    res.end('not-json');
    res.triggerFinish();
    await flushAsync();

    const [arg] = (auditorMock.createEvent as jest.Mock).mock.calls[0];
    expect(arg.meta.entityRef).toBeUndefined();
    expect(arg.meta.entityUid).toBe('uid-6');
  });

  it('ignores res.end calls with no chunk (no body emitted)', async () => {
    const successMock = jest.fn();
    const { handler, auditorMock } = await bootBackend({
      auditorImpl: {
        createEvent: jest
          .fn()
          .mockResolvedValue({ success: successMock, fail: jest.fn() }),
      },
    });

    const req = createMockRequest('GET', '/entities/by-uid/uid-7');
    const res = createMockResponseWithJson(200);
    const next = jest.fn() as NextFunction;

    handler(req, res, next);
    res.end(); // No chunk argument.
    res.triggerFinish();
    await flushAsync();

    const [arg] = (auditorMock.createEvent as jest.Mock).mock.calls[0];
    expect(arg.meta.entityRef).toBeUndefined();
    expect(arg.meta.entityUid).toBe('uid-7');
  });
});
