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

import { randomUUID } from 'node:crypto';
import {
  AuditorService,
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import {
  DEFAULT_NAMESPACE,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { NotAllowedError } from '@backstage/errors';
import {
  authProvidersExtensionPoint,
  createProxyAuthenticator,
  createProxyAuthProviderFactory,
  SignInResolver,
} from '@backstage/plugin-auth-node';

import { bucketSignInEmailDomain, userLoginTotal } from './metrics';
import { cacheUserEmail } from './userEmailCache';

/**
 * The HTTP request headers used by the BlitzyE2E proxy authenticator to
 * accept arbitrary identity claims from a Playwright test process.
 *
 * Centralized so the E2E test fixtures and the authenticator stay in
 * lockstep. Lowercase to match Node's normalized header map.
 */
export const BLITZY_E2E_AUTH_HEADER_EMAIL = 'x-blitzy-e2e-email';
export const BLITZY_E2E_AUTH_HEADER_USERNAME = 'x-blitzy-e2e-username';

/**
 * Result shape that the BlitzyE2E authenticator returns and that the
 * sign-in resolver consumes to mint the identity token.
 *
 * `email` is the verified user email passed by the E2E test fixture; it
 * is what `BlitzyPermissionPolicy` decodes from the JWT claims to make
 * its ALLOW/DENY decision. `username` is used to derive the user entity
 * ref so that the catalog audit module records a sensible principal.
 */
export interface BlitzyE2EResult {
  email: string;
  username: string;
}

/**
 * `blitzyE2EAuthenticator` is a Backstage proxy authenticator that
 * extracts identity from custom HTTP headers and returns the email and
 * username back to the sign-in resolver.
 *
 * SECURITY POSTURE — this authenticator must NEVER be reachable in a
 * production deployment. The `authenticate` method enforces this with
 * two layers of defense:
 *
 *   1. The `initialize` hook captures `BLITZY_E2E_TEST_MODE` at startup
 *      and returns a context flag that is checked on every request.
 *
 *   2. The `authenticate` method throws `NotAllowedError` whenever the
 *      flag is false. Even if a misconfigured deployment somehow
 *      registers this module, every request will be rejected.
 *
 * In addition, `packages/backend/src/index.ts` only imports this module
 * when `process.env.BLITZY_E2E_TEST_MODE === 'true'` — providing a
 * third layer of defense at the registration boundary.
 *
 * The authenticator pattern follows `guestAuthenticator` from
 * `@backstage/plugin-auth-backend-module-guest-provider` verbatim, with
 * the addition of header-based claim extraction.
 */
const blitzyE2EAuthenticator = createProxyAuthenticator({
  defaultProfileTransform: async (result: BlitzyE2EResult) => ({
    profile: {
      email: result.email,
      displayName: result.username,
    },
  }),
  initialize() {
    // Snapshot the env var at backend startup. We deliberately do NOT
    // read it again on every request: a backend that starts in non-test
    // mode must NOT become test-permissive mid-run.
    const enabled = process.env.BLITZY_E2E_TEST_MODE === 'true';
    return { enabled };
  },
  async authenticate({ req }, ctx) {
    if (!ctx.enabled) {
      throw new NotAllowedError(
        'The blitzy-e2e auth provider is only available when ' +
          'BLITZY_E2E_TEST_MODE=true is set on the backend process. ' +
          'This provider exists ONLY for end-to-end test token issuance ' +
          'and must NEVER be enabled in a production deployment.',
      );
    }

    // Extract the test-supplied identity from request headers. Express
    // normalizes header names to lowercase so the constants above use
    // lowercase strings.
    const emailHeader = req.headers[BLITZY_E2E_AUTH_HEADER_EMAIL];
    const usernameHeader = req.headers[BLITZY_E2E_AUTH_HEADER_USERNAME];

    const email = Array.isArray(emailHeader) ? emailHeader[0] : emailHeader;
    const username = Array.isArray(usernameHeader)
      ? usernameHeader[0]
      : usernameHeader;

    if (!email || typeof email !== 'string' || email.length === 0) {
      throw new NotAllowedError(
        `The blitzy-e2e auth provider requires the ${BLITZY_E2E_AUTH_HEADER_EMAIL} header.`,
      );
    }
    if (!username || typeof username !== 'string' || username.length === 0) {
      throw new NotAllowedError(
        `The blitzy-e2e auth provider requires the ${BLITZY_E2E_AUTH_HEADER_USERNAME} header.`,
      );
    }

    return { result: { email, username } };
  },
});

/**
 * Creates the BlitzyE2E sign-in resolver augmented with audit event
 * emission and email caching. Mirrors the production
 * `createBlitzyGithubSignInResolver` (see
 * `authModuleGithubProvider.ts`) so that the audit-event lifecycle and
 * email-cache population are identical between the GitHub OAuth flow
 * and the E2E proxy flow.
 *
 * The returned resolver:
 *
 *  - Derives the user entity ref from `result.username` and issues an
 *    identity token whose claims include `sub`, `ent`, and `email` —
 *    the same shape produced by the GitHub resolver. This allows the
 *    `BlitzyPermissionPolicy` to decode the email directly from the
 *    JWT for direct user-credentialed calls and via the custom
 *    `BlitzyUserInfoService` (see
 *    `packages/backend/src/userInfoServiceFactory.ts`) for
 *    on-behalf-of plugin-to-plugin calls.
 *
 *  - Emits a `user-login` audit event on both success and failure
 *    paths. The audit metadata records `provider: 'blitzy-e2e'`,
 *    `username`, `emailDomain` (NOT the full email), `userEntityRef`,
 *    and a synthetic `correlationId`. This addresses QA CP5 Major
 *    Issue #3 ("user-login emission has zero runtime test coverage").
 *
 *  - Calls `cacheUserEmail(userEntityRef, email)` after successful
 *    token issuance so that subsequent on-behalf-of permission checks
 *    can resolve the email via the cache lookup in
 *    `BlitzyUserInfoService.getUserInfo()`. Without this write the
 *    catalog/permission integration would DENY writes for @blitzy.com
 *    E2E users — the same bug as the production GitHub flow before
 *    the cache write was added (QA CP5 Critical Defect #2).
 *
 *  - Increments the `userLoginTotal` Prometheus counter with
 *    `provider: 'blitzy-e2e'` so dashboards include test-driven sign-
 *    ins. The counter is bucketed by `email_domain` (blitzy.com / other
 *    / unknown) so dashboards can distinguish E2E coverage of the
 *    different authorization branches.
 *
 * SECURITY: The audit metadata intentionally OMITS the full email
 * value, the OAuth access/refresh tokens, and the raw OAuth result
 * payload. Only the `emailDomain` is recorded for permission
 * observability.
 *
 * AUDIT LIFECYCLE GUARANTEES — same as the GitHub resolver:
 *  - `createEvent` is awaited in its own try/catch. If `createEvent`
 *    itself rejects (auditor service unavailable), the resolver
 *    rethrows so the auth flow surfaces the failure rather than
 *    silently signing the user in without an audit trail. Token
 *    issuance is NOT attempted in this branch.
 *  - On successful token issuance the resolver calls
 *    `auditorEvent.success({ meta: { entityRef, correlationId } })`
 *    AND populates the email cache.
 *  - On any failure after `createEvent` succeeds, the resolver calls
 *    `auditorEvent.fail({ error, meta })` and rethrows so the upstream
 *    auth flow sees the failure. The cache is NOT populated.
 *
 * Exported for unit testing; the runtime registration is in the
 * default export below.
 */
export function createBlitzyE2ESignInResolver(
  auditor: AuditorService,
): SignInResolver<BlitzyE2EResult> {
  return async ({ result }, ctx) => {
    const userEntityRef = stringifyEntityRef({
      kind: 'User',
      name: result.username,
      namespace: DEFAULT_NAMESPACE,
    });

    // Synthetic correlation id for this sign-in attempt. SignInResolver
    // does not expose the express Request object so the correlationId
    // is the documented correlation mechanism between the audit log
    // and the auth-backend HTTP access log (matches the GitHub
    // resolver's behavior; see `authModuleGithubProvider.ts`).
    const correlationId = randomUUID();
    const emailDomain =
      result.email.split('@')[1]?.toLowerCase() ?? 'unknown.invalid';

    // Increment the user-login counter exactly once per sign-in
    // attempt. Recorded before `auditor.createEvent` so the metric
    // tracks resolver-observed sign-in attempts even when the auditor
    // itself is unhealthy.
    userLoginTotal.add(1, {
      provider: 'blitzy-e2e',
      email_domain: bucketSignInEmailDomain(emailDomain),
    });

    // Audit event creation is wrapped in its own try so that an
    // auditor service failure (e.g., transport down) does not silently
    // sign the user in. If createEvent rejects we surface the failure
    // to the auth caller. Note: there is no `auditorEvent` to call
    // `.fail` on at this point — that lifecycle method only exists
    // after a successful `createEvent` returns.
    let auditorEvent;
    try {
      auditorEvent = await auditor.createEvent({
        eventId: 'user-login',
        severityLevel: 'medium',
        meta: {
          provider: 'blitzy-e2e',
          username: result.username,
          emailDomain,
          userEntityRef,
          correlationId,
        },
      });
    } catch (createErr) {
      // Auditor service itself failed. Fail closed: do not issue a
      // token without an audit trail.
      throw createErr;
    }

    // From here the audit lifecycle is owned: every code path must end
    // with either `.success(...)` or `.fail(...)`.
    try {
      const signedIn = await ctx.issueToken({
        claims: {
          sub: userEntityRef,
          ent: [userEntityRef],
          // Custom claim — see `authModuleGithubProvider.ts` for the
          // full rationale on why we include `email` as a JWT claim
          // and ALSO write it through to the user-email cache below.
          email: result.email,
        },
      });

      // Populate the in-process email cache so that subsequent
      // on-behalf-of permission checks for this user can resolve the
      // email even when the original JWT's `email` claim has been
      // dropped during the on-behalf-of token exchange. Without this
      // write the catalog/permission integration would DENY writes for
      // @blitzy.com E2E users (the same bug as QA CP5 Critical Defect
      // #2 affecting the production GitHub flow).
      cacheUserEmail(userEntityRef, result.email);

      await auditorEvent.success({
        meta: {
          entityRef: userEntityRef,
          correlationId,
        },
      });
      return signedIn;
    } catch (err) {
      await auditorEvent.fail({
        error: err as Error,
        meta: {
          entityRef: userEntityRef,
          correlationId,
        },
      });
      throw err;
    }
  };
}

/**
 * `authModuleBlitzyE2E` is the conditional Backstage backend module
 * that registers the `blitzy-e2e` proxy auth provider when
 * `BLITZY_E2E_TEST_MODE=true`. It is intentionally NOT registered in
 * `packages/backend/src/index.ts` when the env var is unset, so a
 * normal `yarn start` or production deployment never instantiates it.
 *
 * The provider URL surfaces at:
 *
 *   POST /api/auth/blitzy-e2e/refresh
 *
 * with headers `x-blitzy-e2e-email` and `x-blitzy-e2e-username`. The
 * response is a `ClientAuthResponse` whose `backstageIdentity.token`
 * field carries the minted JWT.
 *
 * Example Playwright fixture:
 *
 * ```ts
 * const resp = await request.post('/api/auth/blitzy-e2e/refresh', {
 *   headers: {
 *     'x-blitzy-e2e-email': 'alex@blitzy.com',
 *     'x-blitzy-e2e-username': 'alex',
 *   },
 * });
 * const { backstageIdentity } = await resp.json();
 * const token = backstageIdentity.token;
 * ```
 *
 * @public
 */
export const authModuleBlitzyE2E = createBackendModule({
  pluginId: 'auth',
  moduleId: 'blitzy-e2e-provider',
  register(reg) {
    reg.registerInit({
      deps: {
        providers: authProvidersExtensionPoint,
        logger: coreServices.logger,
        auditor: coreServices.auditor,
      },
      async init({ providers, logger, auditor }) {
        logger.warn(
          'Registering blitzy-e2e test-only auth provider — this MUST NOT ' +
            'be enabled in a production deployment. Set ' +
            'BLITZY_E2E_TEST_MODE=false (or unset) to disable.',
        );
        providers.registerProvider({
          providerId: 'blitzy-e2e',
          factory: createProxyAuthProviderFactory({
            authenticator: blitzyE2EAuthenticator,
            signInResolver: createBlitzyE2ESignInResolver(auditor),
          }),
        });
      },
    });
  },
});

export default authModuleBlitzyE2E;
