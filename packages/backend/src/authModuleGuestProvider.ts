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
import type { Config } from '@backstage/config';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { NotAllowedError, NotImplementedError } from '@backstage/errors';
import {
  authProvidersExtensionPoint,
  createProxyAuthenticator,
  createProxyAuthProviderFactory,
  SignInResolver,
} from '@backstage/plugin-auth-node';

import { bucketSignInEmailDomain, userLoginTotal } from './metrics';

/**
 * `authModuleGuestProvider` is the Blitzy-augmented Backstage `auth`
 * plugin module that registers the `guest` proxy auth provider with an
 * audit-instrumented sign-in resolver.
 *
 * It REPLACES the default
 * `@backstage/plugin-auth-backend-module-guest-provider` registration
 * in `packages/backend/src/index.ts`. The two modules declare the same
 * `pluginId: 'auth'`, `moduleId: 'guest-provider'`, and `providerId:
 * 'guest'` so this module overrides the default cleanly. The
 * authenticator and resolver semantics mirror the upstream package's
 * behavior verbatim, with the addition of:
 *
 *   1. A `user-login` audit event emitted on every sign-in attempt
 *      (success AND failure), recording `provider: 'guest'`,
 *      `emailDomain: 'guest'`, `userEntityRef`, and a synthetic
 *      `correlationId`. This addresses QA CP6 Critical Finding F-002
 *      ("Guest provider does NOT emit user-login audit event"). Without
 *      this audit emission, the AAP §0.1.3 Critical Test Scenario
 *      "User Tracking: Verify Guest login and project access events are
 *      accurately recorded" fails at runtime.
 *
 *   2. An increment of the `user_login_total` Prometheus counter with
 *      `provider: 'guest'`, `email_domain: 'guest'` so dashboards can
 *      observe Guest sign-in volume alongside GitHub and BlitzyE2E
 *      sign-ins (R1 Observability rule).
 *
 *   3. Identical security gating to the upstream default: the
 *      authenticator and resolver both refuse to mint tokens outside a
 *      development environment unless
 *      `auth.providers.guest.dangerouslyAllowOutsideDevelopment: true`
 *      is set in config. The dev-config sets this flag so the local
 *      Playwright suite can mint Guest tokens.
 *
 * The module does NOT populate the user-email cache for Guest
 * principals — guests have no associated email, and the
 * `BlitzyPermissionPolicy` correctly identifies the guest principal
 * via the canonical `user:default/guest` entity ref regardless. The
 * absence of an email entry in the cache is itself the signal the
 * policy uses to enforce DENY for guest writes (see
 * `plugins/permission-backend-module-blitzy-policy/src/policy.ts`).
 */

/**
 * Recreated proxy authenticator for the `guest` provider.
 *
 * The default `@backstage/plugin-auth-backend-module-guest-provider`
 * package's `guestAuthenticator` is NOT publicly exported from its
 * `index.ts` (only the `authModuleGuestProvider` default export is
 * exposed). To replace the resolver with an audit-instrumented version
 * while keeping the authenticator behavior identical, the authenticator
 * is recreated here verbatim from
 * `node_modules/@backstage/plugin-auth-backend-module-guest-provider/src/authenticator.ts`.
 *
 * SECURITY POSTURE:
 *
 *  - `initialize({ config })` reads
 *    `auth.providers.guest.dangerouslyAllowOutsideDevelopment` once at
 *    backend startup and returns a `disabled` flag. The flag is `true`
 *    when the backend is NOT running in a development environment AND
 *    the dangerous flag is NOT set to `true`.
 *
 *  - `authenticate({}, disabled)` throws `NotAllowedError` whenever the
 *    flag is `true`. This is the canonical Backstage guard against
 *    accidentally exposing Guest sign-in in a production deployment.
 *
 * The authenticator is intentionally a 1:1 recreation of the upstream
 * default. Any divergence would risk diverging behavior between this
 * fork and the upstream package and is intentionally avoided.
 */
export const guestAuthenticator = createProxyAuthenticator({
  defaultProfileTransform: async () => {
    return { profile: {} };
  },
  initialize({ config }) {
    const allowOutsideDev = config.getOptionalBoolean(
      'dangerouslyAllowOutsideDevelopment',
    );
    return process.env.NODE_ENV !== 'development' && allowOutsideDev !== true;
  },
  async authenticate(_, disabled) {
    if (disabled) {
      throw new NotAllowedError(
        "The guest provider cannot be used outside of a development environment unless 'auth.providers.guest.dangerouslyAllowOutsideDevelopment' is enabled",
      );
    }
    return { result: {} };
  },
});

/**
 * Creates the audit-instrumented Guest sign-in resolver. Mirrors the
 * audit-emission and metrics patterns established by
 * `createBlitzyGithubSignInResolver` (see `authModuleGithubProvider.ts`)
 * and `createBlitzyE2ESignInResolver` (see `authModuleBlitzyE2E.ts`).
 *
 * The returned resolver:
 *
 *  - Honors the same `dangerouslyAllowOutsideDevelopment` gate as the
 *    upstream default resolver. When the gate is unset and the backend
 *    is running outside development, the resolver throws
 *    `NotImplementedError` BEFORE emitting any audit event. The
 *    rationale: a Guest-disabled deployment must not log "successful
 *    Guest sign-in attempt" lines for requests it actively rejected at
 *    the authenticator layer; doing so would produce misleading audit
 *    trails. The authenticator's `NotAllowedError` has already prevented
 *    the request from reaching this resolver in that scenario, so the
 *    secondary check here is purely defensive (matches the upstream
 *    default's belt-and-suspenders posture).
 *
 *  - Increments the `user_login_total` counter EXACTLY ONCE per resolver
 *    invocation, with `provider: 'guest'`, `email_domain: 'guest'`. The
 *    counter is incremented BEFORE `auditor.createEvent` so the metric
 *    is not skipped if the auditor itself fails (matches the GitHub /
 *    BlitzyE2E patterns).
 *
 *  - Emits a `user-login` audit event with `severityLevel: 'medium'`
 *    and `meta: { provider: 'guest', emailDomain: 'guest',
 *    userEntityRef, correlationId }`. The audit event is followed by
 *    EITHER `.success({...})` on successful token issuance OR
 *    `.fail({error, ...})` on any downstream failure.
 *
 *  - Resolves the canonical Guest user entity ref, preferring the
 *    upstream-default behavior:
 *      1. Try `ctx.signInWithCatalogUser({ entityRef })` first to
 *         honor any catalog-resolved owned-by relations.
 *      2. Fall back to `ctx.issueToken({ claims: { sub, ent } })` if
 *         the Guest user is not present in the catalog (the upstream
 *         default's documented behavior). Guests typically have no
 *         catalog entry so this fallback is the common path.
 *
 *  - The `sub` claim is the Guest entity ref configured via
 *    `auth.providers.guest.userEntityRef`, defaulting to
 *    `user:development/guest` (the upstream default). The `ent`
 *    ownership refs default to `[sub]` matching the upstream behavior.
 *
 * AUDIT LIFECYCLE GUARANTEES (identical to GitHub/BlitzyE2E):
 *  - `createEvent` is awaited in its own try/catch. If `createEvent`
 *    itself rejects (auditor service unavailable), the resolver
 *    rethrows so the Guest sign-in flow surfaces the failure rather
 *    than silently signing the user in without an audit trail. Token
 *    issuance is NOT attempted in this branch.
 *  - On successful token issuance the resolver calls
 *    `auditorEvent.success({ meta: { entityRef, correlationId } })`.
 *  - On any failure after `createEvent` succeeds, the resolver calls
 *    `auditorEvent.fail({ error, meta })` and rethrows so the upstream
 *    auth flow sees the failure.
 *
 * @param auditor - The Backstage `AuditorService` injected from
 *   `coreServices.auditor` at module init time.
 * @param config - The `auth.providers.guest` config block. Used to
 *   read `dangerouslyAllowOutsideDevelopment`, `userEntityRef`, and
 *   `ownershipEntityRefs` (matching the upstream default's signature).
 *
 * Exported for unit testing; the runtime registration is in the
 * default export below.
 */
export function createBlitzyGuestSignInResolver(
  auditor: AuditorService,
  config: Config,
): SignInResolver<{}> {
  return async (_, ctx) => {
    // Defensive secondary check — the authenticator already enforces this
    // gate via NotAllowedError, so this branch is only reachable if a
    // future Backstage release skips the authenticator on certain code
    // paths. Throw the same error the upstream default throws so callers
    // see identical behavior whether or not the audit module is
    // registered.
    if (
      process.env.NODE_ENV !== 'development' &&
      config.getOptionalBoolean('dangerouslyAllowOutsideDevelopment') !== true
    ) {
      throw new NotImplementedError(
        'The guest provider is NOT recommended for use outside of a development environment. If you want to enable this, set `auth.providers.guest.dangerouslyAllowOutsideDevelopment: true` in your app config.',
      );
    }

    // Resolve the canonical Guest user entity ref. Matches the upstream
    // default resolver's lookup priority (config-supplied override falls
    // back to the canonical `user:development/guest`).
    const userRef =
      config.getOptionalString('userEntityRef') ??
      stringifyEntityRef({
        kind: 'user',
        namespace: 'development',
        name: 'guest',
      });
    const ownershipRefs = config.getOptionalStringArray(
      'ownershipEntityRefs',
    ) ?? [userRef];

    // Synthetic correlation id — same pattern as GitHub/BlitzyE2E
    // resolvers. SignInResolver does not expose the Express Request
    // object so the correlationId is the documented correlation
    // mechanism between the audit log and the auth-backend HTTP access
    // log.
    const correlationId = randomUUID();

    // Increment the user-login counter exactly once per sign-in
    // attempt. Recorded BEFORE auditor.createEvent so the metric tracks
    // resolver-observed sign-in attempts even when the auditor itself
    // is unhealthy. The `email_domain: 'guest'` bucket is bounded and
    // PII-safe (Guests have no email by definition).
    userLoginTotal.add(1, {
      provider: 'guest',
      email_domain: bucketSignInEmailDomain('guest'),
    });

    // Audit event creation is wrapped in its own try so that an auditor
    // service failure (e.g., transport down) does not silently sign the
    // user in. If createEvent rejects we surface the failure to the
    // auth caller. Note: there is no `auditorEvent` to call `.fail` on
    // at this point — that lifecycle method only exists after a
    // successful `createEvent` returns.
    let auditorEvent;
    try {
      auditorEvent = await auditor.createEvent({
        eventId: 'user-login',
        severityLevel: 'medium',
        meta: {
          provider: 'guest',
          // Guests have no email by definition; the `emailDomain:
          // 'guest'` sentinel is the documented bucket for the
          // permission-policy and observability dashboards (see
          // `bucketSignInEmailDomain` in `./metrics.ts`). This sentinel
          // is stable, low-cardinality, and never leaks PII.
          emailDomain: 'guest',
          userEntityRef: userRef,
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
      // Try the catalog-resolved path first — matches the upstream
      // default resolver's lookup priority. If the Guest entity is not
      // present in the catalog (the common case — guests typically
      // have no catalog entry), fall back to issuing a token directly
      // with the configured `sub` and `ent` claims.
      let signedIn;
      try {
        signedIn = await ctx.signInWithCatalogUser({ entityRef: userRef });
      } catch (catalogErr) {
        // The upstream default behavior: when the Guest user is not in
        // the catalog, issue a token without catalog hydration. Note
        // that we deliberately do NOT include an `email` claim here —
        // Guests have no verified email, and the BlitzyPermissionPolicy
        // correctly identifies the guest principal via the canonical
        // `user:default/guest` (or `user:development/guest`) entity
        // ref regardless. Omitting the claim keeps the JWT minimal
        // and avoids any ambiguity in the policy's domain check.
        signedIn = await ctx.issueToken({
          claims: {
            sub: userRef,
            ent: ownershipRefs,
          },
        });
        // Log the catalog-miss path via the audit event below — no
        // separate log line is needed because the catalog miss is the
        // expected behavior for Guests.
        void catalogErr;
      }

      await auditorEvent.success({
        meta: {
          entityRef: userRef,
          correlationId,
        },
      });
      return signedIn;
    } catch (err) {
      await auditorEvent.fail({
        error: err as Error,
        meta: {
          entityRef: userRef,
          correlationId,
        },
      });
      throw err;
    }
  };
}

/**
 * The audit-instrumented Guest backend module. Declares the same
 * `pluginId: 'auth'`, `moduleId: 'guest-provider'`, and
 * `providerId: 'guest'` as the upstream
 * `@backstage/plugin-auth-backend-module-guest-provider`, so this
 * module replaces the upstream default when registered in
 * `packages/backend/src/index.ts` instead of the upstream import.
 *
 * @public
 */
export const authModuleGuestProvider = createBackendModule({
  pluginId: 'auth',
  moduleId: 'guest-provider',
  register(reg) {
    reg.registerInit({
      deps: {
        providers: authProvidersExtensionPoint,
        config: coreServices.rootConfig,
        auditor: coreServices.auditor,
      },
      async init({ providers, config, auditor }) {
        providers.registerProvider({
          providerId: 'guest',
          factory: createProxyAuthProviderFactory({
            authenticator: guestAuthenticator,
            signInResolver: createBlitzyGuestSignInResolver(
              auditor,
              config.getConfig('auth.providers.guest'),
            ),
          }),
        });
      },
    });
  },
});

export default authModuleGuestProvider;
