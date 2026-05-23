/*
 * Copyright 2021 The Backstage Authors
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

import { signInAsGuest, spaNavigate } from './sessionHelpers';

/**
 * Sets the theme mode on the document root element via the `data-theme-mode`
 * attribute, which is Backstage's convention for light/dark theme switching
 * using CSS custom properties. A brief timeout allows CSS transitions to settle
 * before any subsequent screenshot capture.
 */
async function setThemeMode(page: Page, mode: 'light' | 'dark') {
  await page.evaluate(themeMode => {
    document.documentElement.setAttribute('data-theme-mode', themeMode);
  }, mode);
  // Allow CSS custom property transitions and repaint to complete
  await page.waitForTimeout(300);
}

/**
 * The placeholder rendered by `@backstage/plugin-search-react`'s
 * `<SearchBar>`. The component sources `org` from
 * `configApi.getOptionalString('app.title') || 'Backstage'` (see
 * `plugins/search-react/src/components/SearchBar/SearchBar.tsx:142`)
 * and the i18n template is `'Search in {{org}}'`.
 *
 * `app.title` in `app-config.yaml:2` is `Blitzy Sandbox`, so the
 * placeholder resolves to `Search in Blitzy Sandbox`. Tests use this
 * exact string to target the SearchBar input deterministically.
 */
const SEARCH_BAR_PLACEHOLDER = 'Search in Blitzy Sandbox';

/**
 * Mock payload used to make `/api/search/query?term=*` deterministic for
 * the visual regression and result-rendering assertions. Hoisted so all
 * tests in this file share the same response shape.
 */
const MOCK_SEARCH_RESULTS = [
  {
    type: 'software-catalog',
    document: {
      title: 'backstage',
      text: 'Backstage system documentation',
      location: '/result/location/path',
    },
  },
];

/**
 * Register a deterministic search-API mock on the given page. The mock
 * is installed BEFORE the SPA navigates to `/search`, ensuring the
 * `useSearch` effect inside the SearchPage sees the deterministic
 * payload regardless of backend state.
 */
async function mockSearchAPI(page: Page): Promise<void> {
  await page.route('**/api/search/query?term=*', async route => {
    await route.fulfill({ json: { results: MOCK_SEARCH_RESULTS } });
  });
}

/**
 * Session preservation
 * --------------------
 * Every test below signs in via the shared `signInAsGuest` helper and
 * reaches `/search` via `spaNavigate`. Using `spaNavigate` (HTML5
 * History API + popstate) preserves the React-state-only Guest
 * identity that a `page.goto` would otherwise wipe — see
 * `sessionHelpers.ts` for the full rationale and
 * `blitzy/qa_reports/cp14/final-qa-report.md` Issues 5 and 6 for the
 * QA findings these fixes address.
 */

// ---------------------------------------------------------------------------
// Cross-browser visual regression gate (AAP §0.8.2.5)
//
// Tests whose title begins with `Visual regression:` consume PNG baselines
// captured on chromium. To avoid spurious failures from cross-browser pixel
// drift (font rendering, scrollbar widths, sub-pixel anti-aliasing), these
// tests are skipped on firefox and webkit. The functional tests in this file
// (Command-dialog search pattern, search-results rendering) continue to run
// on all three browsers. See `docs/refactor/decision-log.md` Entry 18.
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

test('the results are rendered as expected', async ({ page }) => {
  // Sign in (lands on /catalog) and arm the search API mock BEFORE
  // SPA-navigating to /search. The mock must be in place before the
  // SearchContextProvider triggers its first fetch.
  await signInAsGuest(page);
  await mockSearchAPI(page);

  // SPA-navigate to /search while preserving the React-state auth
  // identity. The top-bar remains mounted, confirming the route
  // change happened inside the authenticated shell.
  await spaNavigate(page, '/search');
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();

  const searchInput = page.getByPlaceholder(SEARCH_BAR_PLACEHOLDER);
  await expect(searchInput).toBeVisible({ timeout: 10_000 });

  // Type a search query to trigger the mocked response.
  await searchInput.fill('test');
  await expect(page.getByText('Backstage system documentation')).toBeVisible();
});

/**
 * Visual regression screenshot tests for the search page.
 *
 * These tests capture full-page screenshots of the search UI in both light and
 * dark modes, as required by AAP Section 0.8.2 for validating component
 * rendering, layout consistency, and theme correctness after the MUI-to-shadcn
 * migration. Each test uses a deterministic search API mock so that visual
 * output is reproducible across CI runs.
 */

test('Visual regression: Search page - light mode', async ({ page }) => {
  await signInAsGuest(page);
  await mockSearchAPI(page);
  await spaNavigate(page, '/search');
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();
  await expect(page.getByPlaceholder(SEARCH_BAR_PLACEHOLDER)).toBeVisible({
    timeout: 10_000,
  });
  await setThemeMode(page, 'light');
  const screenshot = await page.screenshot({ fullPage: true });
  await expect(screenshot).toMatchSnapshot('search-page-light.png');
});

test('Visual regression: Search page - dark mode', async ({ page }) => {
  await signInAsGuest(page);
  await mockSearchAPI(page);
  await spaNavigate(page, '/search');
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();
  await expect(page.getByPlaceholder(SEARCH_BAR_PLACEHOLDER)).toBeVisible({
    timeout: 10_000,
  });
  await setThemeMode(page, 'dark');
  const screenshot = await page.screenshot({ fullPage: true });
  await expect(screenshot).toMatchSnapshot('search-page-dark.png');
});

test('Visual regression: Search results - light mode', async ({ page }) => {
  await signInAsGuest(page);
  await mockSearchAPI(page);
  await spaNavigate(page, '/search');
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();

  // Strict assertion — the SearchBar MUST be present for the visual
  // regression to be meaningful. We do not silently skip when the
  // input is missing (per QA Checkpoint 14 anti-silent-skip mandate).
  const searchInput = page.getByPlaceholder(SEARCH_BAR_PLACEHOLDER);
  await expect(searchInput).toBeVisible({ timeout: 10_000 });
  await searchInput.fill('test');
  await expect(page.getByText('Backstage system documentation')).toBeVisible();

  await setThemeMode(page, 'light');
  const screenshot = await page.screenshot({ fullPage: true });
  await expect(screenshot).toMatchSnapshot('search-results-light.png');
});

test('Visual regression: Search results - dark mode', async ({ page }) => {
  await signInAsGuest(page);
  await mockSearchAPI(page);
  await spaNavigate(page, '/search');
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();

  const searchInput = page.getByPlaceholder(SEARCH_BAR_PLACEHOLDER);
  await expect(searchInput).toBeVisible({ timeout: 10_000 });
  await searchInput.fill('test');
  await expect(page.getByText('Backstage system documentation')).toBeVisible();

  await setThemeMode(page, 'dark');
  const screenshot = await page.screenshot({ fullPage: true });
  await expect(screenshot).toMatchSnapshot('search-results-dark.png');
});

/**
 * Verifies that the search page renders with a recognizable search UI element.
 * Per AAP §0.5.1.2 the global `/docs` index page is removed; the `/search`
 * route still mounts the search plugin's page extension. This test asserts
 * the new SearchBar is present (rather than silently skipping when the
 * legacy placeholder is missing, as the prior implementation did).
 */
test('Search page renders with a SearchBar', async ({ page }) => {
  await signInAsGuest(page);
  await spaNavigate(page, '/search');
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();

  // The SearchBar input must be present and visible. We assert
  // strictly (no silent skip) so any regression that removes the
  // SearchBar surfaces is caught.
  await expect(page.getByPlaceholder(SEARCH_BAR_PLACEHOLDER)).toBeVisible({
    timeout: 10_000,
  });
});
