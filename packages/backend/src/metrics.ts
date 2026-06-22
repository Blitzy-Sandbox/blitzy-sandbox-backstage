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

import { Counter, metrics } from '@opentelemetry/api';

const METER_NAME = 'blitzy-backstage-backend';

/**
 * Counter recording every user sign-in event observed by an augmented
 * `signInResolver` across all supported providers (GitHub OAuth, Guest,
 * and the test-only BlitzyE2E proxy provider).
 *
 * Label set:
 * - `provider`      — One of `"github"`, `"guest"`, or `"blitzy-e2e"`.
 *   Declared explicitly to keep the metric forward-compatible if
 *   additional providers gain audit emission in the future.
 * - `email_domain`  — One of `"blitzy.com"`, `"other"`, `"guest"`, or
 *   `"unknown"`. Bucketed via {@link bucketSignInEmailDomain} so the
 *   metric stays bounded and never leaks PII. The `"guest"` bucket is
 *   reserved for the Guest provider, which has no associated email at
 *   all; using a dedicated bucket keeps Guest sign-in observability
 *   distinct from real users with unverified email domains.
 */
export const userLoginTotal: Counter = metrics
  .getMeter(METER_NAME)
  .createCounter('user_login_total', {
    description:
      'User sign-in events recorded by the augmented signInResolver (across github, guest, and blitzy-e2e providers).',
  });

/**
 * Buckets a sign-in email domain into one of four stable label values:
 * `"blitzy.com"`, `"other"`, `"guest"`, or `"unknown"`.
 *
 * - `"blitzy.com"` — case-insensitive exact match on the input domain.
 * - `"other"` — any other syntactically valid email domain.
 * - `"guest"` — sentinel value reserved for the Guest auth provider,
 *   which has no associated email at all. Callers in the Guest resolver
 *   pass the literal string `"guest"` so the metric records a dedicated
 *   bucket rather than collapsing into `"unknown"` (which is reserved
 *   for the resolver failure / no-verified-email path).
 * - `"unknown"` — used on the failure path and whenever the domain
 *   cannot be derived (for example when the GitHub profile exposes no
 *   verified email and the resolver synthesizes an `@unknown.invalid`
 *   placeholder).
 */
export function bucketSignInEmailDomain(
  emailDomain: string | undefined,
): 'blitzy.com' | 'other' | 'guest' | 'unknown' {
  if (typeof emailDomain !== 'string' || emailDomain.length === 0) {
    return 'unknown';
  }
  const normalized = emailDomain.toLowerCase();
  if (normalized === 'guest') {
    return 'guest';
  }
  if (normalized === 'unknown.invalid') {
    return 'unknown';
  }
  if (normalized === 'blitzy.com') {
    return 'blitzy.com';
  }
  return 'other';
}
