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

import {
  AuthorizeResult,
  PolicyDecision,
} from '@backstage/plugin-permission-common';
import {
  PermissionPolicy,
  PolicyQuery,
  PolicyQueryUser,
} from '@backstage/plugin-permission-node';

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
 * The policy is stateless, side-effect-free, and O(1). It never trusts
 * client-asserted email; it reads only the server-side hydrated
 * `info.email` field populated by the augmented GitHub `signInResolver`.
 *
 * @public
 */
export class BlitzyPermissionPolicy implements PermissionPolicy {
  async handle(
    request: PolicyQuery,
    user?: PolicyQueryUser,
  ): Promise<PolicyDecision> {
    // Step 1: Read actions are always allowed.
    if (isReadAction(request.permission)) {
      return { result: AuthorizeResult.ALLOW };
    }

    // Step 2: Guest principals (and anonymous requests) are read-only for
    // any non-read action.
    if (isGuestPrincipal(user)) {
      return { result: AuthorizeResult.DENY };
    }

    // Step 3: Users with a verified @blitzy.com email may perform writes.
    const email = extractEmail(user);
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

function extractEmail(user?: PolicyQueryUser): string | undefined {
  if (!user) {
    return undefined;
  }
  // The augmented signInResolver hydrates `info.email`. The
  // BackstageUserInfo type does not declare this field, so we read it
  // via a typed projection rather than via `as any`.
  const email = (user.info as { email?: string } | undefined)?.email;
  return typeof email === 'string' && email.length > 0 ? email : undefined;
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
