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

import { expect, Page } from '@playwright/test';

/**
 * Shared Playwright session and SPA-navigation helpers for the Backstage
 * `packages/app` E2E suite.
 *
 * Why this module exists
 * ----------------------
 * Guest sign-in produces a `ProxiedSignInIdentity` instance that lives
 * exclusively in React state (`useState` at the SignInPage extension
 * level — see `packages/app/src/GuestSignInPage.tsx` and
 * `plugins/user-settings/src/ProxiedSignInIdentity.ts`). The identity is
 * NOT persisted in `localStorage`, `sessionStorage`, or any session
 * cookie that the browser can replay on reload.
 *
 * Consequently, any call to `page.goto(...)` after sign-in triggers a
 * full browser navigation that wipes the React tree, drops the
 * identity, and re-renders the sign-in page. Tests that follow
 * `signInAsGuest` with a `page.goto` therefore silently land back on
 * the sign-in page instead of the route they intended to exercise.
 *
 * This silently corrupts assertions that check for the *absence* of UI
 * elements (e.g., "no Owner column") — the absence is trivially true
 * on the sign-in page, so the test reports green without actually
 * verifying the post-refactor catalog rendering. The QA Checkpoint 14
 * report (`blitzy/qa_reports/cp14/final-qa-report.md`) flagged this as
 * a MAJOR test-infrastructure defect across nine refactor.test.ts
 * scenarios and six HomePage.test.ts / five SearchPage.test.ts cases.
 *
 * The fix is SPA navigation: rather than `page.goto`, use either an
 * in-app link (which the Backstage `Link` component delegates to React
 * Router and therefore does NOT reload) or, for arbitrary paths
 * without a top-bar affordance, the HTML5 History API combined with a
 * synthesised `popstate` event. React Router v6 / @remix-run/router
 * installs a `popstate` listener on `window` (see
 * `node_modules/@remix-run/router/dist/router.js` line 438), so
 * dispatching `popstate` after `history.pushState` causes the router
 * to read the updated `window.location` and re-render for the new
 * route — all without reloading the page and therefore without
 * dropping the in-memory auth identity.
 *
 * Helper inventory
 * ----------------
 *   • {@link signInAsGuest} — Click "Continue as Guest" on the sign-in
 *     page and wait for the authenticated top-bar to mount. After
 *     return, the page is on `/catalog` (the
 *     {@link GuestSignInPage}'s `onSignInSuccess` handler invokes
 *     `navigate('/catalog')`).
 *
 *   • {@link signInAndNavigateToPath} — Sign in as Guest and then
 *     navigate to a target path while preserving the React state-only
 *     identity. The implementation chooses the most realistic strategy
 *     available for the target: short-circuit when already on the
 *     target, click an in-app top-bar control when one exists, or fall
 *     back to {@link spaNavigate} for arbitrary paths.
 *
 *   • {@link spaNavigate} — Low-level primitive that pushes a new
 *     history entry without reloading. Useful for routes that have no
 *     in-app affordance (e.g. `/home`, `/search`, deep entity URLs).
 *
 *   • {@link waitForSeedCatalogRows} — Wait for the deterministic
 *     `blitzy-e2e-` seed entities (declared in
 *     `packages/app/e2e-tests/fixtures/e2e-seed-catalog.yaml` and
 *     loaded by the example-backend via the `type: file` location at
 *     `app-config.yaml` lines 267–268) to appear in the catalog table.
 *
 * AAP traceability
 * ----------------
 * Resolves Issues 1, 4, and 5 from
 * `blitzy/qa_reports/cp14/final-qa-report.md` (E2E test design bug —
 * `signInAsGuest` + `page.goto` session wipe). Aligns with the working
 * `signInAndNavigate` pattern previously established in
 * `packages/app/e2e-tests/app.test.ts` and extends it with a general
 * SPA-navigation primitive so that tests requesting arbitrary paths
 * (e.g. `/home`, `/catalog/default/component/blitzy-e2e-component-a`)
 * are reachable without auth wipes.
 */

/**
 * Sign in as a Guest via the canonical "Continue as Guest" affordance
 * on the sign-in page.
 *
 * Lifecycle:
 *   1. Hard-navigate to `/` (this is allowed because no React state
 *      exists yet — the test is presumed to be at the start of a
 *      session).
 *   2. Click "Continue as Guest" — this dispatches the React-state
 *      identity and then calls `navigate('/catalog')` via React
 *      Router, putting the page on `/catalog` after a single SPA
 *      transition.
 *   3. Wait for the authenticated top-bar (`[data-testid="app-top-bar"]`)
 *      so the helper returns only after the auth-gated chrome has
 *      mounted.
 *
 * Post-condition: `page.url()` resolves to `/catalog` (or a trailing
 * variant). The in-memory identity is intact and any subsequent
 * navigation MUST avoid `page.goto` to preserve it — use
 * {@link signInAndNavigateToPath} or {@link spaNavigate} instead.
 */
export async function signInAsGuest(page: Page): Promise<void> {
  await page.goto('/');
  const guestButton = page.getByRole('button', { name: 'Continue as Guest' });
  await expect(guestButton).toBeVisible();
  await guestButton.click();
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();
}

/**
 * Navigate the SPA to an arbitrary path WITHOUT triggering a browser
 * reload.
 *
 * Mechanism:
 *   • `window.history.pushState({}, '', path)` updates the address
 *     bar and the browser's session history stack but does NOT cause
 *     a reload.
 *   • `window.dispatchEvent(new PopStateEvent('popstate'))` fires the
 *     event that `@remix-run/router` is listening for. The router's
 *     `handlePop` callback then reads the updated `window.location`,
 *     constructs a new `Location` object, and re-renders the route
 *     tree for the new path. See:
 *       node_modules/@remix-run/router/dist/router.js
 *         line 438: window.addEventListener(PopStateEventType, handlePop)
 *         line 354: function handlePop() { … listener({ action, location, delta }) }
 *
 * After dispatching, this helper asserts that the URL matches the
 * requested path using `toHaveURL`, which polls the page until the
 * resolved URL matches the regex (robust to trailing slashes and
 * router-applied query strings).
 *
 * Caveats:
 *   • React Router emits a console `warning` when `delta == null`
 *     AND there is at least one Blocker registered. The application
 *     does not register blockers, so the warning never fires in
 *     practice. This is the same trade-off accepted by every test
 *     framework that uses pushState for SPA navigation.
 *   • The router treats the resulting transition as a `Pop` action
 *     (back/forward), not a `Push`. For navigation tests this is
 *     equivalent: the destination renders identically. If a test ever
 *     needs to assert on the action type, it should use a real
 *     in-app `Link` click instead.
 */
export async function spaNavigate(
  page: Page,
  path: string,
  options?: {
    /**
     * Optional URL pattern to assert against after the navigation
     * settles. When provided, this overrides the default
     * `escapedPath/?(?:[?#].*)?$` regex — required for navigations
     * that intentionally trigger a redirect (e.g. SPA-navigating to
     * `/` to exercise the `rootRedirectModule`, which rewrites the
     * URL to `/catalog`). When omitted, the helper asserts the URL
     * matches the requested path (with optional query/hash suffix).
     *
     * Pass `false` to skip the URL assertion entirely — useful for
     * callers that want to perform their own custom URL verification
     * immediately after the SPA dispatch.
     */
    expectUrl?: RegExp | false;
  },
): Promise<void> {
  if (!path.startsWith('/')) {
    throw new Error(
      `spaNavigate requires an absolute path; received: ${JSON.stringify(
        path,
      )}`,
    );
  }

  // Push the history entry and notify React Router via popstate. The
  // closure receives `path` as the single string argument so the
  // page-side script does not need any other context.
  await page.evaluate(targetPath => {
    window.history.pushState({}, '', targetPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);

  // Determine which URL pattern to wait for:
  //   • explicit `expectUrl: false`  → no assertion (caller will verify)
  //   • explicit `expectUrl: RegExp` → use the caller's pattern (e.g.
  //     redirect targets like /catalog when navigating to /)
  //   • omitted                      → default to the requested path
  //     with optional trailing slash and optional query/hash suffix
  //     (catalog filter state etc.)
  if (options?.expectUrl === false) {
    return;
  }
  let expectedPattern: RegExp;
  if (options?.expectUrl instanceof RegExp) {
    expectedPattern = options.expectUrl;
  } else {
    const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expectedPattern = new RegExp(`${escapedPath}/?(?:[?#].*)?$`);
  }
  await expect(page).toHaveURL(expectedPattern, {
    // Generous timeout to allow lazy-loaded route bundles to mount.
    timeout: 15_000,
  });
}

/**
 * `data-testid` selectors for the top-bar affordances that resolve to
 * a known SPA route. The mapping mirrors `appModuleTopBar.tsx`:
 *
 *   • app-top-bar-settings → `<Link to="/settings">` — verified
 *     React-Router-aware navigation.
 *
 * Other top-bar elements (logo, support, avatar) either do not
 * navigate, are non-interactive, or open popovers and are NOT included
 * here. Search has no top-bar affordance (the legacy sidebar search
 * was removed by this refactor — see AAP §0.5.1.1).
 */
const TOP_BAR_NAV_SELECTORS: Readonly<Record<string, string>> = Object.freeze({
  '/settings': '[data-testid="app-top-bar-settings"]',
});

/**
 * Sign in as a Guest and then navigate to `targetPath` using the
 * highest-fidelity strategy available, preserving the in-memory auth
 * identity throughout.
 *
 * Strategy resolution (in order):
 *   1. Sign in via {@link signInAsGuest} (this lands on `/catalog`).
 *   2. If `targetPath` is omitted or already matches the current URL,
 *      return immediately.
 *   3. If `targetPath` has a registered top-bar `data-testid`, click
 *      that control — Backstage's `Link` component delegates to React
 *      Router and therefore does not reload. This is the most
 *      realistic strategy because it mirrors how an end-user would
 *      navigate.
 *   4. Otherwise, fall back to {@link spaNavigate} to push the path
 *      via the History API.
 *
 * Use this helper for every test that previously combined
 * `signInAsGuest(page)` with a follow-up `page.goto(targetPath)` so
 * that the auth state is preserved across the navigation.
 */
export async function signInAndNavigateToPath(
  page: Page,
  targetPath?: string,
): Promise<void> {
  await signInAsGuest(page);

  if (!targetPath) {
    return;
  }

  // Normalise both sides so `/catalog` and `/catalog/` compare equal.
  const normalize = (p: string) => {
    const onlyPath = p.split(/[?#]/, 1)[0];
    if (onlyPath === '/') return '/';
    return onlyPath.replace(/\/$/, '');
  };
  const currentPath = normalize(new URL(page.url()).pathname);
  const requestedPath = normalize(targetPath);
  if (currentPath === requestedPath) {
    return;
  }

  const topBarSelector = TOP_BAR_NAV_SELECTORS[requestedPath];
  if (topBarSelector) {
    await page.locator(topBarSelector).click();
    const escaped = targetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await expect(page).toHaveURL(new RegExp(`${escaped}/?(?:[?#].*)?$`), {
      timeout: 15_000,
    });
    return;
  }

  await spaNavigate(page, targetPath);
}

/**
 * The deterministic catalog entities seeded into the example-backend
 * via `packages/app/e2e-tests/fixtures/e2e-seed-catalog.yaml`. Tests
 * that require these entities should call {@link waitForSeedCatalogRows}
 * to fail-fast with a clear remediation message if the catalog has
 * not loaded the fixture (rather than silently skipping).
 */
export const SEED_CATALOG_COMPONENTS: ReadonlyArray<string> = Object.freeze([
  'blitzy-e2e-component-a',
  'blitzy-e2e-component-b',
  'blitzy-e2e-component-c',
]);

/**
 * Block until each `blitzy-e2e-*` seed entity is visible somewhere on
 * the page. Used by tests that need at least one seed row to exercise
 * the assertion (e.g., View-button removal, library-type-chip border,
 * catalog count AND semantics).
 *
 * Fails the test with a descriptive message if the fixture is not
 * loaded within the timeout — see the file-level docstring in
 * `refactor.test.ts` for remediation steps.
 */
export async function waitForSeedCatalogRows(
  page: Page,
  options: { timeout?: number } = {},
): Promise<void> {
  const { timeout = 30_000 } = options;
  for (const name of SEED_CATALOG_COMPONENTS) {
    await expect(
      page.locator(`a[href*="/catalog/default/component/${name}"]`).first(),
      `Seed catalog fixture entity "${name}" is not visible. Verify ` +
        `app-config.yaml loads packages/app/e2e-tests/fixtures/` +
        `e2e-seed-catalog.yaml via a "type: file" catalog location ` +
        `and that the example-backend has finished refreshing.`,
    ).toBeVisible({ timeout });
  }
}
