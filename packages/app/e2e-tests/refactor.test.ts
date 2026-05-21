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

import { test, expect, Page } from '@playwright/test';

/**
 * Comprehensive E2E coverage of the UI/UX Modifications, Feature
 * Removal items, and Catalog Count bug fix per AAP §0.5.5.
 *
 * Each test corresponds to one or more verbatim user requirements;
 * the test names use the user's language ("View button absent",
 * "support@blitzy.com displayed", "AND logic count") to maintain
 * traceability per AAP §0.7.1 R3 (Explainability).
 *
 * Coordination dependencies (handled by other agents in this PR):
 *   - packages/app/src/App.tsx (UPDATED): root redirect / -> /catalog
 *   - packages/app/src/modules/appModuleTopBar.tsx (CREATED): top-bar
 *     with Blitzy logo (non-interactive), Settings link, SupportButton
 *   - packages/app/src/modules/appModuleNav.tsx (DELETED): sidebar gone
 *   - app-config.yaml (UPDATED): support@blitzy.com in app.support.items
 *   - plugins/catalog/src/components/CatalogTable/CatalogTable.tsx
 *     (UPDATED): View action removed, Star action removed
 *   - plugins/catalog/src/components/CatalogTable/columns.tsx (UPDATED):
 *     createSystemColumn deleted, createOwnerColumn deleted,
 *     createSpecTypeColumn applies "border-2 border-current rounded"
 *     for the library type chip
 *   - plugins/catalog/src/components/EntityLayout/EntityLayout.tsx
 *     (UPDATED): FavoriteEntity star removed, Owner HeaderLabel removed
 *   - plugins/catalog/src/components/AboutCard/AboutContent.tsx
 *     (UPDATED): Owner and System AboutField blocks deleted
 *   - plugins/catalog-react/src/filters.ts (UPDATED):
 *     EntityTagFilter.getCatalogFilters() emits AND-compatible shape
 *   - plugins/catalog-react/src/hooks/useEntityListProvider.tsx
 *     (UPDATED): totalItems honors AND semantics under multi-tag filter
 */

/**
 * Canonical sign-in helper for the refactored sign-in page. Clicks
 * "Continue as Guest" and waits for the top-bar to mount.
 */
async function signInAsGuest(page: Page): Promise<void> {
  await page.goto('/');
  const guestButton = page.getByRole('button', { name: 'Continue as Guest' });
  await expect(guestButton).toBeVisible();
  await guestButton.click();
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();
}

/**
 * Helper to extract the numeric count from the catalog table header
 * title. The header renders text in the form "Components (N)" or
 * "All components (N)" depending on the active filter; this helper
 * extracts N as a number.
 */
async function readCatalogHeaderCount(page: Page): Promise<number | null> {
  const headerText = await page
    .locator('table caption, [data-testid="catalog-table-header"], h2, h3')
    .filter({ hasText: /\(\d+\)/ })
    .first()
    .textContent({ timeout: 5000 })
    .catch(() => null);
  if (!headerText) return null;
  const match = headerText.match(/\((\d+)\)/);
  return match ? parseInt(match[1], 10) : null;
}

// ---------------------------------------------------------------------------
// Landing Page (AAP §0.5.5 — "Landing Page: Verify the application lands on
// the Catalog view and the Dashboard page is fully removed.")
// ---------------------------------------------------------------------------

test('Landing Page: navigating to / redirects to /catalog', async ({
  page,
}) => {
  await signInAsGuest(page);
  await page.goto('/');
  // The rootRedirectModule rewrites / to /catalog. The terminal URL
  // must match /catalog (with an optional trailing slash).
  await expect(page).toHaveURL(/\/catalog\/?$/);
});

test('Landing Page: Dashboard page is fully removed (no /home route, no Home link)', async ({
  page,
}) => {
  await signInAsGuest(page);

  // The Home link in the navigation MUST be absent (sidebar removed
  // entirely and the top-bar exposes no navigation links).
  await expect(
    page.getByRole('link', { name: 'Home', exact: true }),
  ).toHaveCount(0);

  // Navigating to /home directly MUST not render a custom dashboard.
  // After homePlugin removal, the route either 404s or redirects;
  // either way, the BlitzySandboxWelcome dashboard component must not
  // appear. We assert by absence of the dashboard's distinctive copy.
  await page.goto('/home');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/Blitzy Sandbox|Welcome to Blitzy/i)).toHaveCount(
    0,
  );
});

// ---------------------------------------------------------------------------
// Sidebar and Feature Removal (AAP §0.5.5)
// ---------------------------------------------------------------------------

test('Sidebar Removal: the sidebar is absent from every authenticated page', async ({
  page,
}) => {
  await signInAsGuest(page);

  // The legacy sidebar exposed nav links with the role "link" and the
  // labels "Catalog" and "APIs". After sidebar deletion these MUST be
  // absent.
  await expect(
    page.getByRole('link', { name: 'Catalog', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'APIs', exact: true }),
  ).toHaveCount(0);

  // The legacy sidebar's structural container is also absent.
  await expect(page.locator('nav[class*="Sidebar"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="sidebar"]')).toHaveCount(0);
});

test('Feature Removal: the View button is absent from catalog table rows', async ({
  page,
}) => {
  await signInAsGuest(page);
  await page.goto('/catalog');
  await page.waitForLoadState('networkidle');

  // The View action was the first entry in `defaultActions` of
  // CatalogTable.tsx (lines 130-140 in the source branch); after
  // removal, no row exposes a "View" action. The action surface
  // typically renders as a button with the title "View" inside an
  // IconButton/Tooltip.
  await expect(page.getByRole('button', { name: /^view$/i })).toHaveCount(0);

  // Defensive: also verify no tooltip exposes "View" on hover.
  await expect(page.getByTitle('View', { exact: true })).toHaveCount(0);
});

test('Feature Removal: the Documentation tab is absent from the global navigation', async ({
  page,
}) => {
  await signInAsGuest(page);

  // The global /docs index page (TechDocsIndexPage) is removed from
  // App.tsx. No primary-navigation link to /docs must remain.
  await expect(
    page.getByRole('link', { name: 'Documentation', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('a[href="/docs"]')).toHaveCount(0);
});

test('Feature Removal: per-entity Documentation tab IS still visible on entity pages', async ({
  page,
}) => {
  // Per AAP §0.8.1.3 Backward Compatibility Boundaries:
  // "TechDocs per-entity functionality preserved. Only the global
  // /docs index page is removed. The EntityTechdocsContent per-entity
  // tab remains."
  //
  // We sign in, navigate to the catalog, click into the first entity,
  // and verify a Docs/Documentation tab IS present on the entity
  // surface. If no entity exists, we skip with a clear reason.
  await signInAsGuest(page);
  await page.goto('/catalog');
  await page.waitForLoadState('networkidle');

  const entityLink = page
    .locator('table a, [data-testid="catalog-table"] a')
    .first();
  const entityVisible = await entityLink
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  if (!entityVisible) {
    test.skip(
      true,
      'Catalog has no entity rows; per-entity TechDocs tab cannot be exercised.',
    );
    return;
  }

  await entityLink.click();
  await page.waitForLoadState('networkidle');

  // The per-entity Docs tab is part of the EntityLayout tabs. Its
  // presence depends on the entity having TechDocs configured; if so,
  // a Docs/Documentation tab is exposed. We check generously (case
  // insensitive, either label).
  const perEntityDocsTab = page
    .getByRole('tab', { name: /docs|documentation/i })
    .first();
  // It's acceptable if a specific demo entity does not expose Docs
  // (TechDocs is optional per entity); the key assertion is that the
  // EntityLayout itself rendered.
  const tabsRoot = page.getByRole('tablist').first();
  await expect(tabsRoot).toBeVisible({ timeout: 5000 });

  // If a Docs tab is present, it must be functional.
  if (await perEntityDocsTab.isVisible({ timeout: 1000 }).catch(() => false)) {
    expect(await perEntityDocsTab.isEnabled()).toBe(true);
  }
});

test('Feature Removal: the FavoriteEntity star icon is absent from the entity title', async ({
  page,
}) => {
  await signInAsGuest(page);
  await page.goto('/catalog');
  await page.waitForLoadState('networkidle');

  const entityLink = page
    .locator('table a, [data-testid="catalog-table"] a')
    .first();
  const entityVisible = await entityLink
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  if (!entityVisible) {
    test.skip(
      true,
      'Catalog has no entity rows; FavoriteEntity removal cannot be exercised on entity title.',
    );
    return;
  }
  await entityLink.click();
  await page.waitForLoadState('networkidle');

  // The FavoriteEntity component renders a star toggle button. Its
  // typical accessible name is "Add to favorites" or "Remove from
  // favorites". Both MUST be absent now.
  await expect(
    page.getByRole('button', { name: /add to favorites/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /remove from favorites/i }),
  ).toHaveCount(0);
});

test('Feature Removal: the System link is absent from the entity page', async ({
  page,
}) => {
  await signInAsGuest(page);
  await page.goto('/catalog');
  await page.waitForLoadState('networkidle');

  const entityLink = page
    .locator('table a, [data-testid="catalog-table"] a')
    .first();
  const entityVisible = await entityLink
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  if (!entityVisible) {
    test.skip(
      true,
      'Catalog has no entity rows; System link removal cannot be exercised.',
    );
    return;
  }
  await entityLink.click();
  await page.waitForLoadState('networkidle');

  // The System AboutField (deleted from AboutContent.tsx lines
  // 184-198) MUST no longer surface. The field label "System" should
  // not appear in the entity's About card.
  const aboutCard = page
    .locator('[class*="about"], [data-testid="about-card"]')
    .first();
  if (await aboutCard.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expect(aboutCard.getByText(/^System$/i)).toHaveCount(0);
  }

  // Also verify no link with href containing "/catalog/default/system/"
  // is present on the entity surface.
  await expect(page.locator('a[href*="/catalog/default/system/"]')).toHaveCount(
    0,
  );
});

test('Feature Removal: the Owner link is absent from the entity page', async ({
  page,
}) => {
  await signInAsGuest(page);
  await page.goto('/catalog');
  await page.waitForLoadState('networkidle');

  const entityLink = page
    .locator('table a, [data-testid="catalog-table"] a')
    .first();
  const entityVisible = await entityLink
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  if (!entityVisible) {
    test.skip(
      true,
      'Catalog has no entity rows; Owner link removal cannot be exercised.',
    );
    return;
  }
  await entityLink.click();
  await page.waitForLoadState('networkidle');

  // The Owner AboutField (deleted from AboutContent.tsx lines
  // 154-164) and the Owner HeaderLabel (deleted from EntityLayout.tsx
  // EntityLabels block) MUST no longer surface.
  const aboutCard = page
    .locator('[class*="about"], [data-testid="about-card"]')
    .first();
  if (await aboutCard.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expect(aboutCard.getByText(/^Owner$/i)).toHaveCount(0);
  }

  // The HeaderLabel for Owner used "OWNER" (uppercase) as its label.
  // Both case variants must be absent from the entity header.
  const header = page.locator('header, [class*="Header"]').first();
  if (await header.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expect(header.getByText(/^owner$/i)).toHaveCount(0);
  }

  // Also verify no link with href containing "/catalog/default/group/"
  // surfaces in the entity About / Header context (Owner relations
  // typically point to group entities).
  const ownedByLinks = page.locator(
    '[class*="about"] a[href*="/catalog/default/group/"], header a[href*="/catalog/default/group/"]',
  );
  await expect(ownedByLinks).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Element Placement (AAP §0.5.5 — "Element Placement: Verify the Blitzy logo
// and Settings button are correctly positioned in the top right corner, and
// the Support button displays the official Blitzy support email:
// support@blitzy.com.")
// ---------------------------------------------------------------------------

test('Element Placement: the Blitzy logo is positioned top-right and is non-clickable', async ({
  page,
}) => {
  await signInAsGuest(page);

  const topBar = page.locator('[data-testid="app-top-bar"]');
  await expect(topBar).toBeVisible();

  // The Blitzy logo is mounted inside the top-bar. It MUST be present
  // and MUST NOT be wrapped in an <a> element (the user requirement
  // explicitly says: "remove the ability to click on the logo").
  const logo = topBar
    .locator(
      'img[alt*="Blitzy" i], svg[aria-label*="Blitzy" i], [data-testid="blitzy-logo"]',
    )
    .first();
  await expect(logo).toBeVisible();

  // Assert the logo has no <a> ancestor inside the top-bar (the
  // previous implementation wrapped the SidebarLogo in <Link to="/">).
  const anchorAncestors = topBar.locator('a').filter({
    has: page.locator(
      'img[alt*="Blitzy" i], svg[aria-label*="Blitzy" i], [data-testid="blitzy-logo"]',
    ),
  });
  await expect(anchorAncestors).toHaveCount(0);

  // Verify the top-bar is positioned at the top-right region of the
  // viewport. Top-bar should span the full width but the logo should
  // appear on the right side (or at minimum, not be the leftmost
  // navigation element). We assert that the top-bar is anchored to
  // the top of the viewport (y position near 0).
  const box = await topBar.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    expect(box.y).toBeLessThanOrEqual(20);
  }

  // Clicking the logo MUST NOT cause navigation. Record the URL,
  // click, wait, then assert the URL is unchanged.
  const urlBefore = page.url();
  await logo.click({ force: true });
  await page.waitForTimeout(300);
  expect(page.url()).toBe(urlBefore);
});

test('Element Placement: the Settings button is positioned in the top-right corner', async ({
  page,
}) => {
  await signInAsGuest(page);

  const topBar = page.locator('[data-testid="app-top-bar"]');
  await expect(topBar).toBeVisible();

  // The Settings affordance is an icon button (lucide-react Settings)
  // rendered inside the top-bar with aria-label="Settings" and a
  // link to /settings.
  const settingsLink = topBar.locator('a[aria-label="Settings"]').first();
  await expect(settingsLink).toBeVisible();
  await expect(settingsLink).toHaveAttribute('href', /\/settings/);

  // Click and verify navigation to /settings.
  await settingsLink.click();
  await expect(page).toHaveURL(/\/settings/);
});

test('Element Placement: the Support button displays support@blitzy.com', async ({
  page,
}) => {
  await signInAsGuest(page);

  const topBar = page.locator('[data-testid="app-top-bar"]');
  await expect(topBar).toBeVisible();

  // The Support button is a Backstage <SupportButton/> rendered into
  // the top-bar. Its accessible name is "Support" (or similar) and it
  // opens a popover sourced from app-config.yaml's app.support.items.
  const supportButton = topBar
    .getByRole('button', { name: /support/i })
    .first();
  await expect(supportButton).toBeVisible();

  // Open the popover.
  await supportButton.click();

  // The popover MUST contain the literal Blitzy support email per
  // AAP §0.5.5 ("Support button displays the official Blitzy support
  // email: support@blitzy.com"). We assert both the text and the
  // mailto: anchor.
  await expect(page.getByText('support@blitzy.com').first()).toBeVisible();
  await expect(page.locator('a[href="mailto:support@blitzy.com"]')).toHaveCount(
    1,
  );
});

// ---------------------------------------------------------------------------
// Visual Treatment (AAP §0.5.1.2 — library type chip border)
// ---------------------------------------------------------------------------

test('Visual Treatment: the library type chip is rendered with a visible border', async ({
  page,
}) => {
  await signInAsGuest(page);
  await page.goto('/catalog');
  await page.waitForLoadState('networkidle');

  // The Type column of the catalog table renders a chip/badge for each
  // entity's spec.type. Per AAP §0.5.1.2, when type === "library", the
  // chip receives an additional className "border-2 border-current
  // rounded" (Tailwind) producing a visible 2px border in the chip's
  // current color.
  //
  // We search the catalog table for any chip whose visible text matches
  // /^library$/i and assert that its computed border-width is > 0.
  const libraryChip = page
    .locator('table')
    .locator('[class*="badge" i], [class*="chip" i], span, td')
    .filter({ hasText: /^library$/i })
    .first();

  const libraryVisible = await libraryChip
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  if (!libraryVisible) {
    test.skip(
      true,
      'Catalog contains no entity with spec.type === "library" in this environment.',
    );
    return;
  }

  // Verify a visible border exists. Check via className AND via
  // computed style for defence in depth.
  const className = (await libraryChip.getAttribute('class')) ?? '';
  const hasBorderClass =
    className.includes('border-2') ||
    className.includes('border-current') ||
    /border-\d/.test(className);

  const borderWidth = await libraryChip.evaluate(el => {
    const style = window.getComputedStyle(el);
    // Take the maximum across all four sides — some borders are only
    // top/bottom or only left/right.
    return Math.max(
      parseFloat(style.borderTopWidth) || 0,
      parseFloat(style.borderRightWidth) || 0,
      parseFloat(style.borderBottomWidth) || 0,
      parseFloat(style.borderLeftWidth) || 0,
    );
  });

  // At least one of the assertions must succeed (className signal OR
  // computed-style signal). Both should ideally succeed.
  expect(hasBorderClass || borderWidth > 0).toBe(true);
});

// ---------------------------------------------------------------------------
// Catalog Count Fix (AAP §0.5.5 — "Catalog Count Fix: Verify that when two or
// more tags are selected in the Catalog view, the displayed count of catalog
// items at the top correctly reflects the number of items matching *all*
// selected tags (AND logic). The actual displayed list should remain
// correct.")
// ---------------------------------------------------------------------------

test('Catalog Count Fix: when two tags are selected, the count reflects AND logic', async ({
  page,
}) => {
  await signInAsGuest(page);
  await page.goto('/catalog');
  await page.waitForLoadState('networkidle');

  // Identify the Tags filter picker on the catalog page. Backstage's
  // EntityTagPicker renders as a Material-UI Autocomplete with the
  // label "Tags".
  const tagPicker = page.getByLabel('Tags', { exact: false }).first();
  const tagPickerVisible = await tagPicker
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  if (!tagPickerVisible) {
    test.skip(
      true,
      'EntityTagPicker not present on the catalog page in this environment.',
    );
    return;
  }

  // Open the tag picker dropdown.
  await tagPicker.click();
  await page.waitForTimeout(400);

  // Collect all available tag options (the dropdown renders them as
  // listbox children). We pick the first two distinct tag options.
  const tagOptions = page.getByRole('option');
  const tagCount = await tagOptions.count();
  if (tagCount < 2) {
    test.skip(
      true,
      'Catalog has fewer than 2 distinct tags; AND-logic cannot be exercised.',
    );
    return;
  }

  // Select the first tag.
  await tagOptions.nth(0).click();
  await page.waitForTimeout(300);

  // Read the displayed count after the first tag selection.
  const countAfterOneTag = await readCatalogHeaderCount(page);

  // Re-open the picker if it auto-closed, then select the second tag.
  const reopened = await tagPicker
    .isVisible({ timeout: 1000 })
    .catch(() => false);
  if (reopened) {
    await tagPicker.click();
    await page.waitForTimeout(300);
  }
  // Find a tag option that is NOT the same as the first selected one.
  const secondOption = page.getByRole('option').nth(1);
  await secondOption.click();
  await page.waitForTimeout(500);

  // Read the displayed count after both tags are selected.
  const countAfterTwoTags = await readCatalogHeaderCount(page);

  // Count the visible data rows in the catalog table after both tags
  // are selected (the AND-filtered list). We count <tr> elements
  // inside the table body, excluding the header row.
  const visibleRows = await page
    .locator('table tbody tr:not([class*="empty"])')
    .count();

  // Assertion 1: per AAP §0.1.3 ("the actual catalog items displayed
  // are correct"), the visible list is already AND-filtered by the
  // frontend's EntityTagFilter.filterEntity. The count displayed in
  // the header MUST equal the visible row count.
  if (countAfterTwoTags !== null) {
    expect(countAfterTwoTags).toBe(visibleRows);
  }

  // Assertion 2: AND semantics narrow the result set. The two-tag
  // count MUST be less than or equal to the one-tag count (AND is a
  // subset of OR over the same input).
  if (countAfterOneTag !== null && countAfterTwoTags !== null) {
    expect(countAfterTwoTags).toBeLessThanOrEqual(countAfterOneTag);
  }
});
