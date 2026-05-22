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
import type {
  OAuthAuthenticatorResult,
  PassportProfile,
} from '@backstage/plugin-auth-node';
import {
  createBlitzyGithubSignInResolver,
  selectPrimaryGithubEmail,
} from './authModuleGithubProvider';
import { bucketSignInEmailDomain, userLoginTotal } from './metrics';

type ResolverInput = {
  result: OAuthAuthenticatorResult<PassportProfile>;
};

/**
 * Builds a minimal `OAuthAuthenticatorResult<PassportProfile>` for the
 * resolver. Only the fields read by the resolver are populated.
 */
function makeOAuthResult(options: {
  username?: string;
  emails?: Array<{ value: string; primary?: boolean; verified?: boolean }>;
  userinfoEmail?: string;
}): OAuthAuthenticatorResult<PassportProfile> {
  const profile: Partial<PassportProfile> = {
    username: options.username,
    emails: options.emails as PassportProfile['emails'],
  };
  const result: Partial<OAuthAuthenticatorResult<PassportProfile>> & {
    userinfo?: { email?: string };
  } = {
    fullProfile: profile as PassportProfile,
    // The OAuth session payload is unused by the resolver under test.
    session: {
      accessToken: 'gh-access-token',
      tokenType: 'bearer',
      scope: 'read:user user:email',
    },
  };
  if (options.userinfoEmail !== undefined) {
    result.userinfo = { email: options.userinfoEmail };
  }
  return result as OAuthAuthenticatorResult<PassportProfile>;
}

/**
 * Constructs a Jest-mocked `AuthResolverContext.issueToken` and the
 * surrounding resolver context object. Test cases configure the mock to
 * either resolve (success path) or reject (failure path), then assert
 * which audit lifecycle method was called.
 */
function makeResolverCtx(
  options: {
    issueTokenImpl?: jest.Mock;
  } = {},
) {
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

/**
 * Creates a fresh `mockServices.auditor.mock()` auditor whose
 * `createEvent` returns `{ success, fail }` jest.fn()s. The fluent
 * interface from `@backstage/backend-test-utils` already mocks `success`
 * and `fail` automatically; this helper just provides a stable handle
 * to the inner mocks for assertions.
 */
function makeAuditorMock() {
  const successFn = jest.fn();
  const failFn = jest.fn();
  // The `createEvent` mock declares its parameter as `unknown` so that
  // `createEvent.mock.calls[i][0]` is typed as a one-element tuple. Without
  // an explicit parameter, jest infers `() => Promise<...>` which produces a
  // zero-length tuple and breaks every `mock.calls[i][0]` access in the
  // assertions below with TS2493 ("Tuple type '[]' has no element at index 0").
  const createEvent = jest.fn(async (_options?: unknown) => ({
    success: successFn,
    fail: failFn,
  }));
  const auditor = mockServices.auditor.mock({
    createEvent,
  });
  return { auditor, createEvent, successFn, failFn };
}

describe('selectPrimaryGithubEmail', () => {
  it('returns undefined for undefined emails', () => {
    expect(selectPrimaryGithubEmail(undefined)).toBeUndefined();
  });

  it('returns undefined for empty emails array', () => {
    expect(selectPrimaryGithubEmail([])).toBeUndefined();
  });

  it('returns index 0 in default mode (single entry, no primary flag)', () => {
    expect(selectPrimaryGithubEmail([{ value: 'alex@blitzy.com' }])).toBe(
      'alex@blitzy.com',
    );
  });

  it('returns explicit primary email regardless of position', () => {
    // raw mode: primary is at index 2, not at index 0
    expect(
      selectPrimaryGithubEmail([
        { value: 'work@example.com', primary: false } as {
          value: string;
          primary?: boolean;
        },
        { value: 'noreply@example.com', primary: false } as {
          value: string;
          primary?: boolean;
        },
        { value: 'alex@blitzy.com', primary: true } as {
          value: string;
          primary?: boolean;
        },
      ]),
    ).toBe('alex@blitzy.com');
  });

  it('returns primary when it is also at index 0', () => {
    expect(
      selectPrimaryGithubEmail([
        { value: 'alex@blitzy.com', primary: true } as {
          value: string;
          primary?: boolean;
        },
        { value: 'work@example.com', primary: false } as {
          value: string;
          primary?: boolean;
        },
      ]),
    ).toBe('alex@blitzy.com');
  });

  it('falls back to index 0 when no entry is flagged primary', () => {
    // Both entries have primary: false (anomalous raw-mode response).
    // The helper falls back to index 0 rather than returning undefined,
    // matching the documented default-mode contract.
    expect(
      selectPrimaryGithubEmail([
        { value: 'work@example.com', primary: false } as {
          value: string;
          primary?: boolean;
        },
        { value: 'alex@blitzy.com', primary: false } as {
          value: string;
          primary?: boolean;
        },
      ]),
    ).toBe('work@example.com');
  });
});

describe('createBlitzyGithubSignInResolver', () => {
  // The resolver signature requires every callback parameter; we only use
  // `result` from the first arg, but we must satisfy the type.
  function callResolver(
    resolver: ReturnType<typeof createBlitzyGithubSignInResolver>,
    input: ResolverInput,
    ctx: ReturnType<typeof makeResolverCtx>,
  ) {
    return resolver(
      input as Parameters<typeof resolver>[0],
      ctx as unknown as Parameters<typeof resolver>[1],
    );
  }

  describe('username validation', () => {
    it('throws when fullProfile.username is missing', async () => {
      const { auditor, createEvent } = makeAuditorMock();
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx = makeResolverCtx();
      await expect(
        callResolver(
          resolver,
          { result: makeOAuthResult({ username: undefined }) },
          ctx,
        ),
      ).rejects.toThrow('GitHub user profile does not contain a username');
      // Audit event should NOT have been created when username is missing
      // — the resolver throws before reaching `auditor.createEvent`.
      expect(createEvent).not.toHaveBeenCalled();
    });
  });

  describe('email extraction priority', () => {
    it('selects email flagged primary even when not at index 0', async () => {
      const { auditor, createEvent, successFn } = makeAuditorMock();
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        {
          result: makeOAuthResult({
            username: 'alex',
            emails: [
              { value: 'noreply@example.com', primary: false } as {
                value: string;
                primary?: boolean;
              },
              { value: 'alex@blitzy.com', primary: true } as {
                value: string;
                primary?: boolean;
              },
              { value: 'work@example.com', primary: false } as {
                value: string;
                primary?: boolean;
              },
            ],
          }),
        },
        ctx,
      );
      // JWT must carry the verified primary email (alex@blitzy.com), NOT
      // the index-0 email (noreply@example.com).
      expect(ctx.issueToken).toHaveBeenCalledWith({
        claims: expect.objectContaining({
          sub: 'user:default/alex',
          ent: ['user:default/alex'],
          email: 'alex@blitzy.com',
        }),
      });
      // The audit event domain must reflect the primary (blitzy.com),
      // not the secondary (example.com).
      expect(createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'user-login',
          severityLevel: 'medium',
          meta: expect.objectContaining({
            provider: 'github',
            username: 'alex',
            emailDomain: 'blitzy.com',
            userEntityRef: 'user:default/alex',
            correlationId: expect.any(String),
          }),
        }),
      );
      expect(successFn).toHaveBeenCalled();
    });

    it('falls back to userinfo.email when fullProfile.emails is missing', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        {
          result: makeOAuthResult({
            username: 'jane',
            emails: undefined,
            userinfoEmail: 'jane@oidc.example.org',
          }),
        },
        ctx,
      );
      expect(ctx.issueToken).toHaveBeenCalledWith({
        claims: expect.objectContaining({
          email: 'jane@oidc.example.org',
        }),
      });
    });

    it('falls back to <userId>@unknown.invalid when all sources are missing', async () => {
      const { auditor, createEvent } = makeAuditorMock();
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        {
          result: makeOAuthResult({ username: 'no-email-user' }),
        },
        ctx,
      );
      expect(ctx.issueToken).toHaveBeenCalledWith({
        claims: expect.objectContaining({
          email: 'no-email-user@unknown.invalid',
        }),
      });
      expect(createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({
            emailDomain: 'unknown.invalid',
          }),
        }),
      );
    });

    it('falls back to index 0 in default passport-github2 mode (single entry, no primary flag)', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        {
          result: makeOAuthResult({
            username: 'alex',
            emails: [{ value: 'alex@blitzy.com' }],
          }),
        },
        ctx,
      );
      expect(ctx.issueToken).toHaveBeenCalledWith({
        claims: expect.objectContaining({ email: 'alex@blitzy.com' }),
      });
    });
  });

  describe('audit event lifecycle', () => {
    it('emits success() with entityRef and correlationId on successful sign-in', async () => {
      const { auditor, createEvent, successFn, failFn } = makeAuditorMock();
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        {
          result: makeOAuthResult({
            username: 'alex',
            emails: [{ value: 'alex@blitzy.com' }],
          }),
        },
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
      expect(failFn).not.toHaveBeenCalled();
    });

    it('emits fail() with error, entityRef, and correlationId when issueToken throws', async () => {
      const issueError = new Error('token issuance failed');
      const issueTokenImpl = jest.fn().mockRejectedValue(issueError);
      const { auditor, createEvent, successFn, failFn } = makeAuditorMock();
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx = makeResolverCtx({ issueTokenImpl });
      await expect(
        callResolver(
          resolver,
          {
            result: makeOAuthResult({
              username: 'alex',
              emails: [{ value: 'alex@blitzy.com' }],
            }),
          },
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

    it('rethrows when auditor.createEvent itself fails (no token issued)', async () => {
      const createErr = new Error('audit transport down');
      const createEvent = jest.fn(async () => {
        throw createErr;
      });
      const auditor = mockServices.auditor.mock({ createEvent });
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx = makeResolverCtx();
      await expect(
        callResolver(
          resolver,
          {
            result: makeOAuthResult({
              username: 'alex',
              emails: [{ value: 'alex@blitzy.com' }],
            }),
          },
          ctx,
        ),
      ).rejects.toBe(createErr);
      expect(ctx.issueToken).not.toHaveBeenCalled();
    });

    it('generates a unique correlationId per invocation', async () => {
      const { auditor, createEvent } = makeAuditorMock();
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx1 = makeResolverCtx();
      const ctx2 = makeResolverCtx();
      await callResolver(
        resolver,
        {
          result: makeOAuthResult({
            username: 'a',
            emails: [{ value: 'a@blitzy.com' }],
          }),
        },
        ctx1,
      );
      await callResolver(
        resolver,
        {
          result: makeOAuthResult({
            username: 'b',
            emails: [{ value: 'b@blitzy.com' }],
          }),
        },
        ctx2,
      );
      const id1 = (
        createEvent.mock.calls[0][0] as { meta: { correlationId: string } }
      ).meta.correlationId;
      const id2 = (
        createEvent.mock.calls[1][0] as { meta: { correlationId: string } }
      ).meta.correlationId;
      expect(id1).not.toBe(id2);
      // UUID v4 format sanity check
      expect(id1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('PII discipline (security)', () => {
    it('does NOT include the full email in audit createEvent meta', async () => {
      const { auditor, createEvent } = makeAuditorMock();
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        {
          result: makeOAuthResult({
            username: 'alex',
            emails: [{ value: 'alex.private@blitzy.com' }],
          }),
        },
        ctx,
      );
      const meta = (
        createEvent.mock.calls[0][0] as { meta: Record<string, unknown> }
      ).meta;
      // Domain bucket only — the full email must NOT appear anywhere in
      // the audit metadata. Search the entire serialized meta for the
      // sensitive substring.
      expect(JSON.stringify(meta)).not.toContain('alex.private@blitzy.com');
      expect(meta.emailDomain).toBe('blitzy.com');
    });

    it('does NOT include the full email in audit success() meta', async () => {
      const { auditor, successFn } = makeAuditorMock();
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        {
          result: makeOAuthResult({
            username: 'alex',
            emails: [{ value: 'alex.private@blitzy.com' }],
          }),
        },
        ctx,
      );
      const successMeta = successFn.mock.calls[0][0];
      expect(JSON.stringify(successMeta)).not.toContain(
        'alex.private@blitzy.com',
      );
    });

    it('does NOT include the OAuth access token in audit meta', async () => {
      const { auditor, createEvent } = makeAuditorMock();
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        {
          result: makeOAuthResult({
            username: 'alex',
            emails: [{ value: 'alex@blitzy.com' }],
          }),
        },
        ctx,
      );
      const meta = createEvent.mock.calls[0][0];
      // The OAuth access token must never appear in audit metadata.
      expect(JSON.stringify(meta)).not.toContain('gh-access-token');
    });
  });

  describe('JWT claims (downstream policy consumption)', () => {
    it('includes sub, ent, and email in JWT claims for policy decoding', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        {
          result: makeOAuthResult({
            username: 'alex',
            emails: [{ value: 'alex@blitzy.com' }],
          }),
        },
        ctx,
      );
      expect(ctx.issueToken).toHaveBeenCalledTimes(1);
      const tokenCall = ctx.issueToken.mock.calls[0][0] as {
        claims: Record<string, unknown>;
      };
      expect(tokenCall.claims.sub).toBe('user:default/alex');
      expect(tokenCall.claims.ent).toEqual(['user:default/alex']);
      expect(tokenCall.claims.email).toBe('alex@blitzy.com');
    });

    it('lowercases the emailDomain for consistent comparison', async () => {
      const { auditor, createEvent } = makeAuditorMock();
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        {
          result: makeOAuthResult({
            username: 'alex',
            // Note: GitHub emails are case-preserving but our domain
            // comparison must be case-insensitive.
            emails: [{ value: 'alex@BLITZY.COM' }],
          }),
        },
        ctx,
      );
      const createEventMeta = (
        createEvent.mock.calls[0][0] as { meta: { emailDomain: string } }
      ).meta;
      expect(createEventMeta.emailDomain).toBe('blitzy.com');
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

    it('increments user_login_total once with bucketed blitzy.com domain on success', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        {
          result: makeOAuthResult({
            username: 'alex',
            emails: [{ value: 'alex@blitzy.com' }],
          }),
        },
        ctx,
      );
      expect(counterSpy).toHaveBeenCalledTimes(1);
      expect(counterSpy).toHaveBeenCalledWith(1, {
        provider: 'github',
        email_domain: 'blitzy.com',
      });
    });

    it('increments user_login_total with bucket "other" for non-blitzy domains', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        {
          result: makeOAuthResult({
            username: 'alex',
            emails: [{ value: 'alex@example.com' }],
          }),
        },
        ctx,
      );
      expect(counterSpy).toHaveBeenCalledTimes(1);
      expect(counterSpy).toHaveBeenCalledWith(1, {
        provider: 'github',
        email_domain: 'other',
      });
    });

    it('increments user_login_total with bucket "unknown" when no email is available', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx = makeResolverCtx();
      await callResolver(
        resolver,
        {
          result: makeOAuthResult({
            username: 'alex',
            // No emails and no userinfo email — resolver will fall back
            // to the synthetic `<username>@unknown.invalid` placeholder,
            // which buckets to "unknown".
          }),
        },
        ctx,
      );
      expect(counterSpy).toHaveBeenCalledTimes(1);
      expect(counterSpy).toHaveBeenCalledWith(1, {
        provider: 'github',
        email_domain: 'unknown',
      });
    });

    it('increments user_login_total even when token issuance fails', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyGithubSignInResolver(auditor);
      const ctx = makeResolverCtx();
      // Force token issuance to fail; the counter still records the
      // observed sign-in attempt because it is recorded before the
      // auditor.createEvent call.
      ctx.issueToken.mockRejectedValueOnce(new Error('token issuance failed'));
      await expect(
        callResolver(
          resolver,
          {
            result: makeOAuthResult({
              username: 'alex',
              emails: [{ value: 'alex@blitzy.com' }],
            }),
          },
          ctx,
        ),
      ).rejects.toThrow('token issuance failed');
      expect(counterSpy).toHaveBeenCalledTimes(1);
      expect(counterSpy).toHaveBeenCalledWith(1, {
        provider: 'github',
        email_domain: 'blitzy.com',
      });
    });
  });
});

describe('bucketSignInEmailDomain', () => {
  it('returns "blitzy.com" for the blitzy domain', () => {
    expect(bucketSignInEmailDomain('blitzy.com')).toBe('blitzy.com');
    expect(bucketSignInEmailDomain('BLITZY.COM')).toBe('blitzy.com');
  });

  it('returns "other" for non-blitzy domains', () => {
    expect(bucketSignInEmailDomain('example.com')).toBe('other');
    expect(bucketSignInEmailDomain('dev.blitzy.com')).toBe('other');
    expect(bucketSignInEmailDomain('notblitzy.com')).toBe('other');
  });

  it('returns "unknown" for empty, missing, or unknown.invalid', () => {
    expect(bucketSignInEmailDomain(undefined)).toBe('unknown');
    expect(bucketSignInEmailDomain('')).toBe('unknown');
    expect(bucketSignInEmailDomain('unknown.invalid')).toBe('unknown');
  });
});
