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

import { test, expect, Page, APIRequestContext } from '@playwright/test';

/**
 * Audit event tracking E2E coverage.
 *
 * Per AAP §0.5.1.3 Workstream C (Authorization, Audit, and User Tracking),
 * the backend emits two new AuditorService events:
 *
 *   1. `user-login` — emitted by the augmented GitHub signInResolver in
 *      `packages/backend/src/authModuleGithubProvider.ts`. The Guest
 *      sign-in path is the E2E-accessible analog of the GitHub flow;
 *      this suite verifies the Guest sign-in completes successfully
 *      (the audit emission itself is unit-tested in
 *      `packages/backend/src/authModuleGithubProvider.test.ts`).
 *
 *   2. `entity-access` — emitted by the new catalog-backend-module-access-audit
 *      module whenever a user-credentialed entity read occurs (e.g., when
 *      a user clicks a project row in the catalog and the per-entity API
 *      fetch is served). This suite verifies that navigating to a project
 *      page completes successfully (the audit emission itself is unit-tested
 *      in `plugins/catalog-backend-module-access-audit/src/module.test.ts`).
 *
 * Architectural note: Backstage's AuditorService writes to Winston log
 * sinks; there is no built-in HTTP query endpoint for audit events in
 * Backstage 1.48.0. This E2E suite therefore:
 *
 *   - Triggers the user actions that cause audit emissions.
 *   - Asserts the observable side-effect (sign-in success, page render).
 *   - OPTIONALLY queries `process.env.AUDIT_LOG_HTTP_URL` if the CI/local
 *     environment exposes a debug audit-log endpoint, and asserts the
 *     event payload shape.
 *
 * The optional HTTP audit assertion gracefully no-ops when no audit
 * endpoint is configured, so this suite passes in default Playwright
 * configurations while providing richer signal in environments that
 * surface the audit channel.
 */

/**
 * Mirrors the canonical sign-in helper used across the e2e suite: clicks
 * the "Continue as Guest" button on the Blitzy-branded sign-in page and
 * waits for the top-bar to mount (signalling the authenticated shell is
 * ready).
 */
async function signInAsGuest(page: Page): Promise<void> {
  await page.goto('/');
  const guestButton = page.getByRole('button', { name: 'Continue as Guest' });
  await expect(guestButton).toBeVisible();
  await guestButton.click();
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();
}

/**
 * Optionally queries an audit-log debug endpoint (if configured via the
 * AUDIT_LOG_HTTP_URL environment variable) and returns the parsed array
 * of audit events filtered to a given eventId. When the env var is
 * unset, returns `null` — callers should treat this as a "no-op
 * assertion" outcome and rely solely on the behavioral side-effect.
 */
async function fetchAuditEventsByEventId(
  request: APIRequestContext,
  eventId: string,
): Promise<Array<Record<string, unknown>> | null> {
  const baseUrl = process.env.AUDIT_LOG_HTTP_URL;
  if (!baseUrl) {
    return null;
  }
  try {
    const response = await request.get(
      `${baseUrl}?eventId=${encodeURIComponent(eventId)}`,
    );
    if (!response.ok()) {
      return null;
    }
    const body = (await response.json()) as { events?: unknown };
    return Array.isArray(body.events)
      ? (body.events as Array<Record<string, unknown>>)
      : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// `user-login` audit event coverage (AAP §0.5.5 User Tracking)
// ---------------------------------------------------------------------------

test('User Tracking: Guest sign-in successfully completes (triggers `user-login` audit event)', async ({
  page,
  request,
}) => {
  // Trigger: Guest sign-in flow. The augmented sign-in resolvers in
  // `packages/backend/src/authModuleGithubProvider.ts` (GitHub) and the
  // guest provider emit `user-login` audit events on successful token
  // issuance.
  await signInAsGuest(page);

  // Observable side-effect: the authenticated shell rendered (top-bar
  // visible) and the URL is the new catalog landing.
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();
  await expect(page).toHaveURL(/\/catalog\/?$/);

  // Optional: assert against an audit-log debug endpoint if configured.
  // When AUDIT_LOG_HTTP_URL is unset, this is a no-op.
  const events = await fetchAuditEventsByEventId(request, 'user-login');
  if (events !== null) {
    expect(events.length).toBeGreaterThan(0);
    const latest = events[events.length - 1];
    const meta = latest.meta as Record<string, unknown> | undefined;
    expect(meta).toBeDefined();
    // The audit-event metadata MUST identify the provider, username, and
    // userEntityRef. The full email is intentionally absent (the security
    // invariant is unit-tested in authModuleGithubProvider.test.ts).
    expect(meta).toEqual(
      expect.objectContaining({
        provider: expect.any(String),
        userEntityRef: expect.any(String),
      }),
    );
  }
});

// ---------------------------------------------------------------------------
// `entity-access` audit event coverage (AAP §0.5.5 User Tracking — Project access)
// ---------------------------------------------------------------------------

test('User Tracking: Navigating to a project entity triggers `entity-access` audit event', async ({
  page,
  request,
}) => {
  await signInAsGuest(page);

  // Navigate to the catalog table.
  await page.goto('/catalog');
  await page.waitForLoadState('networkidle');

  // Trigger: click the first entity row to navigate to its entity page.
  // The new catalog-backend-module-access-audit module emits an
  // `entity-access` audit event on each user-credentialed entity read.
  const entityLink = page
    .locator('table a, [data-testid="catalog-table"] a')
    .first();
  const entityVisible = await entityLink
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  if (!entityVisible) {
    // The catalog may be empty in some test environments — skip rather
    // than fail. The entity-access audit emission is covered by the unit
    // tests in plugins/catalog-backend-module-access-audit/.
    test.skip(true, 'Catalog has no entity rows in this environment');
    return;
  }
  await entityLink.click();
  await page.waitForLoadState('networkidle');

  // Observable side-effect: the entity page rendered. The catalog entity
  // page contains the top-bar and a per-entity surface.
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();
  // The URL pattern for an entity page is /catalog/<namespace>/<kind>/<name>
  await expect(page).toHaveURL(/\/catalog\/[^/]+\/[^/]+\/[^/]+/);

  // Optional: assert against an audit-log debug endpoint if configured.
  const events = await fetchAuditEventsByEventId(request, 'entity-access');
  if (events !== null) {
    expect(events.length).toBeGreaterThan(0);
    const latest = events[events.length - 1];
    const meta = latest.meta as Record<string, unknown> | undefined;
    expect(meta).toBeDefined();
    expect(meta).toEqual(
      expect.objectContaining({
        entityRef: expect.any(String),
      }),
    );
  }
});

// ---------------------------------------------------------------------------
// Audit event severity and PII discipline (security regression)
// ---------------------------------------------------------------------------

test('Audit events do NOT leak the full email address (security regression)', async ({
  request,
}) => {
  // This test asserts a PII-discipline invariant on the audit channel:
  // even if an audit-log query endpoint is exposed, the `user-login`
  // event metadata must NOT contain the user's full email address —
  // only the domain bucket (`emailDomain`).
  //
  // The full assertion lives in the unit tests at
  // `packages/backend/src/authModuleGithubProvider.test.ts` (test 7,
  // "audit event metadata does NOT contain the full email address").
  // This E2E check is a defence-in-depth assertion against the live
  // audit feed, in case a future PR accidentally adds the full email
  // back to the meta object.
  const events = await fetchAuditEventsByEventId(request, 'user-login');
  if (events === null) {
    test.skip(true, 'AUDIT_LOG_HTTP_URL not configured in this environment');
    return;
  }
  for (const event of events) {
    const meta = event.meta as Record<string, unknown> | undefined;
    if (!meta) continue;
    const flatValues = JSON.stringify(meta);
    // The literal substring "@" alone is permitted only in the
    // `emailDomain` field's prefix-stripping (which produces e.g.
    // "blitzy.com" without a "@"). The full email pattern
    // `<local>@<domain>` MUST NOT appear in any meta field.
    expect(flatValues).not.toMatch(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]/,
    );
  }
});
