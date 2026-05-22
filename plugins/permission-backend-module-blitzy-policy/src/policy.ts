/*
 * Copyright 2023 The Backstage Authors
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

import { decodeJwt } from 'jose';
import {
  AuthorizeResult,
  PolicyDecision,
} from '@backstage/plugin-permission-common';
import {
  PermissionPolicy,
  PolicyQuery,
  PolicyQueryUser,
} from '@backstage/plugin-permission-node';
import { blitzyPermissionDecisionsTotal, bucketEmailDomain } from './metrics';

/**
 * `BlitzyPermissionPolicy` enforces a read-only posture for users whose
 * verified email domain is not `@blitzy.com` and for Backstage Guest
 * principals.
 *
 * Decision matrix:
 *  - Any `read` action is allowed for any principal (including Guest and
 *    anonymous callers).
 *  - For non-`read` actions (`create`, `update`, `delete`):
 *    - Guest principals are denied.
 *    - Users with a verified `@blitzy.com` email (case-insensitive,
 *      strict suffix match) are allowed.
 *    - All other principals (missing email, non-Blitzy domain,
 *      spoofed-domain subdomain, etc.) are denied.
 *
 * Email propagation — two-source architecture:
 *
 *  1. PRIMARY (preferred): `user.info.email` is populated by the custom
 *     `BlitzyUserInfoService` registered via
 *     `packages/backend/src/userInfoServiceFactory.ts`. That service
 *     replaces the default `userInfoServiceFactory` from
 *     `@backstage/backend-defaults` and reads the email either (a) from
 *     the JWT carried in the credentials object when present, or (b)
 *     from an in-process email cache populated by the auth resolvers
 *     at sign-in time. This is the path that works for INTERNAL
 *     plugin-to-plugin permission checks (e.g., when the catalog
 *     backend calls the permission backend on-behalf-of a user via
 *     `AuthService.getPluginRequestToken({ onBehalfOf, targetPluginId })`).
 *     The on-behalf-of token drops the user's original `email` claim,
 *     so the JWT-decode fallback below cannot recover it — only the
 *     cache lookup can. See `userInfoServiceFactory.ts` for the full
 *     two-source design (JWT-then-cache).
 *
 *  2. FALLBACK: `user.credentials.token` is decoded via `jose.decodeJwt`
 *     (non-verifying — `DefaultAuthService.authenticate` already
 *     cryptographically verified the token before the credentials
 *     object reached this policy). This path covers direct user-
 *     credentialed calls (e.g., the frontend POSTing to
 *     `/api/permission/authorize` with the user's original JWT) where
 *     the user-info service has not yet been called. It also acts as
 *     a defense-in-depth backstop in case the custom user-info
 *     service is not deployed.
 *
 * The augmented sign-in resolvers in
 * `packages/backend/src/authModuleGithubProvider.ts` and
 * `packages/backend/src/authModuleBlitzyE2E.ts` both (a) issue identity
 * tokens with a custom `email` claim AND (b) call
 * `cacheUserEmail(userEntityRef, email)` after successful token
 * issuance. This dual-write ensures the cache is populated for the
 * subsequent on-behalf-of permission-check path.
 *
 * The policy is stateless, side-effect-free, and O(1). It never trusts
 * client-asserted email; it reads only the server-validated JWT claims
 * carried on `BackstageCredentials`.
 *
 * @public
 */
export class BlitzyPermissionPolicy implements PermissionPolicy {
  async handle(
    request: PolicyQuery,
    user?: PolicyQueryUser,
  ): Promise<PolicyDecision> {
    const action = request.permission.attributes?.action ?? 'unknown';
    const guest = isGuestPrincipal(user);
    const email = extractEmail(user);
    const decision = this.#decide(request, guest, email);

    // Increment the metric exactly once per handle() call, after the
    // decision is known. Labels are bucketed via bucketEmailDomain so
    // the cardinality stays at result × {blitzy.com, other, guest} ×
    // action, which is bounded and PII-safe.
    blitzyPermissionDecisionsTotal.add(1, {
      result: decision.result === AuthorizeResult.ALLOW ? 'ALLOW' : 'DENY',
      email_domain: bucketEmailDomain(email, guest),
      action,
    });

    return decision;
  }

  #decide(
    request: PolicyQuery,
    guest: boolean,
    email: string | undefined,
  ): PolicyDecision {
    // Step 1: Read actions are always allowed.
    if (isReadAction(request.permission)) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Step 2: Guest principals (and anonymous requests) are read-only for
    // any non-read action.
    if (guest) {
      return { result: AuthorizeResult.DENY };
    }

    // Step 3: Users with a verified @blitzy.com email may perform writes.
    if (isBlitzyDomain(email)) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Step 4: Fail closed for any other principal attempting a non-read
    // action.
    return { result: AuthorizeResult.DENY };
  }
}

function isReadAction(permission: PolicyQuery['permission']): boolean {
  return permission.attributes?.action === 'read';
}

function isGuestPrincipal(user?: PolicyQueryUser): boolean {
  if (!user) {
    // Anonymous / missing identity is treated as a guest by Backstage's
    // permission framework (no token => no user object passed in).
    return true;
  }
  // Primary detection: canonical guest entity ref produced by the
  // Backstage Guest sign-in flow.
  if (user.info?.userEntityRef === 'user:default/guest') {
    return true;
  }
  // Defensive secondary: forward-compatibility for any future provider
  // that introduces a `'guest'` principal type literal.
  const principalType = (user.credentials as { principal?: { type?: string } })
    ?.principal?.type;
  if (principalType === 'guest') {
    return true;
  }
  return false;
}

/**
 * Extracts the user's verified email from the policy query user object.
 *
 * Lookup order:
 *   1. `user.info.email` — populated by `BlitzyUserInfoService`
 *      (`packages/backend/src/userInfoServiceFactory.ts`). This is the
 *      PRIMARY production path. The custom user-info service surfaces
 *      email by (a) decoding the credentials' JWT when it carries an
 *      `email` claim, or (b) looking up the user's email from an
 *      in-process cache populated by the augmented sign-in resolvers
 *      (`packages/backend/src/userEmailCache.ts`). The cache lookup
 *      is what closes the on-behalf-of token gap — when a plugin
 *      (e.g., catalog backend) calls the permission backend on-behalf-
 *      of a user, the on-behalf-of token does NOT carry the user's
 *      original `email` claim, so a JWT decode of that token alone
 *      cannot recover the email. The cache (populated at sign-in)
 *      bridges the gap.
 *   2. The `email` claim on the validated JWT carried by
 *      `user.credentials.token` — fallback path. Used when a direct
 *      user-credentialed call reaches this policy (e.g., the frontend
 *      POSTing to `/api/permission/authorize` with the user's original
 *      JWT) and the user-info service has not yet been consulted, OR
 *      as a defense-in-depth backstop if the custom user-info service
 *      is not deployed. The token was already cryptographically
 *      verified by `DefaultAuthService` before reaching this policy,
 *      so decoding here is a pure read of an already-verified token.
 *
 * Returns `undefined` when no email is available (missing token,
 * malformed token, missing claim, or non-string claim). Callers treat
 * `undefined` as a non-Blitzy domain (DENY for writes).
 *
 * @internal exported for testing
 */
export function extractEmail(user?: PolicyQueryUser): string | undefined {
  if (!user) {
    return undefined;
  }
  // PRIMARY production path: read email from the user info populated by
  // BlitzyUserInfoService. The custom user-info service hydrates this
  // field from either the JWT (when the email claim is present) or the
  // sign-in email cache (when the on-behalf-of token has stripped the
  // claim). See packages/backend/src/userInfoServiceFactory.ts.
  const infoEmail = (user.info as { email?: string } | undefined)?.email;
  if (typeof infoEmail === 'string' && infoEmail.length > 0) {
    return infoEmail;
  }

  // FALLBACK path: decode the validated JWT carried by the credentials
  // object. Used when the user-info service has not been consulted
  // upstream OR as a defense-in-depth backstop. The token is stored as
  // a property on the internal `BackstageCredentials` shape — accessing
  // it via a structural type assertion is the established pattern used
  // by `packages/backend-defaults/src/entrypoints/userInfo/DefaultUserInfoService.ts`
  // and elsewhere in the Backstage backend.
  const credentialsToken = (user.credentials as { token?: string } | undefined)
    ?.token;
  if (typeof credentialsToken !== 'string' || credentialsToken.length === 0) {
    return undefined;
  }
  try {
    const payload = decodeJwt(credentialsToken);
    const claimEmail = (payload as { email?: unknown }).email;
    if (typeof claimEmail === 'string' && claimEmail.length > 0) {
      return claimEmail;
    }
  } catch {
    // Malformed JWT — treat as no email available. The DefaultAuthService
    // already cryptographically verified the token before invoking this
    // policy, so a decode failure here would indicate an unexpected
    // internal state. Failing closed to DENY is the safe response.
    return undefined;
  }
  return undefined;
}

function isBlitzyDomain(email: string | undefined): boolean {
  if (!email) {
    return false;
  }
  // Case-insensitive, strict suffix match on '@blitzy.com'. Subdomains
  // like '@dev.blitzy.com' and lookalikes like '@notblitzy.com' are
  // intentionally NOT matched.
  return email.toLowerCase().endsWith('@blitzy.com');
}
