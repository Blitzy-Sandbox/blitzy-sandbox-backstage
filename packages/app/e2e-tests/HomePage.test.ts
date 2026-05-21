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

/**
 * Sets the theme mode on the document root element via the `data-theme-mode`
 * attribute, which is Backstage's existing data-attribute convention for
 * light/dark theme switching using CSS custom properties.
 */
async function setThemeMode(page: Page, mode: 'light' | 'dark') {
  await page.evaluate(themeMode => {
    document.documentElement.setAttribute('data-theme-mode', themeMode);
  }, mode);
  // Allow time for CSS custom property transitions to settle
  await page.waitForTimeout(300);
}

/**
 * Per AAP §0.5.1.4 (Workstream D), the previous Dashboard / `/home` landing
 * is removed and the bare `/` URL now redirects to `/catalog`. This test
 * suite validates that the "home" (landing) user experience is the catalog
 * page and that the redirect behaves correctly in light and dark themes.
 *
 * Mirrors the User-Provided Critical Test Scenario in AAP §0.5.5:
 *   "Landing Page: Verify the application lands on the Catalog view and the
 *    Dashboard page is fully removed."
 */

test('Landing redirect: bare `/` resolves to `/catalog` after sign-in', async ({
  page,
}) => {
  // Navigate to the bare landing URL and sign in as Guest.
  await page.goto('/');
  const guestButton = page.getByRole('button', { name: 'Continue as Guest' });
  await expect(guestButton).toBeVisible();
  await guestButton.click();

  // After sign-in, the application lands on the catalog page (AAP §0.5.5).
  // The router emits a client-side replace from `/` to `/catalog`; wait for
  // the URL to settle before asserting.
  await expect(page).toHaveURL(/\/catalog\/?$/);

  // The top-bar (replacing the deleted sidebar) is the canonical chrome
  // signal that the authenticated shell has rendered.
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();
});

test('Dashboard page is fully removed: navigating to `/home` does not surface a Home page', async ({
  page,
}) => {
  // Sign in first so we have an authenticated session and the application
  // shell renders the same chrome as on any other route.
  await page.goto('/');
  const guestButton = page.getByRole('button', { name: 'Continue as Guest' });
  await expect(guestButton).toBeVisible();
  await guestButton.click();
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();

  // Attempt to navigate to the legacy dashboard route.
  await page.goto('/home');
  await page.waitForLoadState('networkidle');

  // The dashboard component (BlitzySandboxWelcome) has been deleted. There
  // is no `Home` navigation link in the new top-bar chrome, no welcome
  // headline copy, and no quick-link grid identifying the page as the
  // dashboard.
  await expect(
    page.getByRole('link', { name: 'Home', exact: true }),
  ).toHaveCount(0);

  // The top-bar continues to render even on an unrecognized route — the
  // user's chrome is consistent regardless of where they land.
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();
});

test('Should not throw `ResizeObserver loop completed with undelivered notifications`', async ({
  page,
}) => {
  // Regression smoke from the previous HomePage test suite: navigating
  // between routes after sign-in must not trip the webpack-dev-server
  // overlay with a ResizeObserver warning. The route under test is now
  // the new landing (`/catalog` via redirect from `/`) instead of the
  // deleted `/home` dashboard.
  await page.goto('/');
  const guestButton = page.getByRole('button', { name: 'Continue as Guest' });
  await expect(guestButton).toBeVisible();
  await guestButton.click();
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();
  // Force a route change to exercise the ResizeObserver tear-down path.
  await page.goto('/catalog');
  await expect(
    page
      .frameLocator('#webpack-dev-server-client-overlay')
      .getByText(
        /ResizeObserver loop completed with undelivered notifications/,
      ),
  ).not.toBeVisible();
});

test('Landing page renders with shadcn/ui styling', async ({ page }) => {
  // The shadcn/ui token system must remain operational on the new catalog
  // landing — `--background` is the foundational design token and must
  // resolve to a non-empty value once the page has mounted.
  await page.goto('/');
  const guestButton = page.getByRole('button', { name: 'Continue as Guest' });
  await expect(guestButton).toBeVisible();
  await guestButton.click();
  await expect(page).toHaveURL(/\/catalog\/?$/);
  await page.waitForLoadState('networkidle');

  // Verify CSS custom properties are applied (shadcn/ui token system).
  const hasTokens = await page.evaluate(() => {
    const style = window.getComputedStyle(document.documentElement);
    return style.getPropertyValue('--background').trim().length > 0;
  });
  expect(hasTokens).toBeTruthy();
});

test('Landing page theme correctness: `--background` populated in light mode', async ({
  page,
}) => {
  await page.goto('/');
  const guestButton = page.getByRole('button', { name: 'Continue as Guest' });
  await expect(guestButton).toBeVisible();
  await guestButton.click();
  await expect(page).toHaveURL(/\/catalog\/?$/);
  await setThemeMode(page, 'light');
  const bgColor = await page.evaluate(() => {
    return window
      .getComputedStyle(document.documentElement)
      .getPropertyValue('--background')
      .trim();
  });
  expect(bgColor).toBeTruthy();
});

test('Landing page theme correctness: `--background` populated in dark mode', async ({
  page,
}) => {
  await page.goto('/');
  const guestButton = page.getByRole('button', { name: 'Continue as Guest' });
  await expect(guestButton).toBeVisible();
  await guestButton.click();
  await expect(page).toHaveURL(/\/catalog\/?$/);
  await setThemeMode(page, 'dark');
  const bgColor = await page.evaluate(() => {
    return window
      .getComputedStyle(document.documentElement)
      .getPropertyValue('--background')
      .trim();
  });
  expect(bgColor).toBeTruthy();
});
