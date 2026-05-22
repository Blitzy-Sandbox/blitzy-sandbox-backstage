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

import { SignJWT } from 'jose';
import {
  AuthorizeResult,
  createPermission,
} from '@backstage/plugin-permission-common';
import {
  PolicyQuery,
  PolicyQueryUser,
} from '@backstage/plugin-permission-node';
import { BlitzyPermissionPolicy, extractEmail } from './policy';
import { blitzyPermissionDecisionsTotal, bucketEmailDomain } from './metrics';

/**
 * Signs a minimal JWT carrying the supplied claims for use in tests.
 *
 * The token is signed with a throwaway HS256 secret — `BlitzyPermissionPolicy`
 * uses `jose.decodeJwt` (non-verifying decode) because the auth backend
 * already cryptographically verified the token before invoking the
 * policy. The signing here is only to produce a valid JWT structure.
 */
async function makeUserToken(claims: Record<string, unknown>): Promise<string> {
  const secret = new TextEncoder().encode('blitzy-policy-test-secret');
  const jwt = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
  return jwt;
}

/**
 * Builds a synthetic `PolicyQueryUser` whose `credentials.token` is a
 * JWT carrying the supplied custom claims (typically including
 * `email`). The shape mirrors what `plugins/permission-backend/src/
 * service/router.ts` builds from `auth.isPrincipal(credentials, 'user')`
 * plus the credentials returned by `DefaultAuthService.authenticate`.
 */
async function makeUser(options: {
  userEntityRef: string;
  email?: string;
  principalType?: string;
  omitInfoEmail?: boolean;
  rawToken?: string;
}): Promise<PolicyQueryUser> {
  const { userEntityRef } = options;
  const claims: Record<string, unknown> = {
    sub: userEntityRef,
    ent: [userEntityRef],
  };
  if (options.email !== undefined) {
    claims.email = options.email;
  }
  const token = options.rawToken ?? (await makeUserToken(claims));
  // Synthetic credentials object mirroring the shape produced by
  // `createCredentialsWithUserPrincipal`. The internal helper stores
  // `token` as a non-enumerable property, but the policy reads it via
  // a structural cast so a plain enumerable property is functionally
  // equivalent for testing purposes.
  const credentials = {
    $$type: '@backstage/BackstageCredentials' as const,
    version: 'v1',
    principal: {
      type: options.principalType ?? 'user',
      userEntityRef,
    },
    token,
  };
  return {
    token,
    identity: {
      type: 'user',
      userEntityRef,
      ownershipEntityRefs: [userEntityRef],
    },
    credentials: credentials as unknown as PolicyQueryUser['credentials'],
    info: {
      userEntityRef,
      ownershipEntityRefs: [userEntityRef],
      // BackstageUserInfo does not declare an `email` field, but the
      // policy reads it forward-compatibly via a structural cast.
      ...(options.omitInfoEmail || options.email === undefined
        ? {}
        : ({} as { email?: string })),
    },
  };
}

function readPermission(name = 'catalog.entity.read'): PolicyQuery {
  return {
    permission: createPermission({
      name,
      attributes: { action: 'read' },
    }),
  };
}

function writePermission(
  action: 'create' | 'update' | 'delete',
  name = `catalog.entity.${action}`,
): PolicyQuery {
  return {
    permission: createPermission({
      name,
      attributes: { action },
    }),
  };
}

describe('BlitzyPermissionPolicy', () => {
  let policy: BlitzyPermissionPolicy;

  beforeEach(() => {
    policy = new BlitzyPermissionPolicy();
  });

  describe('read actions', () => {
    it('allows read action for anonymous (no user) callers', async () => {
      const decision = await policy.handle(readPermission(), undefined);
      expect(decision).toEqual({ result: AuthorizeResult.ALLOW });
    });

    it('allows read action for guest principals', async () => {
      const user = await makeUser({ userEntityRef: 'user:default/guest' });
      const decision = await policy.handle(readPermission(), user);
      expect(decision).toEqual({ result: AuthorizeResult.ALLOW });
    });

    it('allows read action for non-blitzy domain users', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/jane',
        email: 'jane@example.com',
      });
      const decision = await policy.handle(readPermission(), user);
      expect(decision).toEqual({ result: AuthorizeResult.ALLOW });
    });

    it('allows read action for blitzy domain users', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/alex',
        email: 'alex@blitzy.com',
      });
      const decision = await policy.handle(readPermission(), user);
      expect(decision).toEqual({ result: AuthorizeResult.ALLOW });
    });

    it('allows read action when permission has no explicit action', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/jane',
        email: 'jane@example.com',
      });
      // Some permissions in the wild omit `attributes.action`; the
      // default Backstage behavior treats these as non-read writes. The
      // policy must NOT short-circuit to ALLOW in that case.
      const permission: PolicyQuery = {
        permission: createPermission({
          name: 'some.permission.without.action',
          attributes: {},
        }),
      };
      const decision = await policy.handle(permission, user);
      expect(decision).toEqual({ result: AuthorizeResult.DENY });
    });
  });

  describe('guest principal restrictions', () => {
    it.each(['create', 'update', 'delete'] as const)(
      'denies %s action for anonymous (no user) callers',
      async action => {
        const decision = await policy.handle(
          writePermission(action),
          undefined,
        );
        expect(decision).toEqual({ result: AuthorizeResult.DENY });
      },
    );

    it.each(['create', 'update', 'delete'] as const)(
      'denies %s action for explicit guest entity ref',
      async action => {
        const user = await makeUser({ userEntityRef: 'user:default/guest' });
        const decision = await policy.handle(writePermission(action), user);
        expect(decision).toEqual({ result: AuthorizeResult.DENY });
      },
    );

    it('denies write for principals whose principal.type === "guest"', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/some-other-guest-name',
        principalType: 'guest',
        email: 'whatever@blitzy.com',
      });
      const decision = await policy.handle(writePermission('create'), user);
      expect(decision).toEqual({ result: AuthorizeResult.DENY });
    });
  });

  describe('blitzy domain write access', () => {
    it.each(['create', 'update', 'delete'] as const)(
      'allows %s action for verified @blitzy.com email (JWT claim)',
      async action => {
        const user = await makeUser({
          userEntityRef: 'user:default/alex',
          email: 'alex@blitzy.com',
        });
        const decision = await policy.handle(writePermission(action), user);
        expect(decision).toEqual({ result: AuthorizeResult.ALLOW });
      },
    );

    it('allows write for case-insensitive blitzy email (UPPER@BLITZY.COM)', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/alex',
        email: 'ALEX@BLITZY.COM',
      });
      const decision = await policy.handle(writePermission('create'), user);
      expect(decision).toEqual({ result: AuthorizeResult.ALLOW });
    });

    it('allows write for mixed-case domain (alex@Blitzy.Com)', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/alex',
        email: 'alex@Blitzy.Com',
      });
      const decision = await policy.handle(writePermission('update'), user);
      expect(decision).toEqual({ result: AuthorizeResult.ALLOW });
    });
  });

  describe('non-blitzy domain write denials', () => {
    it('denies write for legitimate-looking non-blitzy domain (@example.com)', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/jane',
        email: 'jane@example.com',
      });
      const decision = await policy.handle(writePermission('create'), user);
      expect(decision).toEqual({ result: AuthorizeResult.DENY });
    });

    it('denies write for blitzy subdomain (@dev.blitzy.com)', async () => {
      // Strict suffix match — subdomains are not trusted.
      const user = await makeUser({
        userEntityRef: 'user:default/imposter',
        email: 'imposter@dev.blitzy.com',
      });
      const decision = await policy.handle(writePermission('update'), user);
      expect(decision).toEqual({ result: AuthorizeResult.DENY });
    });

    it('denies write for blitzy lookalike (@notblitzy.com)', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/imposter',
        email: 'imposter@notblitzy.com',
      });
      const decision = await policy.handle(writePermission('delete'), user);
      expect(decision).toEqual({ result: AuthorizeResult.DENY });
    });

    it('denies write for trailing-slash lookalike (@blitzy.com.evil.org)', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/imposter',
        email: 'imposter@blitzy.com.evil.org',
      });
      const decision = await policy.handle(writePermission('create'), user);
      expect(decision).toEqual({ result: AuthorizeResult.DENY });
    });
  });

  describe('missing-email edge cases', () => {
    it('denies write when JWT lacks email claim', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/jane',
        // No `email` claim — emulates a regression in the signInResolver.
      });
      const decision = await policy.handle(writePermission('create'), user);
      expect(decision).toEqual({ result: AuthorizeResult.DENY });
    });

    it('denies write when credentials.token is missing', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/jane',
        email: 'jane@blitzy.com',
      });
      // Strip the token after construction.
      (user.credentials as { token?: string }).token = undefined;
      const decision = await policy.handle(writePermission('create'), user);
      expect(decision).toEqual({ result: AuthorizeResult.DENY });
    });

    it('denies write when credentials.token is malformed (not a JWT)', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/jane',
        rawToken: 'not-a-valid-jwt',
      });
      const decision = await policy.handle(writePermission('create'), user);
      expect(decision).toEqual({ result: AuthorizeResult.DENY });
    });

    it('denies write when JWT email claim is empty string', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/jane',
        email: '',
      });
      const decision = await policy.handle(writePermission('create'), user);
      expect(decision).toEqual({ result: AuthorizeResult.DENY });
    });

    it('denies write when JWT email claim is the unknown.invalid fallback', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/no-email-user',
        email: 'no-email-user@unknown.invalid',
      });
      const decision = await policy.handle(writePermission('create'), user);
      expect(decision).toEqual({ result: AuthorizeResult.DENY });
    });
  });

  describe('forward-compatible info.email path', () => {
    it('allows write when user.info.email is @blitzy.com (custom UserInfoService)', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/alex',
        // JWT has NO email claim — but info.email is set, emulating a
        // custom UserInfoService that hydrates email.
      });
      (user.info as { email?: string }).email = 'alex@blitzy.com';
      const decision = await policy.handle(writePermission('create'), user);
      expect(decision).toEqual({ result: AuthorizeResult.ALLOW });
    });

    it('denies write when user.info.email is non-blitzy even if JWT has blitzy email', async () => {
      // info.email takes priority over JWT decode — this prevents a
      // future custom UserInfoService that intentionally narrows access
      // from being silently bypassed by a stale JWT email claim.
      const user = await makeUser({
        userEntityRef: 'user:default/alex',
        email: 'alex@blitzy.com',
      });
      (user.info as { email?: string }).email = 'alex@example.com';
      const decision = await policy.handle(writePermission('create'), user);
      expect(decision).toEqual({ result: AuthorizeResult.DENY });
    });
  });

  describe('extractEmail helper (internal)', () => {
    it('returns undefined for missing user', () => {
      expect(extractEmail(undefined)).toBeUndefined();
    });

    it('returns info.email when present', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/alex',
        email: 'alex@blitzy.com',
      });
      (user.info as { email?: string }).email = 'alex@example.com';
      expect(extractEmail(user)).toBe('alex@example.com');
    });

    it('returns decoded JWT email when info.email is absent', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/alex',
        email: 'alex@blitzy.com',
      });
      expect(extractEmail(user)).toBe('alex@blitzy.com');
    });

    it('returns undefined when JWT cannot be decoded', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/alex',
        rawToken: 'this is not a jwt',
      });
      expect(extractEmail(user)).toBeUndefined();
    });

    it('returns undefined when JWT email claim is not a string', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/alex',
        // Force a non-string email claim by signing it directly.
        rawToken: await makeUserToken({
          sub: 'user:default/alex',
          email: 12345,
        }),
      });
      expect(extractEmail(user)).toBeUndefined();
    });
  });

  describe('metrics emission', () => {
    let counterSpy: jest.SpyInstance;

    beforeEach(() => {
      // Spy on the shared counter so each test can assert that handle()
      // increments exactly once with the bucketed labels. The counter is
      // a singleton across the module's lifetime; spying-and-restoring
      // keeps the spec hermetic.
      counterSpy = jest.spyOn(blitzyPermissionDecisionsTotal, 'add');
    });

    afterEach(() => {
      counterSpy.mockRestore();
    });

    it('increments once per handle() call with ALLOW for read action by guest', async () => {
      const user = await makeUser({ userEntityRef: 'user:default/guest' });
      await policy.handle(readPermission(), user);
      expect(counterSpy).toHaveBeenCalledTimes(1);
      expect(counterSpy).toHaveBeenCalledWith(1, {
        result: 'ALLOW',
        email_domain: 'guest',
        action: 'read',
      });
    });

    it('increments once with ALLOW + blitzy.com for blitzy write', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/alex',
        email: 'alex@blitzy.com',
      });
      await policy.handle(writePermission('create'), user);
      expect(counterSpy).toHaveBeenCalledTimes(1);
      expect(counterSpy).toHaveBeenCalledWith(1, {
        result: 'ALLOW',
        email_domain: 'blitzy.com',
        action: 'create',
      });
    });

    it('increments once with DENY + other for non-blitzy write', async () => {
      const user = await makeUser({
        userEntityRef: 'user:default/external',
        email: 'external@example.com',
      });
      await policy.handle(writePermission('update'), user);
      expect(counterSpy).toHaveBeenCalledTimes(1);
      expect(counterSpy).toHaveBeenCalledWith(1, {
        result: 'DENY',
        email_domain: 'other',
        action: 'update',
      });
    });

    it('increments once with DENY + guest for guest write', async () => {
      const user = await makeUser({ userEntityRef: 'user:default/guest' });
      await policy.handle(writePermission('delete'), user);
      expect(counterSpy).toHaveBeenCalledTimes(1);
      expect(counterSpy).toHaveBeenCalledWith(1, {
        result: 'DENY',
        email_domain: 'guest',
        action: 'delete',
      });
    });

    it('increments with action=unknown when permission has no attribute', async () => {
      const user = await makeUser({ userEntityRef: 'user:default/guest' });
      const query: PolicyQuery = {
        permission: createPermission({
          name: 'something.weird',
          attributes: {},
        }),
      };
      await policy.handle(query, user);
      expect(counterSpy).toHaveBeenCalledTimes(1);
      expect(counterSpy).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ action: 'unknown' }),
      );
    });
  });

  describe('bucketEmailDomain (metrics helper)', () => {
    it('returns "guest" when isGuest is true regardless of email', () => {
      expect(bucketEmailDomain(undefined, true)).toBe('guest');
      expect(bucketEmailDomain('alex@blitzy.com', true)).toBe('guest');
    });

    it('returns "blitzy.com" for blitzy emails when not guest', () => {
      expect(bucketEmailDomain('alex@blitzy.com', false)).toBe('blitzy.com');
      expect(bucketEmailDomain('ALEX@BLITZY.COM', false)).toBe('blitzy.com');
    });

    it('returns "other" for non-blitzy emails and undefined', () => {
      expect(bucketEmailDomain('alex@example.com', false)).toBe('other');
      expect(bucketEmailDomain(undefined, false)).toBe('other');
      // Lookalikes and subdomains are not blitzy.com.
      expect(bucketEmailDomain('alex@dev.blitzy.com', false)).toBe('other');
      expect(bucketEmailDomain('alex@notblitzy.com', false)).toBe('other');
    });
  });
});
