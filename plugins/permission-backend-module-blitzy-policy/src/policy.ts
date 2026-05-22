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
 * Email propagation: the augmented GitHub `signInResolver` in
 * `packages/backend/src/authModuleGithubProvider.ts` issues an identity
 * token with a custom `email` claim. Backstage's default
 * `UserInfoService` only extracts `sub` and `ent` from that token, so
 * `user.info.email` is NEVER populated by the default pipeline. This
 * policy therefore decodes the user's verified JWT directly from
 * `user.credentials.token` to read the `email` claim. The JWT was
 * already cryptographically verified by `DefaultAuthService.authenticate`
 * before the credentials object reaches this policy, so we use
 * `jose.decodeJwt` (non-verifying decode) here — verifying again would
 * be redundant work without any security improvement.
 *
 * The `user.info.email` field is still consulted FIRST as a forward-
 * compatible path: if a future deployment installs a custom
 * `UserInfoService` that surfaces email through `BackstageUserInfo`, the
 * policy will pick it up without further code change.
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
 *   1. `user.info.email` — used when a custom `UserInfoService` has
 *      hydrated this field. The Backstage default `UserInfoService` does
 *      NOT populate this, so step 2 is the actual production path.
 *   2. The `email` claim on the validated JWT carried by
 *      `user.credentials.token`. The token was signed by the auth
 *      backend after the augmented GitHub `signInResolver` set the
 *      `email` claim, and it was cryptographically verified by
 *      `DefaultAuthService` before reaching this policy. Decoding here
 *      is a pure read of an already-verified token.
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
  // Forward-compatible path: if a custom UserInfoService populates
  // `info.email`, use it directly. The Backstage default
  // UserInfoService never sets this.
  const infoEmail = (user.info as { email?: string } | undefined)?.email;
  if (typeof infoEmail === 'string' && infoEmail.length > 0) {
    return infoEmail;
  }

  // Production path: decode the validated JWT carried by the
  // credentials object. The token is stored as a non-enumerable
  // property on the internal `BackstageCredentials` shape — accessing it
  // via a structural type assertion is the established pattern used by
  // `packages/backend-defaults/src/entrypoints/userInfo/DefaultUserInfoService.ts`
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
