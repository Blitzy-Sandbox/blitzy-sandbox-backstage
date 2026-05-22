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

/**
 * Custom Backstage `UserInfoService` that augments the default
 * implementation by surfacing the verified user email address in the
 * returned `BackstageUserInfo` payload.
 *
 * ## Why this exists
 *
 * The `BlitzyPermissionPolicy` (see
 * `plugins/permission-backend-module-blitzy-policy/src/policy.ts`)
 * enforces a read-only posture for users whose verified email domain is
 * not `@blitzy.com`. The policy looks up the user's email in two
 * places, in this order:
 *
 * 1. `user.info.email` (forward-compatible path) — populated by a
 *    custom `UserInfoService` such as this one.
 * 2. `user.credentials.token` (the original JWT) — decoded via
 *    `jose.decodeJwt` to read the `email` claim.
 *
 * The second path works for direct `POST /api/permission/authorize`
 * calls from the frontend (where the user's original JWT is forwarded
 * verbatim), but it does NOT work for internal plugin-to-plugin
 * permission checks. The catalog backend (and any other plugin) calls
 * the permission backend on-behalf-of a user via
 * `AuthService.getPluginRequestToken({ onBehalfOf, targetPluginId })`,
 * which mints a fresh on-behalf-of token. The on-behalf-of token only
 * carries `sub`, `ent`, `act`, and `aud` claims — the original user's
 * `email` claim is dropped during the on-behalf-of token exchange.
 *
 * The permission backend router constructs the `PolicyQueryUser`
 * object passed to the policy by calling
 * `userInfo.getUserInfo(credentials)` (see
 * `plugins/permission-backend/src/service/router.ts:134`) where
 * `credentials` is the on-behalf-of credentials object. The default
 * `DefaultUserInfoService` decodes only `sub` and `ent` from the
 * on-behalf-of JWT and returns `{ userEntityRef, ownershipEntityRefs }`
 * — no email. The policy then falls through to the JWT decode path,
 * which also fails (no email claim in the on-behalf-of token), and
 * DENYs the write even for `@blitzy.com` users. This is the QA
 * "Critical Defect #2" reported at CP5.
 *
 * ## How this service fixes it
 *
 * This service replaces the default `userInfoServiceFactory` (registered
 * via `backend.add(blitzyUserInfoServiceFactory)` in
 * `packages/backend/src/index.ts`). It produces the same
 * `BackstageUserInfo` shape, plus an additional `email` field when
 * available:
 *
 *   1. Decode the credentials token. If the JWT carries an `email`
 *      claim (the case when the caller is using the user's original
 *      JWT, e.g., direct `/api/permission/authorize` calls), use that
 *      email and ALSO write it through to the in-process email cache.
 *      This populates the cache for the on-behalf-of case below.
 *   2. If the credentials token has no `email` claim (the case for
 *      on-behalf-of tokens), look up the email in the in-process cache
 *      keyed by `userEntityRef`. The cache is populated either by
 *      step 1 above (a direct user-credentialed call earlier in the
 *      request lifecycle) or — more reliably — by the auth resolvers
 *      themselves at sign-in time (see `authModuleGithubProvider.ts`
 *      and `authModuleBlitzyE2E.ts`, both of which call
 *      `cacheUserEmail` after issuing the user token).
 *   3. Return `{ userEntityRef, ownershipEntityRefs, email? }`. The
 *      `email` field is optional — the structural cast in the policy
 *      (`(user.info as { email?: string }).email`) handles the
 *      `undefined` case correctly.
 *
 * The fallback for `ownershipEntityRefs` when the token does not carry
 * the `ent` claim mirrors the default service's behavior: a single
 * fetch to `/api/auth/v1/userinfo`. The custom service preserves that
 * fallback so principals issued before this service was deployed still
 * resolve correctly.
 *
 * ## Security posture
 *
 * - The service NEVER trusts an email value from an unverified source.
 *   Every email returned has either been (a) decoded from a JWT that
 *   was already cryptographically verified by the upstream auth layer
 *   before the request reached this service, or (b) read from the
 *   cache, which is only written by auth resolvers after the
 *   resolver's own validated token-issuance path.
 * - The service NEVER persists email outside the in-process cache; the
 *   cache lives in module scope and is cleared on process restart.
 * - The service does not log email values; only the userEntityRef and
 *   a "found" / "not found" outcome are observable.
 */

import {
  BackstageCredentials,
  BackstageUserInfo,
  DiscoveryService,
  UserInfoService,
  coreServices,
  createServiceFactory,
} from '@backstage/backend-plugin-api';
import { ResponseError } from '@backstage/errors';
import { decodeJwt } from 'jose';
import { cacheUserEmail, lookupUserEmail } from './userEmailCache';

/**
 * Shape returned by `BlitzyUserInfoService.getUserInfo`. Type-compatible
 * with `BackstageUserInfo` plus an optional `email` field. We do NOT
 * widen the public `BackstageUserInfo` interface here (that interface
 * is declared `@public` in `@backstage/backend-plugin-api` and changing
 * it would couple this app to a non-upstream fork). Instead we return
 * an excess-property-bearing object; consumers that know about the
 * email (the `BlitzyPermissionPolicy`) cast structurally to read it.
 */
type BlitzyBackstageUserInfo = BackstageUserInfo & { email?: string };

/**
 * Custom user info service implementation. Decodes the credentials JWT
 * to extract the user entity ref, ownership refs, and email; writes
 * the email through to the in-process cache; and falls back to the
 * cache when the credentials JWT does not contain `email` (the
 * on-behalf-of case).
 */
export class BlitzyUserInfoService implements UserInfoService {
  private readonly discovery: DiscoveryService;

  constructor(options: { discovery: DiscoveryService }) {
    this.discovery = options.discovery;
  }

  async getUserInfo(
    credentials: BackstageCredentials,
  ): Promise<BlitzyBackstageUserInfo> {
    // Validate principal type. We mirror the default service's contract
    // here so any callsite that worked against the default continues to
    // work against this one.
    const principal = (credentials as { principal?: { type?: unknown } })
      .principal;
    if (!principal || principal.type !== 'user') {
      throw new Error('Only user credentials are supported');
    }

    // The token is carried as a non-enumerable property on the internal
    // credentials shape. We access it via a structural cast — the same
    // pattern that `BlitzyPermissionPolicy.extractEmail()` uses (see
    // `plugins/permission-backend-module-blitzy-policy/src/policy.ts`
    // lines 180-198).
    const token = (credentials as { token?: string }).token;
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('User credentials is unexpectedly missing token');
    }

    // Decode the JWT body. We do NOT verify the signature here — the
    // upstream `DefaultAuthService.authenticate` already verified the
    // token before producing this credentials object. Verifying again
    // would be redundant work.
    let payload: ReturnType<typeof decodeJwt>;
    try {
      payload = decodeJwt(token);
    } catch (error) {
      // A decode failure here indicates an unexpected internal state —
      // the auth layer should never hand us a malformed token. Re-throw
      // a descriptive error so the caller can log it; the upstream
      // express layer will translate this to a 500.
      throw new Error(
        `Failed to decode user credentials token: ${(error as Error).message}`,
      );
    }

    const userEntityRef = payload.sub;
    if (typeof userEntityRef !== 'string' || userEntityRef.length === 0) {
      throw new Error('User entity ref must be a non-empty string');
    }

    // Resolve ownership entity refs. Prefer the token claim; fall back
    // to the `/v1/userinfo` endpoint for tokens that predate the `ent`
    // claim. This mirrors the default service's fallback behavior.
    let ownershipEntityRefs = payload.ent;
    if (!ownershipEntityRefs) {
      const userInfoResp = await fetch(
        `${await this.discovery.getBaseUrl('auth')}/v1/userinfo`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!userInfoResp.ok) {
        throw await ResponseError.fromResponse(userInfoResp);
      }

      const body = (await userInfoResp.json()) as {
        claims?: { ent?: unknown };
      };
      ownershipEntityRefs = body.claims?.ent;
    }

    if (!ownershipEntityRefs) {
      throw new Error('Ownership entity refs can not be determined');
    } else if (
      !Array.isArray(ownershipEntityRefs) ||
      ownershipEntityRefs.some(ref => typeof ref !== 'string')
    ) {
      throw new Error('Ownership entity refs must be an array of strings');
    }

    // Extract `email`. The custom claim is set by the sign-in resolvers
    // (`createBlitzyGithubSignInResolver` in
    // `packages/backend/src/authModuleGithubProvider.ts` and the
    // equivalent in `authModuleBlitzyE2E.ts`). It is NOT present on
    // on-behalf-of tokens — that is the cache fallback path below.
    const claimEmail = (payload as { email?: unknown }).email;
    let email: string | undefined;
    if (typeof claimEmail === 'string' && claimEmail.length > 0) {
      email = claimEmail;
      // Write through to the cache so subsequent on-behalf-of calls for
      // the same userEntityRef can resolve the email without the
      // original JWT. This is the fallback population path; the primary
      // population path is in the auth resolvers at sign-in time.
      cacheUserEmail(userEntityRef, email);
    } else {
      // No `email` claim — this is the typical on-behalf-of case. Look
      // up the cache. If a previous direct user-credentialed call or
      // sign-in cached an email for this userEntityRef, surface it.
      email = lookupUserEmail(userEntityRef);
    }

    if (email !== undefined) {
      return {
        userEntityRef,
        ownershipEntityRefs: ownershipEntityRefs as string[],
        email,
      };
    }
    return {
      userEntityRef,
      ownershipEntityRefs: ownershipEntityRefs as string[],
    };
  }
}

/**
 * Backstage backend service factory for the custom user info service.
 *
 * This factory has the same `service` identifier as the default
 * `userInfoServiceFactory` from `@backstage/backend-defaults`, so
 * adding it via `backend.add(blitzyUserInfoServiceFactory)` REPLACES
 * the default. The `ServiceRegistry` implementation in
 * `packages/backend-app-api/src/wiring/ServiceRegistry.ts` allows this
 * because the default factories are seeded directly into
 * `#providedFactories` via `Map.set` (bypassing the duplicate check),
 * while `add()` registers the override into `#addedFactoryIds` and
 * overwrites the entry in `#providedFactories`.
 */
export const blitzyUserInfoServiceFactory = createServiceFactory({
  service: coreServices.userInfo,
  deps: {
    discovery: coreServices.discovery,
  },
  async factory({ discovery }) {
    return new BlitzyUserInfoService({ discovery });
  },
});
