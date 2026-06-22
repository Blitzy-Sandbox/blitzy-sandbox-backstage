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
 * In-process cache of verified user email addresses, keyed by the
 * canonical Backstage user entity reference (for example,
 * `user:default/alex`).
 *
 * ## Why this exists
 *
 * The `BlitzyPermissionPolicy` enforces a read-only posture for users
 * whose verified email domain is not `@blitzy.com`. Read of the email
 * is straightforward when the policy receives a direct user-credentialed
 * permission call (`POST /api/permission/authorize` from the frontend)
 * — the original user JWT carries the custom `email` claim and the
 * policy decodes it.
 *
 * However, when the catalog backend (or any other plugin) calls the
 * permission backend on behalf of a user, the inter-plugin auth wraps
 * the user identity in a fresh on-behalf-of token produced by
 * `AuthService.getPluginRequestToken({ onBehalfOf, targetPluginId })`.
 * The on-behalf-of token carries `sub`, `ent`, `act`, `aud` claims —
 * but it does NOT carry the original user's `email` claim. The policy
 * therefore sees `extractEmail()` return `undefined` and DENYs the
 * write — even for `@blitzy.com` users.
 *
 * The cache is populated at sign-in time by the auth resolvers (both
 * GitHub and BlitzyE2E) and read by the custom `UserInfoService`
 * factory in `userInfoServiceFactory.ts`. The user-info service is
 * called by the permission backend router immediately before invoking
 * the policy (`plugins/permission-backend/src/service/router.ts`
 * line 134). With the cache populated at sign-in, the user-info
 * service can surface `email` even for on-behalf-of credentials,
 * which then flows into the policy's `user.info.email` lookup path
 * and produces the correct ALLOW decision.
 *
 * ## Scope and lifetime
 *
 * The cache lives in module scope for the duration of the Node
 * process. It is intentionally not persistent — restarting the backend
 * empties the cache. The cache will repopulate as users sign in or as
 * direct user-credentialed permission calls reach the user-info
 * service (which also writes through to the cache).
 *
 * The cache has a hard upper bound of {@link MAX_CACHE_ENTRIES}
 * entries; beyond that, the oldest entries are evicted FIFO so the
 * cache cannot grow unboundedly in a long-running process.
 *
 * ## Security posture
 *
 * The cache stores ONLY the verified email address that was already
 * issued to the user as a JWT claim by an auth resolver. It never
 * accepts an email from a client header or other unverified source.
 * The cache is read-only from the policy's perspective and write-only
 * from the auth resolvers' perspective.
 */

const MAX_CACHE_ENTRIES = 10_000;

// Underlying storage. JavaScript Map preserves insertion order, which
// makes FIFO eviction trivial: the first key returned by `keys()` is
// the oldest entry.
const cache = new Map<string, string>();

/**
 * Records the verified email for the given user entity ref.
 *
 * If the cache is at capacity ({@link MAX_CACHE_ENTRIES} entries), the
 * oldest entry is evicted before the new entry is inserted. If the
 * same `userEntityRef` is already present, the existing entry is
 * removed and re-inserted so it becomes the newest — this keeps active
 * users from being evicted ahead of stale entries during ordinary
 * sign-in churn.
 *
 * No-ops silently when `userEntityRef` or `email` is empty/invalid;
 * the caller is expected to validate inputs but the cache itself is
 * defensive.
 */
export function cacheUserEmail(userEntityRef: string, email: string): void {
  if (
    typeof userEntityRef !== 'string' ||
    userEntityRef.length === 0 ||
    typeof email !== 'string' ||
    email.length === 0
  ) {
    return;
  }
  // Re-insert pattern: delete-then-set marks the entry as newest in
  // Map insertion order so it is not the next FIFO eviction target.
  if (cache.has(userEntityRef)) {
    cache.delete(userEntityRef);
  } else if (cache.size >= MAX_CACHE_ENTRIES) {
    // Evict the oldest entry. `keys()` iterates in insertion order;
    // `next().value` is the oldest key.
    const oldest = cache.keys().next().value;
    if (typeof oldest === 'string') {
      cache.delete(oldest);
    }
  }
  cache.set(userEntityRef, email);
}

/**
 * Returns the verified email previously cached for `userEntityRef`,
 * or `undefined` when no entry is present.
 */
export function lookupUserEmail(
  userEntityRef: string | undefined,
): string | undefined {
  if (typeof userEntityRef !== 'string' || userEntityRef.length === 0) {
    return undefined;
  }
  return cache.get(userEntityRef);
}

/**
 * Removes all entries from the cache. Intended for unit tests that
 * need a hermetic starting state. NOT exported from `index.ts`; only
 * intra-process callers (e.g., this package's own tests) can reach it.
 *
 * @internal exported for testing
 */
export function _testOnlyClearUserEmailCache(): void {
  cache.clear();
}

/**
 * Returns the current cache size. Used by unit tests to assert FIFO
 * eviction behavior.
 *
 * @internal exported for testing
 */
export function _testOnlyCacheSize(): number {
  return cache.size;
}

/**
 * Returns the cache's maximum capacity. Exported for tests that need
 * to assert eviction behavior without coupling to a literal magic
 * number.
 *
 * @internal exported for testing
 */
export const _testOnlyMaxCacheEntries = MAX_CACHE_ENTRIES;
