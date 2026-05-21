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
import { githubAuthenticator } from '@backstage/plugin-auth-backend-module-github-provider';
import {
  authProvidersExtensionPoint,
  createOAuthProviderFactory,
  OAuthAuthenticatorResult,
  PassportProfile,
  SignInResolver,
} from '@backstage/plugin-auth-node';

/**
 * Selects the verified primary email from a GitHub `PassportProfile.emails`
 * array. Returns `undefined` when no candidate is present.
 *
 * The passport-github2 strategy normalizes its emails array in two distinct
 * shapes depending on the `allRawEmails` option:
 *
 *   1. Default (`allRawEmails === false`): the strategy fetches the user's
 *      verified primary email and returns it as a single-entry array
 *      `[{ value }]` with no `primary` field. In this mode the primary IS
 *      always at index 0 by construction.
 *
 *   2. Raw mode (`allRawEmails === true`): the strategy returns ALL of the
 *      user's GitHub emails as `[{ value, primary, verified, type }, ...]`.
 *      The primary email is only identifiable via the `primary: true`
 *      property and may NOT be at index 0.
 *
 * To behave correctly in both modes (and to be robust against future
 * upstream provider behavior changes), this helper first looks for the
 * entry flagged `primary: true`; when no such entry is present it falls
 * back to index 0. The cast to `{ primary?: boolean }` is required
 * because the upstream `@types/passport` Profile.emails entries declare
 * only `{ value, type? }`; the GitHub provider augments this at runtime
 * but the type system does not see it.
 */
export function selectPrimaryGithubEmail(
  emails: PassportProfile['emails'],
): string | undefined {
  if (!emails || emails.length === 0) {
    return undefined;
  }
  // Strict primary lookup (raw mode shape). When the array contains
  // entries flagged `primary: true` we MUST return that one regardless
  // of its index — using emails[0] in raw mode would mis-classify the
  // user's domain whenever GitHub returns secondary emails first.
  const explicitPrimary = emails.find(
    e => (e as { primary?: boolean }).primary === true,
  );
  if (explicitPrimary) {
    return explicitPrimary.value;
  }
  // Default-mode fallback: the strategy returns only one email and it
  // is the verified primary. Returning `emails[0]?.value` preserves the
  // documented contract from passport-github2's `lib/profile.js`.
  return emails[0]?.value;
}

/**
 * Creates the GitHub sign-in resolver augmented with audit event emission
 * and email extraction. The returned resolver:
 *
 *  - Resolves the GitHub user entity ref from `fullProfile.username` and
 *    issues an identity token whose claims include `sub`, `ent`, and a
 *    custom `email` claim so downstream permission policies can determine
 *    the user's domain at request time. The `BlitzyPermissionPolicy`
 *    decodes this claim directly from the validated user JWT carried on
 *    `BackstageCredentials.token` (the Backstage default `UserInfoService`
 *    only reads `sub` and `ent`, so the email cannot reach the policy via
 *    `user.info.email` without a custom user-info service — decoding the
 *    JWT in the policy is the simpler, more localized integration).
 *
 *  - Extracts the user's email using this priority order:
 *      1. The entry in `fullProfile.emails` whose `primary: true` flag is
 *         set (correct when passport-github2 is configured with
 *         `allRawEmails: true` and may return secondary emails first).
 *      2. `fullProfile.emails[0].value` (correct in the default
 *         passport-github2 mode, which already returns only the primary).
 *      3. `result.userinfo.email` (defensive fallback for providers that
 *         surface an OIDC-style userinfo block on the OAuth result).
 *      4. `<userId>@unknown.invalid` (fail-closed: the
 *         BlitzyPermissionPolicy treats this domain as non-Blitzy and
 *         enforces read-only access).
 *
 *  - Emits a `user-login` audit event on both success and failure paths.
 *    A synthetic `correlationId` (UUID v4) is generated per resolver
 *    invocation and recorded in the audit meta. The Backstage
 *    `SignInResolver` callback signature does NOT expose the originating
 *    Express `Request` object (see `AuthResolverContext` in
 *    `plugins/auth-node/src/types.ts`), so the `AuditorService.request`
 *    parameter cannot be populated without forking the auth-node
 *    package. The `correlationId` carried in meta is the documented
 *    correlation mechanism for sign-in audits — it can be cross-
 *    referenced against the auth-backend's HTTP access log via the
 *    Backstage logger's `requestId` field when needed.
 *
 * SECURITY: The audit event metadata intentionally OMITS the full email
 * address, OAuth access/refresh tokens, and the raw OAuth result payload.
 * Only the `emailDomain`, `provider`, `username`, `userEntityRef`, and
 * `correlationId` are recorded. The full email is included only in the
 * JWT claim so the policy can make domain decisions; the audit log
 * itself stays PII-light.
 *
 * AUDIT LIFECYCLE GUARANTEES:
 *  - `createEvent` is awaited in its own try/catch. If `createEvent`
 *    itself rejects (auditor service unavailable), the resolver rethrows
 *    so the OAuth flow surfaces the failure rather than silently signing
 *    the user in without an audit trail. Token issuance is NOT attempted
 *    in this branch.
 *  - On successful token issuance the resolver calls
 *    `auditorEvent.success({ meta: { entityRef: userEntityRef } })` as
 *    required by AAP §0.5.1.3.
 *  - On any failure after `createEvent` succeeds, the resolver calls
 *    `auditorEvent.fail({ error, meta })` and rethrows so the upstream
 *    OAuth flow sees the failure.
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

    // Synthetic correlation id for this sign-in attempt. Used as the
    // primary correlation key in the audit event since SignInResolver
    // has no access to the express Request object (see JSDoc above).
    const correlationId = randomUUID();

    // Extract email with the documented primary-aware priority. The
    // cast covers the defensive `result.userinfo` fallback which is not
    // part of the OAuthAuthenticatorResult contract for GitHub but is
    // observed on some providers; using a structural cast avoids
    // `as any` while staying safe.
    const primaryEmail =
      selectPrimaryGithubEmail(fullProfile.emails) ??
      (result as { userinfo?: { email?: string } }).userinfo?.email ??
      `${userId}@unknown.invalid`;
    const emailDomain =
      primaryEmail.split('@')[1]?.toLowerCase() ?? 'unknown.invalid';

    // Audit event creation is wrapped in its own try so that an auditor
    // service failure (e.g., transport down) does not silently sign the
    // user in. If createEvent rejects we surface the failure to the
    // OAuth caller. Note: there is no `auditorEvent` to call `.fail` on
    // at this point — that lifecycle method only exists after a
    // successful `createEvent` returns.
    let auditorEvent;
    try {
      auditorEvent = await auditor.createEvent({
        eventId: 'user-login',
        severityLevel: 'medium',
        meta: {
          provider: 'github',
          username: userId,
          emailDomain,
          userEntityRef,
          correlationId,
        },
      });
    } catch (createErr) {
      // Auditor service itself failed. Fail closed: do not issue a token
      // without an audit trail. The OAuth caller will observe the error.
      throw createErr;
    }

    // From here the audit lifecycle is owned: every code path must end
    // with either `.success(...)` or `.fail(...)`.
    try {
      const signedIn = await ctx.issueToken({
        claims: {
          sub: userEntityRef,
          ent: [userEntityRef],
          // Custom claim so the BlitzyPermissionPolicy can read the user's
          // verified email when making authorization decisions. The
          // policy decodes this claim from `BackstageCredentials.token`
          // (the validated user JWT) — it is NOT propagated through
          // `BackstageUserInfo` because the default UserInfoService only
          // reads `sub` and `ent`.
          email: primaryEmail,
        },
      });
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
