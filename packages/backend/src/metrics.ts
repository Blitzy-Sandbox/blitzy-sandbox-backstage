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
 * Counter recording every GitHub sign-in event observed by the augmented
 * `signInResolver`.
 *
 * Label set:
 * - `provider`      — Fixed to `"github"` today. Declared explicitly to
 *   keep the metric forward-compatible if additional providers gain
 *   audit emission in the future.
 * - `email_domain`  — One of `"blitzy.com"`, `"other"`, or `"unknown"`.
 *   Bucketed via {@link bucketSignInEmailDomain} so the metric stays
 *   bounded and never leaks PII.
 */
export const userLoginTotal: Counter = metrics
  .getMeter(METER_NAME)
  .createCounter('user_login_total', {
    description:
      'GitHub user sign-in events recorded by the augmented signInResolver.',
  });

/**
 * Buckets a sign-in email domain into one of three stable label values:
 * `"blitzy.com"`, `"other"`, or `"unknown"`. The `"unknown"` bucket is
 * used on the failure path and whenever the domain cannot be derived
 * (for example when the GitHub profile exposes no verified email and
 * the resolver synthesizes an `@unknown.invalid` placeholder).
 */
export function bucketSignInEmailDomain(
  emailDomain: string | undefined,
): 'blitzy.com' | 'other' | 'unknown' {
  if (
    typeof emailDomain !== 'string' ||
    emailDomain.length === 0 ||
    emailDomain === 'unknown.invalid'
  ) {
    return 'unknown';
  }
  if (emailDomain.toLowerCase() === 'blitzy.com') {
    return 'blitzy.com';
  }
  return 'other';
}
