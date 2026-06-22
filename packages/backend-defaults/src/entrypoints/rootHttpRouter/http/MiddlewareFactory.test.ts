/*
 * Copyright 2020 The Backstage Authors
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

import {
  AuthenticationError,
  ConflictError,
  InputError,
  NotAllowedError,
  NotFoundError,
  NotModifiedError,
  ServiceUnavailableError,
} from '@backstage/errors';
import express from 'express';
import createError from 'http-errors';
import request from 'supertest';
import { MiddlewareFactory } from './MiddlewareFactory';
import { mockServices } from '@backstage/backend-test-utils';

jest.useFakeTimers({ now: new Date('2024-11-20T00:00:00Z') });

describe('MiddlewareFactory', () => {
  describe('middleware.error', () => {
    const childLogger = mockServices.logger.mock();
    const logger = mockServices.logger.mock({ child: () => childLogger });

    const middleware = MiddlewareFactory.create({
      logger,
      config: mockServices.rootConfig.mock(),
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('gives default code and message', async () => {
      const app = express();
      app.use('/breaks', () => {
        throw new Error('some message');
      });
      app.use(middleware.error());

      const response = await request(app).get('/breaks');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: expect.objectContaining({
          name: 'Error',
          message: 'some message',
        }),
        request: { method: 'GET', url: '/breaks' },
        response: { statusCode: 500 },
      });
    });

    it('does not try to send the response again if its already been sent', async () => {
      const app = express();
      const mockSend = jest.fn();

      app.use('/works_with_async_fail', (_, res) => {
        res.status(200).send('hello');

        // mutate the response object to test the middleware.
        // it's hard to catch errors inside middleware from the outside.
        res.send = mockSend;
        throw new Error('some message');
      });

      app.use(middleware.error());
      const response = await request(app).get('/works_with_async_fail');

      expect(response.status).toBe(200);
      expect(response.text).toBe('hello');

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('takes code from http-errors library errors', async () => {
      const app = express();
      app.use('/breaks', () => {
        throw createError(432, 'Some Message');
      });
      app.use(middleware.error());

      const response = await request(app).get('/breaks');

      expect(response.status).toBe(432);
      expect(response.body).toEqual({
        error: {
          expose: true,
          name: 'BadRequestError',
          message: 'Some Message',
          status: 432,
          statusCode: 432,
        },
        request: {
          method: 'GET',
          url: '/breaks',
        },
        response: { statusCode: 432 },
      });
    });

    it('handles well-known error classes', async () => {
      const app = express();
      app.use('/NotModifiedError', () => {
        throw new NotModifiedError();
      });
      app.use('/InputError', () => {
        throw new InputError();
      });
      app.use('/AuthenticationError', () => {
        throw new AuthenticationError();
      });
      app.use('/NotAllowedError', () => {
        throw new NotAllowedError();
      });
      app.use('/NotFoundError', () => {
        throw new NotFoundError();
      });
      app.use('/ConflictError', () => {
        throw new ConflictError();
      });
      app.use('/ServiceUnavailableError', () => {
        throw new ServiceUnavailableError();
      });
      app.use(middleware.error());

      const r = request(app);
      expect((await r.get('/NotModifiedError')).status).toBe(304);
      expect((await r.get('/InputError')).status).toBe(400);
      expect((await r.get('/InputError')).body.error.name).toBe('InputError');
      expect((await r.get('/AuthenticationError')).status).toBe(401);
      expect((await r.get('/AuthenticationError')).body.error.name).toBe(
        'AuthenticationError',
      );
      expect((await r.get('/NotAllowedError')).status).toBe(403);
      expect((await r.get('/NotAllowedError')).body.error.name).toBe(
        'NotAllowedError',
      );
      expect((await r.get('/NotFoundError')).status).toBe(404);
      expect((await r.get('/NotFoundError')).body.error.name).toBe(
        'NotFoundError',
      );
      expect((await r.get('/ConflictError')).status).toBe(409);
      expect((await r.get('/ConflictError')).body.error.name).toBe(
        'ConflictError',
      );
      expect((await r.get('/ServiceUnavailableError')).status).toBe(503);
      expect((await r.get('/ServiceUnavailableError')).body.error.name).toBe(
        'ServiceUnavailableError',
      );
    });

    it('logs all 500 errors', async () => {
      const app = express();
      const thrownError = new Error('some error');

      app.use('/breaks', () => {
        throw thrownError;
      });
      app.use(middleware.error());

      await request(app).get('/breaks');

      expect(childLogger.error).toHaveBeenCalledWith(
        'Request failed with status 500',
        thrownError,
      );
    });

    it('should filter out internal errors', async () => {
      const app = express();

      const grandChildLogger = mockServices.logger.mock();
      childLogger.child.mockReturnValue(grandChildLogger);

      class DatabaseError extends Error {}
      const thrownError = new DatabaseError('some error');

      app.use('/breaks', () => {
        throw thrownError;
      });
      app.use(middleware.error());

      await request(app).get('/breaks');

      const [{ logId }] = childLogger.child.mock.calls[0];

      expect(logId).toMatch(/^[0-9a-f]+$/);
      expect(childLogger.error).toHaveBeenCalledWith(
        'Request failed with status 500',
        expect.objectContaining({
          message: expect.stringMatching(
            `An internal error occurred logId=${logId}`,
          ),
        }),
      );
      expect(grandChildLogger.error).toHaveBeenCalledWith(
        expect.stringMatching(
          `Filtered internal error with logId=${logId} from response`,
        ),
        thrownError,
      );
    });

    it('does not log 400 errors', async () => {
      const app = express();

      app.use('/NotFound', () => {
        throw new NotFoundError();
      });
      app.use(middleware.error());

      await request(app).get('/NotFound');

      expect(childLogger.error).not.toHaveBeenCalled();
    });

    it('log 400 errors when logAllErrors is true', async () => {
      const app = express();

      app.use('/NotFound', () => {
        throw new NotFoundError();
      });
      app.use(middleware.error({ logAllErrors: true }));

      await request(app).get('/NotFound');

      expect(childLogger.error).toHaveBeenCalled();
    });

    // Regression coverage for QA finding F6/F4 — stack traces MUST NOT leak
    // into HTTP error response bodies by default. The previous behavior
    // (showStackTraces = NODE_ENV === 'development') exposed internal
    // filesystem paths and code structure to clients during local dev and in
    // any environment that forgot to set NODE_ENV=production.

    it('does not include stack in error responses by default', async () => {
      const defaultMiddleware = MiddlewareFactory.create({
        logger: mockServices.logger.mock({ child: () => childLogger }),
        config: mockServices.rootConfig.mock(),
      });

      const app = express();
      app.use('/breaks', () => {
        throw new InputError('boom');
      });
      app.use(defaultMiddleware.error());

      const response = await request(app).get('/breaks');

      expect(response.status).toBe(400);
      // The error envelope is present but MUST NOT carry a `stack` field.
      expect(response.body.error).toEqual(
        expect.objectContaining({
          name: 'InputError',
          message: 'boom',
        }),
      );
      expect(response.body.error).not.toHaveProperty('stack');
    });

    it('omits stack even when NODE_ENV is development (config-driven default)', async () => {
      // `process.env.NODE_ENV` is typed as readonly by recent @types/node releases;
      // bracket-notation access via a widened view bypasses that compile-time check
      // for legitimate test scaffolding without changing runtime semantics.
      const env = process.env as Record<string, string | undefined>;
      const previousNodeEnv = env.NODE_ENV;
      // Simulate `yarn dev` which exports NODE_ENV=development; the QA report
      // F6/F4 reproduction was run in exactly this environment.
      env.NODE_ENV = 'development';
      try {
        const devMiddleware = MiddlewareFactory.create({
          logger: mockServices.logger.mock({ child: () => childLogger }),
          config: mockServices.rootConfig.mock(),
        });

        const app = express();
        app.use('/breaks', () => {
          throw new NotFoundError('missing');
        });
        app.use(devMiddleware.error());

        const response = await request(app).get('/breaks');

        expect(response.status).toBe(404);
        expect(response.body.error).not.toHaveProperty('stack');
      } finally {
        if (previousNodeEnv === undefined) {
          delete env.NODE_ENV;
        } else {
          env.NODE_ENV = previousNodeEnv;
        }
      }
    });

    it('includes stack when backend.error.includeStack is true in config', async () => {
      const optInMiddleware = MiddlewareFactory.create({
        logger: mockServices.logger.mock({ child: () => childLogger }),
        config: mockServices.rootConfig({
          data: { backend: { error: { includeStack: true } } },
        }),
      });

      const app = express();
      app.use('/breaks', () => {
        throw new InputError('boom');
      });
      app.use(optInMiddleware.error());

      const response = await request(app).get('/breaks');

      expect(response.status).toBe(400);
      // Opt-in path still works for local debugging when explicitly enabled.
      expect(response.body.error).toEqual(
        expect.objectContaining({
          name: 'InputError',
          message: 'boom',
          stack: expect.any(String),
        }),
      );
    });

    it('honours explicit showStackTraces option overriding config', async () => {
      const optInMiddleware = MiddlewareFactory.create({
        logger: mockServices.logger.mock({ child: () => childLogger }),
        config: mockServices.rootConfig({
          // Config says no stack…
          data: { backend: { error: { includeStack: false } } },
        }),
      });

      const app = express();
      app.use('/breaks', () => {
        throw new InputError('boom');
      });
      // …but the explicit option overrides config.
      app.use(optInMiddleware.error({ showStackTraces: true }));

      const response = await request(app).get('/breaks');

      expect(response.body.error).toHaveProperty('stack');
    });

    it('should log incoming requests', async () => {
      const app = express();
      app.use(middleware.logging());
      app.get('/', (_req, res) => res.send(''));

      await request(app).get('/').expect(200);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          '[2024-11-20T00:00:00.000Z] "GET / HTTP/1.1" 200 0 "-" "-"',
        ),
        {
          type: 'incomingRequest',
          date: '2024-11-20T00:00:00.000Z',
          method: 'GET',
          url: '/',
          status: 200,
          httpVersion: '1.1',
          contentLength: 0,
        },
      );
    });

    it('should log request with all data fields', async () => {
      const app = express();
      app.use(middleware.logging());
      app.get('/', (_req, res) => res.send('Hello World'));

      await request(app)
        .get('/')
        .set('User-Agent', 'test-agent')
        .set('referrer', 'test-referrer')
        .expect(200);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          '[2024-11-20T00:00:00.000Z] "GET / HTTP/1.1" 200 11 "test-referrer" "test-agent"',
        ),
        {
          type: 'incomingRequest',
          date: '2024-11-20T00:00:00.000Z',
          method: 'GET',
          url: '/',
          status: 200,
          httpVersion: '1.1',
          userAgent: 'test-agent',
          referrer: 'test-referrer',
          contentLength: 11,
        },
      );
    });
  });
});
