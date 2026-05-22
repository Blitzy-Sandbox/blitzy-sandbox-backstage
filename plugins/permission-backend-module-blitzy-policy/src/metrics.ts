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

const METER_NAME = 'blitzy-permission-policy';

/**
 * Counter recording every ALLOW/DENY decision returned by
 * {@link ./policy.BlitzyPermissionPolicy.handle}.
 *
 * Label set:
 * - `result`        — `"ALLOW"` or `"DENY"` (uppercase, matches
 *   {@link @backstage/plugin-permission-common.AuthorizeResult}).
 * - `email_domain`  — One of `"blitzy.com"`, `"other"`, or `"guest"`.
 *   Bucketed via {@link bucketEmailDomain} so the label set stays bounded
 *   and does not leak PII.
 * - `action`        — The permission attribute action: `"read"`,
 *   `"create"`, `"update"`, `"delete"`, or `"unknown"` when the
 *   permission carries no attribute. Cardinality is bounded by the
 *   Backstage permission framework.
 */
export const blitzyPermissionDecisionsTotal: Counter = metrics
  .getMeter(METER_NAME)
  .createCounter('blitzy_permission_decisions_total', {
    description:
      'Permission policy ALLOW/DENY decisions recorded by BlitzyPermissionPolicy.handle().',
  });

/**
 * Buckets an email or principal descriptor into one of three stable
 * label values: `"blitzy.com"`, `"other"`, or `"guest"`. Avoids leaking
 * the raw email or domain through Prometheus labels (which are
 * persisted and scraped by every downstream consumer) while keeping
 * the metric cardinality at three.
 */
export function bucketEmailDomain(
  email: string | undefined,
  isGuest: boolean,
): 'blitzy.com' | 'other' | 'guest' {
  if (isGuest) {
    return 'guest';
  }
  if (
    typeof email === 'string' &&
    email.toLowerCase().endsWith('@blitzy.com')
  ) {
    return 'blitzy.com';
  }
  return 'other';
}
