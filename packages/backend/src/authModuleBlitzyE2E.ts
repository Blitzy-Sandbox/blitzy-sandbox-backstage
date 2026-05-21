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

import {
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
 * `blitzyE2ESignInResolver` mints a Backstage identity token whose JWT
 * claims include the test-supplied `email`. This is the same shape the
 * production GitHub resolver produces (see
 * `authModuleGithubProvider.ts`), so the token flows through the auth
 * middleware, user-info service, and `BlitzyPermissionPolicy` exactly
 * the same way a real GitHub-issued token does.
 *
 * The resolver issues the token directly (without a catalog lookup) so
 * that the E2E test does not require a `user:default/<username>` entity
 * to exist in the catalog. Both `signInWithCatalogUser` and
 * `issueToken` produce tokens accepted by the auth middleware.
 */
const blitzyE2ESignInResolver: SignInResolver<BlitzyE2EResult> = async (
  { result },
  ctx,
) => {
  const userEntityRef = stringifyEntityRef({
    kind: 'User',
    name: result.username,
    namespace: DEFAULT_NAMESPACE,
  });
  return ctx.issueToken({
    claims: {
      sub: userEntityRef,
      ent: [userEntityRef],
      email: result.email,
    },
  });
};

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
      },
      async init({ providers, logger }) {
        logger.warn(
          'Registering blitzy-e2e test-only auth provider — this MUST NOT ' +
            'be enabled in a production deployment. Set ' +
            'BLITZY_E2E_TEST_MODE=false (or unset) to disable.',
        );
        providers.registerProvider({
          providerId: 'blitzy-e2e',
          factory: createProxyAuthProviderFactory({
            authenticator: blitzyE2EAuthenticator,
            signInResolver: blitzyE2ESignInResolver,
          }),
        });
      },
    });
  },
});

export default authModuleBlitzyE2E;
