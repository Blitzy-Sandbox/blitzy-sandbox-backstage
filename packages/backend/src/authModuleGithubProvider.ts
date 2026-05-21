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
  AuditorService,
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import {
  DEFAULT_NAMESPACE,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { githubAuthenticator } from '@backstage/plugin-auth-backend-module-github-provider';
import {
  authProvidersExtensionPoint,
  createOAuthProviderFactory,
  OAuthAuthenticatorResult,
  PassportProfile,
  SignInResolver,
} from '@backstage/plugin-auth-node';

/**
 * Creates the GitHub sign-in resolver augmented with audit event emission and
 * email extraction. The returned resolver:
 *
 *  - Resolves the GitHub user entity ref from `fullProfile.username` and issues
 *    an identity token whose claims include `sub`, `ent`, and a custom `email`
 *    claim so downstream permission policies can determine the user's domain.
 *  - Extracts the user's email using this priority order:
 *      1. `fullProfile.emails[0].value` (primary GitHub email)
 *      2. `result.userinfo.email` (defensive fallback for providers that
 *         surface an OIDC-style userinfo block on the OAuth result)
 *      3. `<userId>@unknown.invalid` (fail-closed: the BlitzyPermissionPolicy
 *         treats this domain as non-Blitzy and enforces read-only access)
 *  - Emits a `user-login` audit event on both success and failure paths.
 *
 * SECURITY: The audit event metadata intentionally OMITS the full email
 * address, OAuth access/refresh tokens, and the raw OAuth result payload.
 * Only the `emailDomain`, `provider`, `username`, and `userEntityRef` are
 * recorded. The full email is included only in the JWT claim so the policy
 * can make domain decisions; the audit log itself stays PII-light.
 *
 * Exported for unit testing; the runtime registration is in the default
 * export below.
 */
export function createBlitzyGithubSignInResolver(
  auditor: AuditorService,
): SignInResolver<OAuthAuthenticatorResult<PassportProfile>> {
  return async ({ result }, ctx) => {
    const fullProfile = result.fullProfile;
    const userId = fullProfile.username;
    if (!userId) {
      throw new Error(`GitHub user profile does not contain a username`);
    }

    const userEntityRef = stringifyEntityRef({
      kind: 'User',
      name: userId,
      namespace: DEFAULT_NAMESPACE,
    });

    // Extract email with the documented priority. The cast covers the
    // defensive `result.userinfo` fallback which is not part of the
    // OAuthAuthenticatorResult contract for GitHub but is observed on some
    // providers; using a structural cast avoids `as any` while staying safe.
    const primaryEmail =
      fullProfile.emails?.[0]?.value ??
      (result as { userinfo?: { email?: string } }).userinfo?.email ??
      `${userId}@unknown.invalid`;
    const emailDomain =
      primaryEmail.split('@')[1]?.toLowerCase() ?? 'unknown.invalid';

    // Audit event metadata intentionally excludes the full email and OAuth
    // tokens; only the domain bucket and entity ref are recorded.
    const auditorEvent = await auditor.createEvent({
      eventId: 'user-login',
      severityLevel: 'medium',
      meta: {
        provider: 'github',
        username: userId,
        emailDomain,
        userEntityRef,
      },
    });

    try {
      const signedIn = await ctx.issueToken({
        claims: {
          sub: userEntityRef,
          ent: [userEntityRef],
          // Custom claim so the BlitzyPermissionPolicy can read the user's
          // verified email when making authorization decisions.
          email: primaryEmail,
        },
      });
      await auditorEvent.success();
      return signedIn;
    } catch (err) {
      await auditorEvent.fail({ error: err as Error });
      throw err;
    }
  };
}

export default createBackendModule({
  pluginId: 'auth',
  moduleId: 'githubProvider',
  register(reg) {
    reg.registerInit({
      deps: {
        providers: authProvidersExtensionPoint,
        auditor: coreServices.auditor,
      },
      async init({ providers, auditor }) {
        providers.registerProvider({
          providerId: 'github',
          factory: createOAuthProviderFactory({
            authenticator: githubAuthenticator,
            signInResolver: createBlitzyGithubSignInResolver(auditor),
          }),
        });
      },
    });
  },
});
