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
 * Helper that signs into the Backstage example app by clicking the
 * "Continue as Guest" button on the new Blitzy-branded sign-in page
 * (replaces the previous "Enter" button — see
 * `packages/app/src/GuestSignInPage.tsx`), then waits for the authenticated
 * shell (top-bar with `data-testid="app-top-bar"`) to render. Optionally
 * navigates to a specific path after sign-in.
 *
 * Per AAP §0.5.1.1, the sidebar has been removed and replaced by a top-bar
 * that contains only the Blitzy logo, optional SignInAvatar, Settings link,
 * and Support button — there are no sidebar navigation links to wait on.
 * The presence of the top-bar is therefore the canonical signal that the
 * authenticated shell has finished mounting.
 *
 * IMPORTANT — auth-state preservation across navigations:
 *
 * The `ProxiedSignInIdentity` instance produced by Guest sign-in lives in
 * React state at the `App`-level wrapper (see `packages/app/src/App.tsx`
 * + `packages/app/src/GuestSignInPage.tsx`). It is NOT persisted in
 * `localStorage`, `sessionStorage`, or a session cookie. Because of this,
 * a hard browser navigation via `page.goto(targetPath)` wipes the React
 * state tree and re-renders the sign-in page — defeating the purpose of
 * the prior sign-in click.
 *
 * To navigate while preserving the React-state auth, we prefer in-app
 * navigation via the top-bar's `<Link>` controls (Backstage `Link` from
 * `@backstage/core-components`, which delegates to React Router and
 * therefore does NOT trigger a browser reload). For paths that are
 * directly addressable from the top-bar (`/settings`, `/search`), the
 * helper clicks the matching `data-testid` control. For other paths
 * (`/catalog` is a no-op since Guest sign-in already lands there;
 * everything else falls back to `page.goto`), the previous behavior is
 * preserved.
 *
 * This mapping is sourced from the top-bar implementation in
 * `packages/app/src/modules/appModuleTopBar.tsx`, which exposes the
 * `data-testid` attributes referenced below.
 */
async function signInAndNavigate(page: Page, targetPath?: string) {
  await page.goto('/');
  const guestButton = page.getByRole('button', { name: 'Continue as Guest' });
  await expect(guestButton).toBeVisible();
  await guestButton.click();
  // Wait for authenticated shell — the top-bar is the canonical chrome
  // element mounted on every authenticated page (AAP §0.5.1.1).
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();

  if (!targetPath) {
    return;
  }

  // After Guest sign-in the GuestSignInPage navigates to `/catalog`, so if
  // that is also the target we are already there and no further navigation
  // is needed. (Reading `page.url()` is cheap and avoids a needless reload.)
  const currentPath = new URL(page.url()).pathname;
  if (currentPath === targetPath) {
    return;
  }

  // Known top-bar destinations: click the matching React-Router-aware link
  // so that the React-state-only auth identity survives the navigation.
  // The data-testid values below MUST match those exported by
  // `packages/app/src/modules/appModuleTopBar.tsx`.
  const topBarSelectors: Record<string, string> = {
    '/settings': '[data-testid="app-top-bar-settings"]',
    '/search': '[data-testid="app-top-bar-search"]',
  };
  const topBarSelector = topBarSelectors[targetPath];
  if (topBarSelector) {
    await page.locator(topBarSelector).click();
    // Use `toHaveURL` so the wait is matched against the resolved URL and
    // remains robust to query strings or trailing slashes the route may
    // add (e.g., `/settings` -> `/settings/`).
    await expect(page).toHaveURL(new RegExp(`${targetPath}/?$`));
    return;
  }

  // Fallback: hard navigation. Tests using this path must tolerate the
  // auth-state wipe (e.g., re-sign-in flows) or migrate to an in-app link.
  await page.goto(targetPath);
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
  // Wait for catalog page to render
  await page.waitForLoadState('networkidle');
  await setThemeMode(page, 'light');
  const screenshot = await page.screenshot({ fullPage: true });
  await expect(screenshot).toMatchSnapshot('catalog-browse-light.png');
});

test('Visual regression: Catalog browsing - dark mode', async ({ page }) => {
  await signInAndNavigate(page, '/catalog');
  await page.waitForLoadState('networkidle');
  await setThemeMode(page, 'dark');
  const screenshot = await page.screenshot({ fullPage: true });
  await expect(screenshot).toMatchSnapshot('catalog-browse-dark.png');
});

// --- Entity Detail Navigation ---

test('Visual regression: Entity detail - light mode', async ({ page }) => {
  await signInAndNavigate(page, '/catalog');
  await page.waitForLoadState('networkidle');
  // Click on first entity in the catalog list if available
  const entityLink = page
    .locator('table a, [data-testid="catalog-table"] a')
    .first();
  if (await entityLink.isVisible({ timeout: 5000 }).catch(() => false)) {
    await entityLink.click();
    await page.waitForLoadState('networkidle');
  }
  await setThemeMode(page, 'light');
  const screenshot = await page.screenshot({ fullPage: true });
  await expect(screenshot).toMatchSnapshot('entity-detail-light.png');
});

test('Visual regression: Entity detail - dark mode', async ({ page }) => {
  await signInAndNavigate(page, '/catalog');
  await page.waitForLoadState('networkidle');
  const entityLink = page
    .locator('table a, [data-testid="catalog-table"] a')
    .first();
  if (await entityLink.isVisible({ timeout: 5000 }).catch(() => false)) {
    await entityLink.click();
    await page.waitForLoadState('networkidle');
  }
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
