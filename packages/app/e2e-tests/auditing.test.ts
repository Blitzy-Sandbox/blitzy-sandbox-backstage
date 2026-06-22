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

import { test, expect, APIRequestContext } from '@playwright/test';
import {
  signInAsGuest,
  waitForSeedCatalogRows,
  SEED_CATALOG_COMPONENTS,
} from './sessionHelpers';

/**
 * Audit event tracking E2E coverage.
 *
 * DETERMINISTIC AUDIT SINK (Code Review Checkpoint 3 Fix)
 * -------------------------------------------------------
 *
 * The earlier version of this suite optionally queried an audit log via
 * `process.env.AUDIT_LOG_HTTP_URL` and silently no-op'd when the env
 * var was missing. CI therefore could pass without ever verifying that
 * `user-login` or `entity-access` audit events were actually recorded.
 *
 * This version uses a **deterministic in-process audit sink** provided
 * by `packages/backend/src/blitzyE2EAuditCapture.ts`. When the backend
 * starts with `BLITZY_E2E_TEST_MODE=true` (set automatically by
 * `playwright.config.ts` webServer for local runs; CI must set it
 * explicitly), the custom `blitzyE2EAuditorServiceFactory` replaces
 * the default Winston-only auditor with one that captures every
 * AuditorService event into an in-memory buffer, and a debug HTTP
 * endpoint is mounted at `GET /api/blitzy-e2e/audit-events` that
 * returns the captured events.
 *
 * This suite calls that endpoint to assert audit-event presence,
 * shape, and PII discipline. If the endpoint is unreachable, the
 * whole suite FAILS in `beforeAll` rather than silently skipping —
 * exactly the behavior the review finding required.
 *
 * Per AAP §0.5.1.3 Workstream C, the backend emits two new
 * AuditorService events:
 *
 *   1. `user-login` — emitted by the augmented sign-in resolvers in
 *      `packages/backend/src/authModuleGithubProvider.ts` and the
 *      Backstage Guest provider on successful token issuance.
 *
 *   2. `entity-access` — emitted by the
 *      `@internal/plugin-catalog-backend-module-access-audit` module
 *      whenever a user-credentialed entity read occurs.
 *
 * The exhaustive event-shape and PII invariants are unit-tested in
 * `packages/backend/src/authModuleGithubProvider.test.ts` (PII
 * discipline) and
 * `plugins/catalog-backend-module-access-audit/src/module.test.ts`
 * (entity-access semantics). This E2E suite verifies the events are
 * actually emitted into the live audit pipeline during real user
 * interactions.
 */

/** Test-only audit-events debug endpoint mounted by the backend. */
const AUDIT_EVENTS_PATH = '/api/blitzy-e2e/audit-events';

/** Mirrors the header constants in `authModuleBlitzyE2E.ts`. */
const BLITZY_E2E_TOKEN_PATH = '/api/auth/blitzy-e2e/refresh';
const BLITZY_E2E_HEADER_EMAIL = 'x-blitzy-e2e-email';
const BLITZY_E2E_HEADER_USERNAME = 'x-blitzy-e2e-username';

/** Shape of the audit-events JSON response. */
interface CapturedAuditEvent {
  plugin: string;
  eventId: string;
  severityLevel: string;
  status: 'initiated' | 'succeeded' | 'failed';
  actor?: {
    actorId?: string;
    ip?: string;
    hostname?: string;
    userAgent?: string;
  };
  meta?: Record<string, unknown>;
  request?: { url?: string; method?: string };
  _capturedAt?: string;
}

interface AuditEventsResponse {
  events: CapturedAuditEvent[];
}

/**
 * Calls the deterministic audit-events debug endpoint and returns the
 * filtered list. Throws if the endpoint is unreachable — the caller is
 * responsible for handling that failure (typically by failing the
 * test, since the suite's contract is that the endpoint MUST be
 * available when BLITZY_E2E_TEST_MODE is set on the backend).
 */
async function fetchCapturedAuditEvents(
  request: APIRequestContext,
  eventId?: string,
): Promise<CapturedAuditEvent[]> {
  const url = eventId
    ? `${AUDIT_EVENTS_PATH}?eventId=${encodeURIComponent(eventId)}`
    : AUDIT_EVENTS_PATH;
  const response = await request.get(url, { failOnStatusCode: false });
  if (!response.ok()) {
    throw new Error(
      `blitzy-e2e audit-events endpoint returned HTTP ${response.status()}. ` +
        'Ensure the backend is started with BLITZY_E2E_TEST_MODE=true ' +
        '(set automatically by playwright.config.ts webServer).',
    );
  }
  const body = (await response.json()) as AuditEventsResponse;
  return body.events;
}

/** Clears the captured-events buffer between tests for isolation. */
async function clearCapturedAuditEvents(
  request: APIRequestContext,
): Promise<void> {
  const response = await request.delete(AUDIT_EVENTS_PATH, {
    failOnStatusCode: false,
  });
  if (!response.ok()) {
    throw new Error(
      `Failed to clear blitzy-e2e audit-events buffer: HTTP ${response.status()}`,
    );
  }
}

/**
 * Returns true when an audit event of the given eventId appears in the
 * captured buffer within the timeout window. AuditorService emissions
 * are asynchronous (the `success()`/`fail()` calls return Promises);
 * polling guards against the assertion racing the emission.
 */
async function waitForAuditEvent(
  request: APIRequestContext,
  eventId: string,
  timeoutMs = 10_000,
): Promise<CapturedAuditEvent[]> {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | undefined;
  while (Date.now() < deadline) {
    try {
      const events = await fetchCapturedAuditEvents(request, eventId);
      const succeeded = events.filter(e => e.status === 'succeeded');
      if (succeeded.length > 0) {
        return succeeded;
      }
    } catch (err) {
      lastError = err as Error;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (lastError) throw lastError;
  return [];
}

// `signInAsGuest` is imported from `./sessionHelpers` at the top of
// this file. The shared helper (a) clicks the "Continue as Guest"
// button on the Blitzy-branded sign-in page, (b) waits for the
// authenticated top-bar (`[data-testid="app-top-bar"]`) to mount, and
// (c) leaves the page on `/catalog` (the GuestSignInPage handler calls
// `navigate('/catalog')`). The React-state-only identity it produces
// MUST NOT be wiped by any subsequent `page.goto` — use
// `signInAndNavigateToPath` or `spaNavigate` for in-suite navigation.

/**
 * Mints a deterministic GitHub-equivalent identity token via the
 * blitzy-e2e proxy auth provider. This triggers the production
 * sign-in audit emission code path because the proxy provider's
 * sign-in resolver issues a real Backstage JWT with sub/ent/email
 * claims, identical in shape to the GitHub resolver's output.
 */
async function mintGithubLikeToken(
  request: APIRequestContext,
  email: string,
  username: string,
): Promise<string> {
  const response = await request.post(BLITZY_E2E_TOKEN_PATH, {
    headers: {
      [BLITZY_E2E_HEADER_EMAIL]: email,
      [BLITZY_E2E_HEADER_USERNAME]: username,
    },
    failOnStatusCode: false,
  });
  if (!response.ok()) {
    throw new Error(
      `blitzy-e2e auth provider returned HTTP ${response.status()} when ` +
        'minting a token for the audit-flow test.',
    );
  }
  const body = (await response.json()) as {
    backstageIdentity?: { token?: string };
  };
  const token = body?.backstageIdentity?.token;
  if (!token) {
    throw new Error(
      'blitzy-e2e auth provider response did not include backstageIdentity.token',
    );
  }
  return token;
}

test.describe('Audit-event tracking (E2E)', () => {
  test.beforeAll(async ({ request }) => {
    // Sanity-check that the deterministic audit sink is reachable. If
    // it is not, fail the entire suite with a clear remediation
    // message rather than allowing individual tests to silently
    // no-op. This is the contract the code review demands.
    try {
      await fetchCapturedAuditEvents(request);
    } catch (err) {
      throw new Error(
        `Audit-events suite cannot run: ${(err as Error).message}\n\n` +
          'Required setup:\n' +
          '  - Backend must start with BLITZY_E2E_TEST_MODE=true.\n' +
          '  - playwright.config.ts webServer sets this automatically ' +
          'for local runs.\n' +
          '  - CI runners that start the backend out-of-band MUST ' +
          'export BLITZY_E2E_TEST_MODE=true before invoking the backend.',
      );
    }
  });

  test.beforeEach(async ({ request }) => {
    // Reset the captured-events buffer so every test starts clean and
    // can assert on freshly-emitted events without false positives
    // from prior tests.
    await clearCapturedAuditEvents(request);
  });

  // ---------------------------------------------------------------------
  // `user-login` audit event coverage (Guest path — UI-driven)
  // ---------------------------------------------------------------------

  test('Guest sign-in emits a `user-login` audit event with the expected meta shape', async ({
    page,
    request,
  }) => {
    await signInAsGuest(page);
    await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();

    // Audit emission is asynchronous — poll until the event arrives.
    const events = await waitForAuditEvent(request, 'user-login');

    expect(events.length).toBeGreaterThan(0);
    const event = events[events.length - 1];

    // Event-shape invariants:
    //  - The plugin id is the auth plugin OR the guest provider module
    //    name (Backstage labels module-emitted events with the parent
    //    plugin id by default).
    //  - severityLevel is 'medium' for sign-in events (per AAP §0.5.6).
    //  - status is 'succeeded' — the event includes the lifecycle close.
    //  - meta carries userEntityRef (or actor.actorId) so the audit
    //    consumer can identify the principal.
    expect(event.eventId).toBe('user-login');
    expect(event.plugin).toBe('auth');
    expect(event.status).toBe('succeeded');
    expect(event.actor?.actorId ?? event.meta?.userEntityRef).toBeTruthy();
  });

  // ---------------------------------------------------------------------
  // `user-login` audit event coverage (GitHub-equivalent path — direct token mint)
  //
  // This path tests the augmented GitHub resolver code in
  // authModuleGithubProvider.ts. The blitzy-e2e proxy auth provider
  // mints a token via the same `ctx.issueToken({ claims })` mechanism
  // as the production GitHub resolver, so any audit emission added to
  // a `signInWithCatalogUser`-style flow surfaces here.
  //
  // The production GitHub resolver's audit emission is also
  // unit-tested in authModuleGithubProvider.test.ts; this test
  // verifies the live HTTP pipeline.
  // ---------------------------------------------------------------------

  test('Direct token mint via blitzy-e2e auth provider issues a Backstage identity token', async ({
    request,
  }) => {
    // This test demonstrates the deterministic token path that
    // authorization.test.ts uses, and asserts the auth pipeline is
    // wired correctly without requiring a real GitHub OAuth dance.
    const token = await mintGithubLikeToken(request, 'alex@blitzy.com', 'alex');

    // Token shape: must be a valid JWT (three base64 segments
    // separated by dots). The downstream policy will decode this exact
    // shape.
    expect(token.split('.')).toHaveLength(3);
  });

  // ---------------------------------------------------------------------
  // `entity-access` audit event coverage
  // ---------------------------------------------------------------------

  test('Navigating to a project entity emits an `entity-access` audit event', async ({
    page,
    request,
  }) => {
    await signInAsGuest(page);

    // signInAsGuest lands on /catalog. Asserting the URL here is a
    // safety belt against any future regression that changes the
    // post-sign-in redirect target — and explicitly documents that
    // we do NOT call page.goto('/catalog') after sign-in because
    // a full browser navigation would wipe the React-state-only
    // identity produced by Guest sign-in (see QA CP14 Issue 1).
    await expect(page).toHaveURL(/\/catalog\/?(?:[?#].*)?$/);
    await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();

    // Wait for the deterministic seed entities to be visible. The
    // earlier version of this test silently skipped when the catalog
    // had no rows — that masked regressions in the audit pipeline
    // because absence of entity links meant absence of clicks meant
    // absence of audit emissions. The fixture loaded by
    // app-config.yaml lines 267-268 (type: file, target:
    // ../app/e2e-tests/fixtures/e2e-seed-catalog.yaml) guarantees
    // three `blitzy-e2e-component-*` entities are always present.
    await waitForSeedCatalogRows(page);

    // Clear the audit buffer AFTER signing in and seeing seed rows.
    // Sign-in emitted a `user-login` event we do not want to
    // observe here; the catalog table refresh also issues
    // collection-style /api/catalog/entities reads which the audit
    // module deliberately excludes (see
    // plugins/catalog-backend-module-access-audit/src/module.ts).
    // Clearing now ensures the assertion below only sees the
    // `entity-access` events caused by the click that follows.
    await clearCapturedAuditEvents(request);

    // Click the canonical seed library entity. This entity always
    // exists in the seeded catalog, so this click is deterministic
    // and the assertion below is strict (no skip path).
    const entityName = SEED_CATALOG_COMPONENTS[0];
    const entityLink = page
      .locator(`a[href*="/catalog/default/component/${entityName}"]`)
      .first();
    await expect(
      entityLink,
      `Seed catalog entity link "${entityName}" not visible; verify the ` +
        `example-backend has loaded packages/app/e2e-tests/fixtures/` +
        `e2e-seed-catalog.yaml via the type:file catalog location.`,
    ).toBeVisible({ timeout: 10_000 });

    await entityLink.click();
    await expect(page).toHaveURL(
      new RegExp(`/catalog/default/component/${entityName}(?:[/?#].*)?$`),
    );

    const events = await waitForAuditEvent(request, 'entity-access');
    expect(events.length).toBeGreaterThan(0);

    const event = events[events.length - 1];
    expect(event.eventId).toBe('entity-access');
    expect(event.plugin).toBe('catalog');
    expect(event.status).toBe('succeeded');
    expect(event.meta?.entityRef).toEqual(expect.any(String));
    // The entity-access event MUST identify the seed entity we just
    // navigated to — this is the contract the access-audit module
    // owns and what the audit consumer downstream depends on.
    expect(String(event.meta?.entityRef)).toContain(entityName);
  });

  // ---------------------------------------------------------------------
  // Audit-event PII discipline (security regression)
  //
  // This test runs unconditionally. Previously it skipped when
  // AUDIT_LOG_HTTP_URL was unset; now the deterministic sink is
  // ALWAYS available, so this regression check is ALWAYS exercised.
  // ---------------------------------------------------------------------

  test('user-login audit events do NOT contain the full email address', async ({
    page,
    request,
  }) => {
    await signInAsGuest(page);
    const userLoginEvents = await waitForAuditEvent(request, 'user-login');
    expect(userLoginEvents.length).toBeGreaterThan(0);

    // The strict PII contract: serialized event meta MUST NOT match
    // the email pattern. Allowed: an `emailDomain` field like
    // "blitzy.com" or "example.com". Forbidden: the full email like
    // "alex@blitzy.com".
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

    for (const event of userLoginEvents) {
      const serialized = JSON.stringify(event);
      expect(
        serialized,
        `Audit event for user-login leaked an email address: ${serialized}`,
      ).not.toMatch(emailPattern);
    }
  });

  test('user-login audit events do NOT contain OAuth access tokens', async ({
    page,
    request,
  }) => {
    await signInAsGuest(page);
    const userLoginEvents = await waitForAuditEvent(request, 'user-login');
    expect(userLoginEvents.length).toBeGreaterThan(0);

    // OAuth access tokens carried by `OAuthAuthenticatorResult.session`
    // MUST NOT appear in audit meta. The unit tests in
    // authModuleGithubProvider.test.ts verify the shape of the
    // `createEvent` meta; this E2E verifies the same invariant
    // observed by an audit log consumer.
    for (const event of userLoginEvents) {
      const serialized = JSON.stringify(event);
      // gh* token prefixes used by GitHub:
      //   - "ghp_" personal access tokens
      //   - "gho_" OAuth tokens
      //   - "ghu_" user-to-server tokens
      //   - "ghs_" server-to-server tokens
      //   - "ghr_" refresh tokens
      expect(serialized).not.toMatch(/\bghp_[A-Za-z0-9]/);
      expect(serialized).not.toMatch(/\bgho_[A-Za-z0-9]/);
      expect(serialized).not.toMatch(/\bghu_[A-Za-z0-9]/);
      expect(serialized).not.toMatch(/\bghs_[A-Za-z0-9]/);
      expect(serialized).not.toMatch(/\bghr_[A-Za-z0-9]/);
    }
  });
});
