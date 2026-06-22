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

import { mockServices } from '@backstage/backend-test-utils';
import {
  BlitzyE2EResult,
  createBlitzyE2ESignInResolver,
} from './authModuleBlitzyE2E';
import { userLoginTotal } from './metrics';
import {
  _testOnlyCacheSize,
  _testOnlyClearUserEmailCache,
  lookupUserEmail,
} from './userEmailCache';

type ResolverInput = { result: BlitzyE2EResult };

function makeResolverCtx(options: { issueTokenImpl?: jest.Mock } = {}) {
  const issueToken =
    options.issueTokenImpl ??
    jest.fn(async () => ({
      token: 'signed-jwt',
      identity: {
        type: 'user' as const,
        userEntityRef: 'user:default/alex',
        ownershipEntityRefs: ['user:default/alex'],
      },
      providerInfo: {},
    }));
  return {
    issueToken,
    findCatalogUser: jest.fn(),
    signInWithCatalogUser: jest.fn(),
  };
}

function makeAuditorMock() {
  const successFn = jest.fn();
  const failFn = jest.fn();
  const createEvent = jest.fn(async (_options?: unknown) => ({
    success: successFn,
    fail: failFn,
  }));
  const auditor = mockServices.auditor.mock({ createEvent });
  return { auditor, createEvent, successFn, failFn };
}

function callResolver(
  resolver: ReturnType<typeof createBlitzyE2ESignInResolver>,
  input: ResolverInput,
  ctx: ReturnType<typeof makeResolverCtx>,
) {
  return resolver(
    input as Parameters<typeof resolver>[0],
    ctx as unknown as Parameters<typeof resolver>[1],
  );
}

describe('createBlitzyE2ESignInResolver', () => {
  beforeEach(() => {
    _testOnlyClearUserEmailCache();
  });

  describe('JWT claims (downstream policy consumption)', () => {
    it('includes sub, ent, and email in JWT claims for policy decoding', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyE2ESignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        { result: { email: 'alex@blitzy.com', username: 'alex' } },
        ctx,
      );
      const tokenCall = ctx.issueToken.mock.calls[0][0] as {
        claims: Record<string, unknown>;
      };
      expect(tokenCall.claims.sub).toBe('user:default/alex');
      expect(tokenCall.claims.ent).toEqual(['user:default/alex']);
      expect(tokenCall.claims.email).toBe('alex@blitzy.com');
    });

    it('derives the userEntityRef from the username', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyE2ESignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        { result: { email: 'bob@example.com', username: 'bob' } },
        ctx,
      );
      const tokenCall = ctx.issueToken.mock.calls[0][0] as {
        claims: Record<string, unknown>;
      };
      expect(tokenCall.claims.sub).toBe('user:default/bob');
    });
  });

  describe('audit event emission (user-login)', () => {
    it('emits a user-login event with severityLevel "medium" on success', async () => {
      const { auditor, createEvent, successFn, failFn } = makeAuditorMock();
      const resolver = createBlitzyE2ESignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        { result: { email: 'alex@blitzy.com', username: 'alex' } },
        ctx,
      );

      expect(createEvent).toHaveBeenCalledTimes(1);
      const eventArg = createEvent.mock.calls[0][0] as {
        eventId: string;
        severityLevel: string;
        meta: Record<string, unknown>;
      };
      expect(eventArg.eventId).toBe('user-login');
      expect(eventArg.severityLevel).toBe('medium');
      expect(eventArg.meta.provider).toBe('blitzy-e2e');
      expect(eventArg.meta.username).toBe('alex');
      expect(eventArg.meta.emailDomain).toBe('blitzy.com');
      expect(eventArg.meta.userEntityRef).toBe('user:default/alex');
      expect(eventArg.meta.correlationId).toEqual(expect.any(String));

      expect(successFn).toHaveBeenCalled();
      expect(failFn).not.toHaveBeenCalled();
    });

    it('records emailDomain "other" for non-Blitzy users', async () => {
      const { auditor, createEvent } = makeAuditorMock();
      const resolver = createBlitzyE2ESignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        { result: { email: 'bob@example.com', username: 'bob' } },
        ctx,
      );
      const eventArg = createEvent.mock.calls[0][0] as {
        meta: { emailDomain: string };
      };
      expect(eventArg.meta.emailDomain).toBe('example.com');
    });

    it('emits success() with entityRef and correlationId on successful sign-in', async () => {
      const { auditor, createEvent, successFn } = makeAuditorMock();
      const resolver = createBlitzyE2ESignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        { result: { email: 'alex@blitzy.com', username: 'alex' } },
        ctx,
      );
      const createEventCall = createEvent.mock.calls[0][0] as {
        meta: { correlationId: string };
      };
      const expectedCorrelationId = createEventCall.meta.correlationId;
      expect(successFn).toHaveBeenCalledWith({
        meta: {
          entityRef: 'user:default/alex',
          correlationId: expectedCorrelationId,
        },
      });
    });

    it('emits fail() and rethrows when issueToken rejects', async () => {
      const issueError = new Error('token issuance failed');
      const issueTokenImpl = jest.fn().mockRejectedValue(issueError);
      const { auditor, createEvent, successFn, failFn } = makeAuditorMock();
      const resolver = createBlitzyE2ESignInResolver(auditor);
      const ctx = makeResolverCtx({ issueTokenImpl });
      await expect(
        callResolver(
          resolver,
          { result: { email: 'alex@blitzy.com', username: 'alex' } },
          ctx,
        ),
      ).rejects.toBe(issueError);
      const createEventCall = createEvent.mock.calls[0][0] as {
        meta: { correlationId: string };
      };
      const expectedCorrelationId = createEventCall.meta.correlationId;
      expect(failFn).toHaveBeenCalledWith({
        error: issueError,
        meta: {
          entityRef: 'user:default/alex',
          correlationId: expectedCorrelationId,
        },
      });
      expect(successFn).not.toHaveBeenCalled();
    });

    it('rethrows when auditor.createEvent itself rejects (no token issued)', async () => {
      const createErr = new Error('audit transport down');
      const createEvent = jest.fn(async () => {
        throw createErr;
      });
      const auditor = mockServices.auditor.mock({ createEvent });
      const resolver = createBlitzyE2ESignInResolver(auditor);
      const ctx = makeResolverCtx();
      await expect(
        callResolver(
          resolver,
          { result: { email: 'alex@blitzy.com', username: 'alex' } },
          ctx,
        ),
      ).rejects.toBe(createErr);
      expect(ctx.issueToken).not.toHaveBeenCalled();
    });

    it('generates a unique correlationId per invocation', async () => {
      const { auditor, createEvent } = makeAuditorMock();
      const resolver = createBlitzyE2ESignInResolver(auditor);
      await callResolver(
        resolver,
        { result: { email: 'a@blitzy.com', username: 'a' } },
        makeResolverCtx(),
      );
      await callResolver(
        resolver,
        { result: { email: 'b@blitzy.com', username: 'b' } },
        makeResolverCtx(),
      );
      const id1 = (
        createEvent.mock.calls[0][0] as { meta: { correlationId: string } }
      ).meta.correlationId;
      const id2 = (
        createEvent.mock.calls[1][0] as { meta: { correlationId: string } }
      ).meta.correlationId;
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('PII discipline (security)', () => {
    it('does NOT include the full email in audit createEvent meta', async () => {
      const { auditor, createEvent } = makeAuditorMock();
      const resolver = createBlitzyE2ESignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        { result: { email: 'alex.private@blitzy.com', username: 'alex' } },
        ctx,
      );
      const meta = createEvent.mock.calls[0][0];
      // The full email must NOT appear anywhere in the audit metadata.
      expect(JSON.stringify(meta)).not.toContain('alex.private@blitzy.com');
    });

    it('does NOT include the full email in audit success() meta', async () => {
      const { auditor, successFn } = makeAuditorMock();
      const resolver = createBlitzyE2ESignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        { result: { email: 'alex.private@blitzy.com', username: 'alex' } },
        ctx,
      );
      const successMeta = successFn.mock.calls[0][0];
      expect(JSON.stringify(successMeta)).not.toContain(
        'alex.private@blitzy.com',
      );
    });
  });

  describe('email cache population', () => {
    it('caches the email keyed by userEntityRef on successful sign-in', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyE2ESignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        { result: { email: 'alex@blitzy.com', username: 'alex' } },
        ctx,
      );
      expect(lookupUserEmail('user:default/alex')).toBe('alex@blitzy.com');
      expect(_testOnlyCacheSize()).toBe(1);
    });

    it("caches non-Blitzy emails as well (domain filtering is the policy's job)", async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyE2ESignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        { result: { email: 'bob@example.com', username: 'bob' } },
        ctx,
      );
      expect(lookupUserEmail('user:default/bob')).toBe('bob@example.com');
    });

    it('does NOT cache the email when issueToken throws', async () => {
      const issueError = new Error('token issuance failed');
      const issueTokenImpl = jest.fn().mockRejectedValue(issueError);
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyE2ESignInResolver(auditor);
      const ctx = makeResolverCtx({ issueTokenImpl });
      await expect(
        callResolver(
          resolver,
          { result: { email: 'alex@blitzy.com', username: 'alex' } },
          ctx,
        ),
      ).rejects.toBe(issueError);
      expect(_testOnlyCacheSize()).toBe(0);
    });

    it('does NOT cache the email when auditor.createEvent throws', async () => {
      const createErr = new Error('audit transport down');
      const createEvent = jest.fn(async () => {
        throw createErr;
      });
      const auditor = mockServices.auditor.mock({ createEvent });
      const resolver = createBlitzyE2ESignInResolver(auditor);
      const ctx = makeResolverCtx();
      await expect(
        callResolver(
          resolver,
          { result: { email: 'alex@blitzy.com', username: 'alex' } },
          ctx,
        ),
      ).rejects.toBe(createErr);
      expect(_testOnlyCacheSize()).toBe(0);
    });
  });

  describe('metrics emission', () => {
    let counterSpy: jest.SpyInstance;

    beforeEach(() => {
      counterSpy = jest.spyOn(userLoginTotal, 'add');
    });

    afterEach(() => {
      counterSpy.mockRestore();
    });

    it('increments user_login_total with provider="blitzy-e2e" on success', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyE2ESignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        { result: { email: 'alex@blitzy.com', username: 'alex' } },
        ctx,
      );
      expect(counterSpy).toHaveBeenCalledTimes(1);
      expect(counterSpy).toHaveBeenCalledWith(1, {
        provider: 'blitzy-e2e',
        email_domain: 'blitzy.com',
      });
    });

    it('increments user_login_total with email_domain="other" for non-Blitzy users', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyE2ESignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        { result: { email: 'bob@example.com', username: 'bob' } },
        ctx,
      );
      expect(counterSpy).toHaveBeenCalledWith(1, {
        provider: 'blitzy-e2e',
        email_domain: 'other',
      });
    });

    it('increments user_login_total even when token issuance fails', async () => {
      const issueError = new Error('token issuance failed');
      const issueTokenImpl = jest.fn().mockRejectedValue(issueError);
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyE2ESignInResolver(auditor);
      const ctx = makeResolverCtx({ issueTokenImpl });
      await expect(
        callResolver(
          resolver,
          { result: { email: 'alex@blitzy.com', username: 'alex' } },
          ctx,
        ),
      ).rejects.toBe(issueError);
      // Counter is incremented BEFORE auditor.createEvent — it tracks
      // observed sign-in attempts.
      expect(counterSpy).toHaveBeenCalledTimes(1);
    });
  });
});
