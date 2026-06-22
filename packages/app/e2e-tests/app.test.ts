/*
 * Copyright 2020 The Backstage Authors
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

import { test, expect, Page } from '@playwright/test';
import { signInAndNavigateToPath } from './sessionHelpers';

/**
 * Sets the theme mode on the document root element via the `data-theme-mode`
 * attribute, which is Backstage's existing data-attribute convention for
 * light/dark theme switching using CSS custom properties. A brief timeout
 * allows CSS transitions and repaint to settle before any subsequent
 * screenshot capture.
 */
async function setThemeMode(page: Page, mode: 'light' | 'dark') {
  await page.evaluate(themeMode => {
    document.documentElement.setAttribute('data-theme-mode', themeMode);
  }, mode);
  // Allow CSS custom property transitions to settle
  await page.waitForTimeout(300);
}

/**
 * Helper that signs into the Backstage example app and optionally navigates
 * to a specific path after sign-in.
 *
 * Implementation is delegated to the shared `signInAndNavigateToPath`
 * helper in `./sessionHelpers`, which encapsulates the auth-state
 * preservation strategy required for tests that navigate after sign-in.
 *
 * Why this delegation exists
 * --------------------------
 * The `ProxiedSignInIdentity` produced by Guest sign-in lives in React
 * state (`useState` at the SignInPage extension level). It is NOT
 * persisted in `localStorage`, `sessionStorage`, or a session cookie.
 * Consequently any `page.goto(targetPath)` after sign-in wipes the React
 * tree and re-renders the sign-in page — silently defeating any assertion
 * that follows.
 *
 * `signInAndNavigateToPath` resolves this by:
 *   1. Signing in via `signInAsGuest` (lands on `/catalog`).
 *   2. If the target is `/catalog` or omitted, returning immediately.
 *   3. If the target has a registered top-bar `data-testid` (`/settings`),
 *      clicking the in-app `<Link>` so React Router navigates without a
 *      browser reload.
 *   4. Otherwise, using `spaNavigate` (`history.pushState` + a
 *      synthesised `popstate` event) to push the path without reloading.
 *
 * The previous local implementation in this file referenced a
 * `data-testid="app-top-bar-search"` element that does NOT exist in the
 * current top-bar (verified against
 * `packages/app/src/modules/appModuleTopBar.tsx`). The legacy sidebar
 * search affordance was removed by the refactor (AAP §0.5.1.1), so
 * `/search` must be reached via `spaNavigate`. The local fallback to
 * `page.goto(targetPath)` also wiped auth for the `/create` scaffolder
 * path, which silently corrupted the regenerated visual baselines by
 * capturing the sign-in page instead of the scaffolder. Using
 * `signInAndNavigateToPath` guarantees the post-sign-in navigation
 * preserves the React-state identity for every target path.
 */
async function signInAndNavigate(page: Page, targetPath?: string) {
  await signInAndNavigateToPath(page, targetPath);
}

// ---------------------------------------------------------------------------
// Cross-browser visual regression gate (AAP §0.8.2.5)
//
// Tests whose title begins with `Visual regression:` consume PNG baselines
// captured on chromium (see `packages/app/e2e-tests/__screenshots__/`). To
// avoid spurious failures from cross-browser pixel drift (font rendering,
// scrollbar widths, sub-pixel anti-aliasing — industry-standard sources of
// cross-browser flake), these tests are skipped on firefox and webkit. The
// functional tests in this file (welcome page, theme correctness, sidebar/
// View-button/Documentation-tab/star-icon removals, top-bar placement, etc.)
// continue to run on all three browsers to satisfy the cross-browser
// functional-coverage mandate. See `docs/refactor/decision-log.md` Entry 18.
// ---------------------------------------------------------------------------
test.beforeEach(async ({ browserName }, testInfo) => {
  test.skip(
    testInfo.title.startsWith('Visual regression:') &&
      browserName !== 'chromium',
    `Visual regression baselines are chromium-only; firefox and webkit run ` +
      `functional assertions only. Re-baselining for additional browsers is ` +
      `tracked in docs/refactor/next-tasks.md.`,
  );
});

// ---------------------------------------------------------------------------
// Smoke test — validates the refactored chrome (top-bar replaces sidebar)
//
// Per AAP §0.5.1.1 (Workstream A — Chrome Refactor):
//  - The sidebar is fully removed (no `Catalog` or `APIs` sidebar links).
//  - The new top-bar mounts the Blitzy logo, Settings link, and Support
//    button in the top-right cluster.
//  - The landing route `/` redirects to `/catalog` (AAP §0.5.1.4).
// ---------------------------------------------------------------------------

test('App should render the welcome page', async ({ page }) => {
  await page.goto('/');

  const guestButton = page.getByRole('button', { name: 'Continue as Guest' });
  await expect(guestButton).toBeVisible();
  await guestButton.click();

  // The top-bar (replacing the deleted sidebar) is the canonical chrome
  // element. It must be visible immediately after sign-in.
  const topBar = page.locator('[data-testid="app-top-bar"]');
  await expect(topBar).toBeVisible();

  // The top-bar must expose the Settings link and Support button per
  // AAP §0.5.1.1; the Blitzy logo is rendered as a non-interactive inline
  // SVG and therefore is not asserted via role-based selectors here
  // (see refactor.test.ts for the non-interactivity assertion).
  await expect(topBar.locator('a[aria-label="Settings"]')).toBeVisible();
  await expect(topBar.getByRole('button', { name: /support/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Visual regression screenshot tests for redesigned user flows.
//
// Per AAP Section 0.8.2, every redesigned user flow is captured
// programmatically via Playwright in both light and dark modes to verify
// component rendering, layout consistency, and theme correctness after the
// MUI-to-shadcn/ui migration AND the Blitzy Sandbox chrome refactor.
//
// The TechDocs global-index visual regression test (techdocs-light.png /
// techdocs-dark.png) has been REMOVED — the global `/docs` route is deleted
// per AAP §0.5.1.2 (the per-entity Documentation tab on entity pages remains
// and is verified in refactor.test.ts).
//
// All visual baselines under `__screenshots__/app.test.ts/` will be
// regenerated by Playwright's `--update-snapshots` flag when the refactored
// chrome lands. The orphaned `techdocs-light.png` and `techdocs-dark.png`
// baselines should be deleted as part of the screenshot regeneration step.
// ---------------------------------------------------------------------------

// --- Catalog Browsing Flow ---

test('Visual regression: Catalog browsing - light mode', async ({ page }) => {
  await signInAndNavigate(page, '/catalog');
  // Wait for catalog page to render. `networkidle` alone is
  // insufficient because the catalog table fetches via SWR/RTK
  // patterns that may resolve after the page-level fetch graph
  // settles — the spinner can still be visible when the snapshot is
  // taken. Wait for the deterministic seed entity to appear so the
  // table has rendered its rows before screenshotting.
  await page.waitForLoadState('networkidle');
  await expect(
    page.getByRole('link', { name: 'blitzy-e2e-component-a' }),
  ).toBeVisible({ timeout: 15_000 });
  await setThemeMode(page, 'light');
  const screenshot = await page.screenshot({ fullPage: true });
  await expect(screenshot).toMatchSnapshot('catalog-browse-light.png');
});

test('Visual regression: Catalog browsing - dark mode', async ({ page }) => {
  await signInAndNavigate(page, '/catalog');
  await page.waitForLoadState('networkidle');
  await expect(
    page.getByRole('link', { name: 'blitzy-e2e-component-a' }),
  ).toBeVisible({ timeout: 15_000 });
  await setThemeMode(page, 'dark');
  const screenshot = await page.screenshot({ fullPage: true });
  await expect(screenshot).toMatchSnapshot('catalog-browse-dark.png');
});

// --- Entity Detail Navigation ---

test('Visual regression: Entity detail - light mode', async ({ page }) => {
  await signInAndNavigate(page, '/catalog');
  await page.waitForLoadState('networkidle');
  // Wait for the deterministic seed entity to render before clicking
  // — the catalog table data sometimes lags after `networkidle`
  // settles. Then click on the seed entity (instead of "first
  // entity") so the entity-detail screenshot is deterministic
  // regardless of catalog sort/filter state.
  const entityLink = page.getByRole('link', {
    name: 'blitzy-e2e-component-a',
  });
  await expect(entityLink).toBeVisible({ timeout: 15_000 });
  await entityLink.click();
  await page.waitForLoadState('networkidle');
  // Wait for the entity title to render so we know the entity page
  // has mounted (rather than catching a transitional loading state).
  await expect(
    page.getByRole('heading', { name: 'blitzy-e2e-component-a' }),
  ).toBeVisible({ timeout: 15_000 });
  await setThemeMode(page, 'light');
  const screenshot = await page.screenshot({ fullPage: true });
  await expect(screenshot).toMatchSnapshot('entity-detail-light.png');
});

test('Visual regression: Entity detail - dark mode', async ({ page }) => {
  await signInAndNavigate(page, '/catalog');
  await page.waitForLoadState('networkidle');
  const entityLink = page.getByRole('link', {
    name: 'blitzy-e2e-component-a',
  });
  await expect(entityLink).toBeVisible({ timeout: 15_000 });
  await entityLink.click();
  await page.waitForLoadState('networkidle');
  await expect(
    page.getByRole('heading', { name: 'blitzy-e2e-component-a' }),
  ).toBeVisible({ timeout: 15_000 });
  await setThemeMode(page, 'dark');
  const screenshot = await page.screenshot({ fullPage: true });
  await expect(screenshot).toMatchSnapshot('entity-detail-dark.png');
});

// --- Scaffolder Template Creation ---

test('Visual regression: Scaffolder - light mode', async ({ page }) => {
  await signInAndNavigate(page, '/create');
  await page.waitForLoadState('networkidle');
  await setThemeMode(page, 'light');
  const screenshot = await page.screenshot({ fullPage: true });
  await expect(screenshot).toMatchSnapshot('scaffolder-light.png');
});

test('Visual regression: Scaffolder - dark mode', async ({ page }) => {
  await signInAndNavigate(page, '/create');
  await page.waitForLoadState('networkidle');
  await setThemeMode(page, 'dark');
  const screenshot = await page.screenshot({ fullPage: true });
  await expect(screenshot).toMatchSnapshot('scaffolder-dark.png');
});

// --- Global Search (Command Dialog) ---

test('Visual regression: Global search - light mode', async ({ page }) => {
  await signInAndNavigate(page, '/search');
  await page.waitForLoadState('networkidle');
  await setThemeMode(page, 'light');
  const screenshot = await page.screenshot({ fullPage: true });
  await expect(screenshot).toMatchSnapshot('search-light.png');
});

test('Visual regression: Global search - dark mode', async ({ page }) => {
  await signInAndNavigate(page, '/search');
  await page.waitForLoadState('networkidle');
  await setThemeMode(page, 'dark');
  const screenshot = await page.screenshot({ fullPage: true });
  await expect(screenshot).toMatchSnapshot('search-dark.png');
});

// --- Settings Management ---

test('Visual regression: Settings - light mode', async ({ page }) => {
  await signInAndNavigate(page, '/settings');
  await page.waitForLoadState('networkidle');
  await setThemeMode(page, 'light');
  const screenshot = await page.screenshot({ fullPage: true });
  await expect(screenshot).toMatchSnapshot('settings-light.png');
});

test('Visual regression: Settings - dark mode', async ({ page }) => {
  await signInAndNavigate(page, '/settings');
  await page.waitForLoadState('networkidle');
  await setThemeMode(page, 'dark');
  const screenshot = await page.screenshot({ fullPage: true });
  await expect(screenshot).toMatchSnapshot('settings-dark.png');
});

// ---------------------------------------------------------------------------
// Theme correctness verification tests
//
// Per AAP Section 0.8.2, verify that the CSS custom property token system is
// correctly applied in both light and dark modes. These tests confirm that the
// `--background` token (the foundational shadcn/ui design token) resolves to a
// non-empty value, indicating proper theme initialization.
// ---------------------------------------------------------------------------

test('Theme correctness: CSS custom properties are applied in light mode', async ({
  page,
}) => {
  await signInAndNavigate(page);
  await setThemeMode(page, 'light');
  const bgColor = await page.evaluate(() => {
    return window
      .getComputedStyle(document.documentElement)
      .getPropertyValue('--background')
      .trim();
  });
  expect(bgColor).toBeTruthy();
});

test('Theme correctness: CSS custom properties are applied in dark mode', async ({
  page,
}) => {
  await signInAndNavigate(page);
  await setThemeMode(page, 'dark');
  const bgColor = await page.evaluate(() => {
    return window
      .getComputedStyle(document.documentElement)
      .getPropertyValue('--background')
      .trim();
  });
  expect(bgColor).toBeTruthy();
});
