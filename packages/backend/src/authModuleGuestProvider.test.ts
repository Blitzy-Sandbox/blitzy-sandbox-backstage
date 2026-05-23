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

import { ConfigReader } from '@backstage/config';
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';
import {
  authProvidersExtensionPoint,
  type AuthProvidersExtensionPoint,
} from '@backstage/plugin-auth-node';
import { NotAllowedError } from '@backstage/errors';
import {
  authModuleGuestProvider,
  createBlitzyGuestSignInResolver,
  guestAuthenticator,
} from './authModuleGuestProvider';
import { userLoginTotal } from './metrics';

/**
 * Helper to set `process.env.NODE_ENV` in tests despite the readonly
 * typing introduced in recent `@types/node` versions (Node 22). The
 * underlying property is still mutable at runtime; this cast simply
 * narrows the type to a mutable shape so TypeScript permits the
 * assignment. The runtime semantics are unchanged.
 */
function setNodeEnv(value: string | undefined): void {
  (process.env as { NODE_ENV?: string }).NODE_ENV = value;
}

/**
 * Build a `ConfigReader` whose root is the `auth.providers.guest`
 * sub-config the resolver expects. The default mirrors the dev-config
 * `app-config.yaml` (`dangerouslyAllowOutsideDevelopment: true`) so the
 * resolver's secondary guard does not throw `NotImplementedError`.
 */
function makeGuestConfig(
  overrides?: Partial<{
    dangerouslyAllowOutsideDevelopment: boolean;
    userEntityRef: string;
    ownershipEntityRefs: string[];
  }>,
): ConfigReader {
  return new ConfigReader({
    dangerouslyAllowOutsideDevelopment: true,
    ...overrides,
  });
}

/**
 * Constructs a Jest-mocked `AuthResolverContext` exposing the
 * `issueToken`, `signInWithCatalogUser`, and `findCatalogUser` callbacks
 * that the Guest resolver invokes. By default `signInWithCatalogUser`
 * rejects so the resolver falls back to `issueToken` — matching the
 * upstream Backstage Guest behavior (Guests typically have no catalog
 * entry).
 */
function makeResolverCtx(
  options: {
    issueTokenImpl?: jest.Mock;
    signInWithCatalogUserImpl?: jest.Mock;
  } = {},
) {
  const issueToken =
    options.issueTokenImpl ??
    jest.fn(async () => ({
      token: 'signed-jwt',
      identity: {
        type: 'user' as const,
        userEntityRef: 'user:development/guest',
        ownershipEntityRefs: ['user:development/guest'],
      },
      providerInfo: {},
    }));
  const signInWithCatalogUser =
    options.signInWithCatalogUserImpl ??
    jest.fn().mockRejectedValue(new Error('guest user not present in catalog'));
  return {
    issueToken,
    findCatalogUser: jest.fn(),
    signInWithCatalogUser,
  };
}

/**
 * Creates a fresh `mockServices.auditor.mock()` auditor whose
 * `createEvent` returns `{ success, fail }` jest.fn()s. Mirrors the
 * helper in `authModuleBlitzyE2E.test.ts` and
 * `authModuleGithubProvider.test.ts` so the three resolver test suites
 * share consistent assertion shapes.
 */
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
  resolver: ReturnType<typeof createBlitzyGuestSignInResolver>,
  ctx: ReturnType<typeof makeResolverCtx>,
) {
  // The Guest resolver does not consume the input result, so an empty
  // object is sufficient. The cast is needed because the resolver
  // accepts `SignInResolver<{}>` whose first argument is an
  // `AuthResolverContext`-shaped object — not a plain `{}`.
  return resolver(
    { result: {} } as Parameters<typeof resolver>[0],
    ctx as unknown as Parameters<typeof resolver>[1],
  );
}

describe('createBlitzyGuestSignInResolver', () => {
  describe('JWT claims (downstream policy consumption)', () => {
    it('issues a token with sub and ent matching the default guest entity ref', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        makeGuestConfig(),
      );
      const ctx = makeResolverCtx();
      await callResolver(resolver, ctx);
      const tokenCall = ctx.issueToken.mock.calls[0][0] as {
        claims: Record<string, unknown>;
      };
      expect(tokenCall.claims.sub).toBe('user:development/guest');
      expect(tokenCall.claims.ent).toEqual(['user:development/guest']);
    });

    it('honors a config-overridden userEntityRef', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        makeGuestConfig({ userEntityRef: 'user:default/guest' }),
      );
      const ctx = makeResolverCtx();
      await callResolver(resolver, ctx);
      const tokenCall = ctx.issueToken.mock.calls[0][0] as {
        claims: Record<string, unknown>;
      };
      expect(tokenCall.claims.sub).toBe('user:default/guest');
      expect(tokenCall.claims.ent).toEqual(['user:default/guest']);
    });

    it('honors config-overridden ownershipEntityRefs', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        makeGuestConfig({ ownershipEntityRefs: ['group:default/everyone'] }),
      );
      const ctx = makeResolverCtx();
      await callResolver(resolver, ctx);
      const tokenCall = ctx.issueToken.mock.calls[0][0] as {
        claims: Record<string, unknown>;
      };
      expect(tokenCall.claims.ent).toEqual(['group:default/everyone']);
    });

    it('does NOT include an email claim (guests have no verified email)', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        makeGuestConfig(),
      );
      const ctx = makeResolverCtx();
      await callResolver(resolver, ctx);
      const tokenCall = ctx.issueToken.mock.calls[0][0] as {
        claims: Record<string, unknown>;
      };
      expect(tokenCall.claims).not.toHaveProperty('email');
    });
  });

  describe('catalog lookup preference', () => {
    it('prefers signInWithCatalogUser when the Guest entity exists', async () => {
      const signInWithCatalogUser = jest.fn(async () => ({
        token: 'catalog-resolved-jwt',
        identity: {
          type: 'user' as const,
          userEntityRef: 'user:default/guest',
          ownershipEntityRefs: ['user:default/guest'],
        },
        providerInfo: {},
      }));
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        makeGuestConfig(),
      );
      const ctx = makeResolverCtx({
        signInWithCatalogUserImpl: signInWithCatalogUser,
      });
      const result = await callResolver(resolver, ctx);
      expect(signInWithCatalogUser).toHaveBeenCalledTimes(1);
      expect(ctx.issueToken).not.toHaveBeenCalled();
      expect(result).toEqual({
        token: 'catalog-resolved-jwt',
        identity: {
          type: 'user',
          userEntityRef: 'user:default/guest',
          ownershipEntityRefs: ['user:default/guest'],
        },
        providerInfo: {},
      });
    });

    it('falls back to issueToken when signInWithCatalogUser rejects', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        makeGuestConfig(),
      );
      const ctx = makeResolverCtx();
      await callResolver(resolver, ctx);
      expect(ctx.signInWithCatalogUser).toHaveBeenCalledTimes(1);
      expect(ctx.issueToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('audit event emission (user-login)', () => {
    it('emits a user-login event with severityLevel "medium" on success', async () => {
      const { auditor, createEvent, successFn, failFn } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        makeGuestConfig(),
      );
      const ctx = makeResolverCtx();
      await callResolver(resolver, ctx);

      expect(createEvent).toHaveBeenCalledTimes(1);
      const eventArg = createEvent.mock.calls[0][0] as {
        eventId: string;
        severityLevel: string;
        meta: Record<string, unknown>;
      };
      expect(eventArg.eventId).toBe('user-login');
      expect(eventArg.severityLevel).toBe('medium');
      expect(eventArg.meta.provider).toBe('guest');
      expect(eventArg.meta.emailDomain).toBe('guest');
      expect(eventArg.meta.userEntityRef).toBe('user:development/guest');
      expect(eventArg.meta.correlationId).toEqual(expect.any(String));

      expect(successFn).toHaveBeenCalled();
      expect(failFn).not.toHaveBeenCalled();
    });

    it('emits success() with entityRef and correlationId on successful sign-in', async () => {
      const { auditor, createEvent, successFn } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        makeGuestConfig(),
      );
      const ctx = makeResolverCtx();
      await callResolver(resolver, ctx);
      const createEventCall = createEvent.mock.calls[0][0] as {
        meta: { correlationId: string };
      };
      const expectedCorrelationId = createEventCall.meta.correlationId;
      expect(successFn).toHaveBeenCalledWith({
        meta: {
          entityRef: 'user:development/guest',
          correlationId: expectedCorrelationId,
        },
      });
    });

    it('emits fail() and rethrows when issueToken rejects', async () => {
      const issueError = new Error('token issuance failed');
      const issueTokenImpl = jest.fn().mockRejectedValue(issueError);
      const { auditor, createEvent, successFn, failFn } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        makeGuestConfig(),
      );
      const ctx = makeResolverCtx({ issueTokenImpl });
      await expect(callResolver(resolver, ctx)).rejects.toBe(issueError);
      const createEventCall = createEvent.mock.calls[0][0] as {
        meta: { correlationId: string };
      };
      const expectedCorrelationId = createEventCall.meta.correlationId;
      expect(failFn).toHaveBeenCalledWith({
        error: issueError,
        meta: {
          entityRef: 'user:development/guest',
          correlationId: expectedCorrelationId,
        },
      });
      expect(successFn).not.toHaveBeenCalled();
    });

    it('emits fail() and rethrows when signInWithCatalogUser AND issueToken both reject', async () => {
      const issueError = new Error('token issuance failed');
      const issueTokenImpl = jest.fn().mockRejectedValue(issueError);
      const { auditor, failFn } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        makeGuestConfig(),
      );
      const ctx = makeResolverCtx({ issueTokenImpl });
      await expect(callResolver(resolver, ctx)).rejects.toBe(issueError);
      expect(failFn).toHaveBeenCalled();
    });

    it('rethrows when auditor.createEvent itself rejects (no token issued)', async () => {
      const createErr = new Error('audit transport down');
      const createEvent = jest.fn(async () => {
        throw createErr;
      });
      const auditor = mockServices.auditor.mock({ createEvent });
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        makeGuestConfig(),
      );
      const ctx = makeResolverCtx();
      await expect(callResolver(resolver, ctx)).rejects.toBe(createErr);
      expect(ctx.issueToken).not.toHaveBeenCalled();
      expect(ctx.signInWithCatalogUser).not.toHaveBeenCalled();
    });

    it('generates a unique correlationId per invocation', async () => {
      const { auditor, createEvent } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        makeGuestConfig(),
      );
      await callResolver(resolver, makeResolverCtx());
      await callResolver(resolver, makeResolverCtx());
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

    it('records emailDomain "guest" — never a real domain or unknown', async () => {
      const { auditor, createEvent } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        makeGuestConfig(),
      );
      await callResolver(resolver, makeResolverCtx());
      const meta = (
        createEvent.mock.calls[0][0] as { meta: { emailDomain: string } }
      ).meta;
      expect(meta.emailDomain).toBe('guest');
    });
  });

  describe('config gating (dangerouslyAllowOutsideDevelopment)', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    afterEach(() => {
      // Restore. Jest defaults to NODE_ENV=test which the resolver's
      // secondary guard treats as non-development, so explicit
      // teardown matters even though jest spawns child processes per
      // test file.
      setNodeEnv(originalNodeEnv);
    });

    it('throws NotImplementedError when outside development and dangerous flag is unset', async () => {
      setNodeEnv('production');
      const { auditor, createEvent } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        new ConfigReader({}), // dangerouslyAllowOutsideDevelopment absent
      );
      const ctx = makeResolverCtx();
      await expect(callResolver(resolver, ctx)).rejects.toThrow(
        /guest provider is NOT recommended/i,
      );
      // No audit event should have been created — the resolver rejects
      // BEFORE invoking auditor.createEvent.
      expect(createEvent).not.toHaveBeenCalled();
      expect(ctx.issueToken).not.toHaveBeenCalled();
    });

    it('allows sign-in outside development when dangerously enabled', async () => {
      setNodeEnv('production');
      const { auditor, createEvent, successFn } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        new ConfigReader({ dangerouslyAllowOutsideDevelopment: true }),
      );
      const ctx = makeResolverCtx();
      await callResolver(resolver, ctx);
      expect(createEvent).toHaveBeenCalledTimes(1);
      expect(successFn).toHaveBeenCalledTimes(1);
    });

    it('allows sign-in inside development without the dangerous flag', async () => {
      setNodeEnv('development');
      const { auditor, createEvent } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        new ConfigReader({}),
      );
      const ctx = makeResolverCtx();
      await callResolver(resolver, ctx);
      expect(createEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('PII discipline (security)', () => {
    it('audit metadata contains no email address (Guest has none)', async () => {
      const { auditor, createEvent } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        makeGuestConfig(),
      );
      const ctx = makeResolverCtx();
      await callResolver(resolver, ctx);
      const eventArg = createEvent.mock.calls[0][0];
      const eventJson = JSON.stringify(eventArg);
      // No "@" sign anywhere in the audit metadata (no domain leaking
      // through the userEntityRef, no email field).
      expect(eventJson).not.toContain('@');
    });

    it('success metadata contains no email address', async () => {
      const { auditor, successFn } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        makeGuestConfig(),
      );
      const ctx = makeResolverCtx();
      await callResolver(resolver, ctx);
      const successMeta = successFn.mock.calls[0][0];
      expect(JSON.stringify(successMeta)).not.toContain('@');
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

    it('increments user_login_total with provider="guest" on success', async () => {
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        makeGuestConfig(),
      );
      const ctx = makeResolverCtx();
      await callResolver(resolver, ctx);
      expect(counterSpy).toHaveBeenCalledTimes(1);
      expect(counterSpy).toHaveBeenCalledWith(1, {
        provider: 'guest',
        email_domain: 'guest',
      });
    });

    it('increments user_login_total even when token issuance fails', async () => {
      const issueError = new Error('token issuance failed');
      const issueTokenImpl = jest.fn().mockRejectedValue(issueError);
      const { auditor } = makeAuditorMock();
      const resolver = createBlitzyGuestSignInResolver(
        auditor,
        makeGuestConfig(),
      );
      const ctx = makeResolverCtx({ issueTokenImpl });
      await expect(callResolver(resolver, ctx)).rejects.toBe(issueError);
      // Counter is incremented BEFORE auditor.createEvent — it tracks
      // observed sign-in attempts.
      expect(counterSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT increment counter when the dev guard rejects (resolver short-circuits)', async () => {
      // Save & restore NODE_ENV around this test specifically.
      const previousNodeEnv = process.env.NODE_ENV;
      setNodeEnv('production');
      try {
        const { auditor } = makeAuditorMock();
        const resolver = createBlitzyGuestSignInResolver(
          auditor,
          new ConfigReader({}),
        );
        const ctx = makeResolverCtx();
        await expect(callResolver(resolver, ctx)).rejects.toThrow();
        // Counter is not incremented — the secondary guard throws
        // BEFORE the counter add.
        expect(counterSpy).not.toHaveBeenCalled();
      } finally {
        setNodeEnv(previousNodeEnv);
      }
    });
  });
});

/**
 * The exported `guestAuthenticator` is the result of
 * `createProxyAuthenticator({ defaultProfileTransform, initialize,
 * authenticate })`. `createProxyAuthenticator` is an identity function
 * (see `node_modules/@backstage/plugin-auth-node/src/proxy/types.ts`),
 * so the authenticator object exposes the three callbacks directly.
 *
 * This suite drives the security-critical `initialize` and
 * `authenticate` callbacks under every combination of `NODE_ENV` and
 * `dangerouslyAllowOutsideDevelopment` config. These callbacks gate
 * whether the Guest provider can mint tokens at all; without coverage
 * a future refactor could silently relax the production safeguard.
 *
 * The corresponding QA-CP14 finding (Issue 7) flagged the
 * authenticator as uncovered (lines 105–123 in
 * `authModuleGuestProvider.ts`). These tests bring that block above
 * the AAP §0.8.1.2 >80% line-coverage threshold.
 */
describe('guestAuthenticator', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    setNodeEnv(originalNodeEnv);
  });

  describe('defaultProfileTransform', () => {
    it('returns an empty profile object (guests have no identity claims)', async () => {
      // Guests have no profile data — name, email, picture all
      // intentionally omitted. The proxy auth route handler reads
      // `profile` from this transform when constructing the response,
      // so the empty shape here is the contract the frontend reads.
      const transformed = await guestAuthenticator.defaultProfileTransform(
        // The proxy authenticator's transform takes the authenticate
        // result and the auth-resolver context; both are unused by the
        // Guest transform so plain stubs suffice for the contract test.
        {} as Parameters<typeof guestAuthenticator.defaultProfileTransform>[0],
        {} as Parameters<typeof guestAuthenticator.defaultProfileTransform>[1],
      );
      expect(transformed).toEqual({ profile: {} });
    });
  });

  describe('initialize', () => {
    it('returns disabled=true when NODE_ENV is not "development" and the dangerous flag is unset', () => {
      setNodeEnv('production');
      const disabled = guestAuthenticator.initialize({
        config: new ConfigReader({}),
      });
      expect(disabled).toBe(true);
    });

    it('returns disabled=true when NODE_ENV is "test" (Jest default) and the dangerous flag is unset', () => {
      // Jest sets NODE_ENV=test by default — the production-guard
      // logic treats anything other than "development" as non-dev.
      setNodeEnv('test');
      const disabled = guestAuthenticator.initialize({
        config: new ConfigReader({}),
      });
      expect(disabled).toBe(true);
    });

    it('returns disabled=false when NODE_ENV is "development" regardless of the dangerous flag', () => {
      setNodeEnv('development');
      // The OR short-circuit means the dangerous flag is irrelevant
      // when NODE_ENV is development. Verify both branches.
      expect(
        guestAuthenticator.initialize({
          config: new ConfigReader({}),
        }),
      ).toBe(false);
      expect(
        guestAuthenticator.initialize({
          config: new ConfigReader({
            dangerouslyAllowOutsideDevelopment: false,
          }),
        }),
      ).toBe(false);
      expect(
        guestAuthenticator.initialize({
          config: new ConfigReader({
            dangerouslyAllowOutsideDevelopment: true,
          }),
        }),
      ).toBe(false);
    });

    it('returns disabled=false when dangerouslyAllowOutsideDevelopment is true outside development', () => {
      setNodeEnv('production');
      const disabled = guestAuthenticator.initialize({
        config: new ConfigReader({
          dangerouslyAllowOutsideDevelopment: true,
        }),
      });
      expect(disabled).toBe(false);
    });

    it('returns disabled=true when dangerouslyAllowOutsideDevelopment is explicitly false outside development', () => {
      setNodeEnv('production');
      const disabled = guestAuthenticator.initialize({
        config: new ConfigReader({
          dangerouslyAllowOutsideDevelopment: false,
        }),
      });
      // The strict !== true check rejects `false`, `undefined`, and
      // every other falsy value — only literal `true` opens the gate.
      expect(disabled).toBe(true);
    });
  });

  describe('authenticate', () => {
    it('throws NotAllowedError when disabled=true', async () => {
      // First argument is `options: { req }`; second is the
      // disabled flag from `initialize`. Guest auth does not read the
      // request, so passing an empty stub is correct.
      await expect(
        guestAuthenticator.authenticate(
          {} as Parameters<typeof guestAuthenticator.authenticate>[0],
          true,
        ),
      ).rejects.toThrow(NotAllowedError);
    });

    it('throws an error whose message mentions dangerouslyAllowOutsideDevelopment when disabled', async () => {
      // The error message is consumed by the auth route handler and
      // surfaced in the auth-error log; the dangerous-flag mention
      // is the actionable remediation a developer would need to read.
      await expect(
        guestAuthenticator.authenticate(
          {} as Parameters<typeof guestAuthenticator.authenticate>[0],
          true,
        ),
      ).rejects.toThrow(/dangerouslyAllowOutsideDevelopment/);
    });

    it('returns `{ result: {} }` when disabled=false', async () => {
      const out = await guestAuthenticator.authenticate(
        {} as Parameters<typeof guestAuthenticator.authenticate>[0],
        false,
      );
      // Guest auth carries no per-request state — the result is
      // intentionally an empty object so the resolver only relies on
      // the config-supplied user entity ref.
      expect(out).toEqual({ result: {} });
    });
  });
});

/**
 * Module registration smoke test.
 *
 * Drives the `register` / `init` block (lines 334–358 in
 * `authModuleGuestProvider.ts`) using the canonical
 * `startTestBackend` harness from `@backstage/backend-test-utils`. The
 * harness wires the extension-point mock the module depends on and
 * invokes `init`; we assert that the module calls
 * `providers.registerProvider({ providerId: 'guest', factory })`.
 *
 * This brings the module export above the AAP §0.8.1.2 >80%
 * line-coverage threshold and protects against silent regressions if
 * the module's deps or providerId ever change.
 */
describe('authModuleGuestProvider', () => {
  it('registers the "guest" auth provider through authProvidersExtensionPoint', async () => {
    // Tracks every registerProvider invocation observed during init.
    const registerProvider = jest.fn();
    const providersMock: AuthProvidersExtensionPoint = {
      registerProvider,
    };

    // The Guest module reads `auth.providers.guest` from rootConfig
    // and pulls the `auditor` from coreServices. Stub both via the
    // mockServices helpers so the harness boots cleanly.
    await startTestBackend({
      features: [
        authModuleGuestProvider,
        mockServices.rootConfig.factory({
          data: {
            auth: {
              providers: {
                guest: {
                  // Match the dev-config default so the secondary
                  // resolver guard does not fire during this smoke test.
                  dangerouslyAllowOutsideDevelopment: true,
                },
              },
            },
          },
        }),
      ],
      // Inject the providers extension point implementation so the
      // module's `deps.providers` resolves to our jest.fn() mock.
      extensionPoints: [[authProvidersExtensionPoint, providersMock]],
    });

    expect(registerProvider).toHaveBeenCalledTimes(1);
    const arg = registerProvider.mock.calls[0][0] as {
      providerId: string;
      factory: unknown;
    };
    expect(arg.providerId).toBe('guest');
    // The factory is the result of createProxyAuthProviderFactory — a
    // function that the auth backend invokes lazily. Verifying it is a
    // function is the contract assertion (the implementation is an
    // upstream concern); strict equality with a specific signature
    // would couple this test to internal Backstage details.
    expect(typeof arg.factory).toBe('function');
  });
});
