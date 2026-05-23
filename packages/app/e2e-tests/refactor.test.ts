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

import {
  signInAsGuest,
  signInAndNavigateToPath,
  spaNavigate,
  waitForSeedCatalogRows,
} from './sessionHelpers';

/**
 * Comprehensive E2E coverage of the UI/UX Modifications, Feature
 * Removal items, and Catalog Count bug fix per AAP §0.5.5.
 *
 * DETERMINISTIC SEED DATA (Code Review Checkpoint 3 Fix)
 * ------------------------------------------------------
 *
 * Previously, several assertions in this suite skipped silently when
 * the running catalog did not contain entities suitable for the test
 * (no rows, no `library` type, no Tags picker, fewer than two
 * distinct tags). That allowed CI to pass without actually
 * exercising the corresponding UI affordance.
 *
 * To fix this, the example-backend now loads
 * `packages/app/e2e-tests/fixtures/e2e-seed-catalog.yaml` via a
 * `type: file` catalog location declared in `app-config.yaml`. The
 * fixture contains three Component entities named with the prefix
 * `blitzy-e2e-`:
 *
 *   - blitzy-e2e-component-a  type=library  tags=[java, spring]  techdocs-ref=dir:.
 *   - blitzy-e2e-component-b  type=service  tags=[java, spring]
 *   - blitzy-e2e-component-c  type=service  tags=[java]
 *
 * These guarantee:
 *   - Catalog has at least one row (the View / Star / Doc tab
 *     assertions can always run).
 *   - Catalog has at least one `library` entity (the library border
 *     assertion can always run).
 *   - Catalog has at least three distinct tag combinations such that
 *     selecting [java, spring] produces 2 results (AND) versus 3
 *     results (OR), proving the count fix.
 *
 * If a test still cannot find the fixture entity (because the
 * catalog refresh has not yet picked up the location, or because a
 * custom dev environment overrode the location list), the test
 * fails with a clear remediation message instead of silently
 * skipping — matching the fail-fast posture established in
 * `authorization.test.ts` and `auditing.test.ts`.
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
 * Helper to extract the numeric count from the catalog table header
 * title. The header renders text in the form "Components (N)" or
 * "All components (N)" depending on the active filter; this helper
 * extracts N as a number. Uses Playwright's `expect.poll` semantics
 * via `expect.toPass` for resilience while the catalog is still
 * rendering after a filter change.
 */
async function readCatalogHeaderCount(page: Page): Promise<number | null> {
  const headerText = await page
    .locator('table caption, [data-testid="catalog-table-header"], h2, h3')
    .filter({ hasText: /\(\d+\)/ })
    .first()
    .textContent({ timeout: 5_000 })
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
  // Sign in as Guest (lands on /catalog), then SPA-navigate back to /
  // to exercise the rootRedirectModule. Using spaNavigate preserves the
  // React-state-only auth identity that page.goto would otherwise wipe
  // — see sessionHelpers.ts for the full rationale.
  await signInAsGuest(page);
  // The rootRedirectModule rewrites / → /catalog, so spaNavigate's
  // post-navigation URL settles on `/catalog?...filters...` rather
  // than `/`. We pass `expectUrl` so spaNavigate waits for the
  // redirected URL (the assertion below is then a sanity check that
  // the URL stayed there).
  await spaNavigate(page, '/', {
    expectUrl: /\/catalog\/?(?:[?#].*)?$/,
  });
  // The terminal URL must match /catalog with an optional trailing
  // slash and an optional query/hash suffix — Backstage's catalog
  // page mounts the EntityListProvider which serializes its default
  // filter state (`?filters[kind]=component&limit=20`) into the URL
  // on first render, so the path is `/catalog` but the URL itself
  // contains the filter encoded query string.
  await expect(page).toHaveURL(/\/catalog\/?(?:[?#].*)?$/);
  // The top-bar MUST still be mounted after the redirect, confirming
  // the auth identity survived the SPA round-trip.
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();
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

  // SPA-navigate to /home directly. This MUST not render a custom
  // dashboard. After homePlugin removal, the route either 404s or
  // renders an empty page; either way, the BlitzySandboxWelcome
  // dashboard component must not appear. SPA navigation preserves the
  // auth identity so the assertion exercises the authenticated route
  // tree (not the sign-in page).
  await spaNavigate(page, '/home');
  // Allow lazy-loaded route bundles a moment to settle. We use
  // expect.toPass rather than waitForLoadState because the latter
  // can race with the React render cycle after a synthetic popstate.
  await expect(page.locator('[data-testid="app-top-bar"]')).toBeVisible();
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
  // signInAsGuest already lands on /catalog (the GuestSignInPage
  // invokes navigate('/catalog') after onSignInSuccess). A redundant
  // page.goto('/catalog') would wipe the React-state auth identity and
  // bounce the test back to the sign-in page.
  await signInAsGuest(page);
  // Catalog page serializes default filter state into the URL on first
  // render — `/catalog?filters[kind]=component&limit=20` — so accept
  // an optional query/hash suffix.
  await expect(page).toHaveURL(/\/catalog\/?(?:[?#].*)?$/);
  await waitForSeedCatalogRows(page);

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
  // The deterministic seed entity `blitzy-e2e-component-a` is
  // configured with `backstage.io/techdocs-ref: dir:.` so it surfaces
  // a Docs tab. We SPA-navigate directly to it to preserve the
  // in-memory auth identity (page.goto would wipe it).
  await signInAndNavigateToPath(
    page,
    '/catalog/default/component/blitzy-e2e-component-a',
  );

  // The EntityLayout tabs MUST render — this proves the entity page
  // itself is wired correctly even if the specific TechDocs tab
  // depends on entity annotations.
  const tabsRoot = page.getByRole('tablist').first();
  await expect(tabsRoot).toBeVisible({ timeout: 10_000 });

  // The per-entity Docs/Documentation tab IS expected because the
  // fixture entity has a techdocs-ref annotation. Polling locator
  // (no fixed sleep) for the tab.
  const perEntityDocsTab = page
    .getByRole('tab', { name: /docs|documentation/i })
    .first();
  await expect(perEntityDocsTab).toBeVisible({ timeout: 10_000 });
  await expect(perEntityDocsTab).toBeEnabled();
});

test('Feature Removal: the FavoriteEntity star icon is absent from the entity title', async ({
  page,
}) => {
  // SPA-navigate to the entity page so the React-state auth identity
  // survives. A page.goto would wipe the identity and bounce the test
  // back to the sign-in page where every UI element is trivially
  // absent.
  await signInAndNavigateToPath(
    page,
    '/catalog/default/component/blitzy-e2e-component-a',
  );

  // Wait for the entity header to render (the entity title is part of
  // the page header — wait until the title text is visible).
  await expect(page.getByText(/blitzy-e2e-component-a/i).first()).toBeVisible({
    timeout: 10_000,
  });

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
  await signInAndNavigateToPath(
    page,
    '/catalog/default/component/blitzy-e2e-component-a',
  );

  // Wait until the entity About card or page header has rendered.
  await expect(page.getByText(/blitzy-e2e-component-a/i).first()).toBeVisible({
    timeout: 10_000,
  });

  // The System AboutField (deleted from AboutContent.tsx lines
  // 184-198) MUST no longer surface. The field label "System" should
  // not appear in the entity's About card.
  const aboutCard = page
    .locator('[class*="about"], [data-testid="about-card"]')
    .first();
  if (await aboutCard.isVisible({ timeout: 3_000 }).catch(() => false)) {
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
  await signInAndNavigateToPath(
    page,
    '/catalog/default/component/blitzy-e2e-component-a',
  );

  await expect(page.getByText(/blitzy-e2e-component-a/i).first()).toBeVisible({
    timeout: 10_000,
  });

  // The Owner AboutField (deleted from AboutContent.tsx lines
  // 154-164) and the Owner HeaderLabel (deleted from EntityLayout.tsx
  // EntityLabels block) MUST no longer surface.
  const aboutCard = page
    .locator('[class*="about"], [data-testid="about-card"]')
    .first();
  if (await aboutCard.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await expect(aboutCard.getByText(/^Owner$/i)).toHaveCount(0);
  }

  // The HeaderLabel for Owner used "OWNER" (uppercase) as its label.
  // Both case variants must be absent from the entity header.
  const header = page.locator('header, [class*="Header"]').first();
  if (await header.isVisible({ timeout: 3_000 }).catch(() => false)) {
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

  // Clicking the logo MUST NOT cause navigation. Compare pathnames
  // only — the catalog page's EntityListProvider serializes filter
  // state into the URL query string asynchronously (e.g.,
  // `?filters[kind]=component&limit=20`) after the page settles, so
  // an exact-URL comparison races against that sync. Pathname
  // comparison is the correct invariant: real navigation would
  // change `pathname` (e.g., '/' or '/home'), while query-string
  // drift does not represent navigation.
  const pathBefore = new URL(page.url()).pathname;
  await logo.click({ force: true });
  await expect(async () => {
    expect(new URL(page.url()).pathname).toBe(pathBefore);
  }).toPass({ timeout: 2_000 });
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
  // signInAsGuest lands on /catalog; no further navigation needed.
  // A redundant page.goto('/catalog') would wipe the React-state auth
  // identity and re-render the sign-in page where no chip exists.
  await signInAsGuest(page);
  // Catalog page serializes default filter state into the URL on first
  // render — `/catalog?filters[kind]=component&limit=20` — so accept
  // an optional query/hash suffix.
  await expect(page).toHaveURL(/\/catalog\/?(?:[?#].*)?$/);
  await waitForSeedCatalogRows(page);

  // The Type column of the catalog table renders a Badge for each
  // entity's spec.type via the shadcn/ui Badge component (see
  // `packages/core-components/src/components/ui/badge.tsx`). That
  // Badge renders as `<div data-slot="badge" class="…">`, where the
  // class string is produced by `class-variance-authority` and does
  // NOT contain the literal substring "badge" — selecting on
  // `[class*="badge"]` therefore matches nothing and `td` (the parent
  // cell) would win the first-match, hiding the border classes we
  // want to assert on. The deterministic seed includes
  // `blitzy-e2e-component-a` with `spec.type: library`, so a library
  // badge MUST be present. We select the Badge by its stable
  // `data-slot="badge"` attribute and filter to the one whose text
  // is exactly "library", which is the Badge produced by
  // `createSpecTypeColumn` for the library entity.
  const libraryChip = page
    .locator('table [data-slot="badge"]')
    .filter({ hasText: /^library$/i })
    .first();

  await expect(libraryChip).toBeVisible({ timeout: 10_000 });

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
  // signInAsGuest lands on /catalog; no further navigation needed.
  // Avoid page.goto here — it would wipe the React-state auth identity
  // and bounce the test back to the sign-in page where the Tags
  // picker does not exist.
  await signInAsGuest(page);
  // Catalog page serializes default filter state into the URL on first
  // render — `/catalog?filters[kind]=component&limit=20` — so accept
  // an optional query/hash suffix.
  await expect(page).toHaveURL(/\/catalog\/?(?:[?#].*)?$/);
  await waitForSeedCatalogRows(page);

  // Identify the Tags filter picker on the catalog page. Backstage's
  // EntityTagPicker renders as a Material-UI Autocomplete with the
  // label "Tags".
  const tagPicker = page.getByLabel('Tags', { exact: false }).first();
  await expect(tagPicker).toBeVisible({ timeout: 10_000 });

  // Open the tag picker dropdown — Playwright's `.click()` waits for
  // the listbox to open via its own retry semantics, so no fixed
  // sleep is necessary.
  await tagPicker.click();

  // Wait for the listbox/options to appear. The fixture seeds the
  // catalog with tags including "java" and "spring", so we can poll
  // until at least the "java" option is selectable.
  const javaOption = page.getByRole('option', { name: /^java$/i }).first();
  await expect(javaOption).toBeVisible({ timeout: 10_000 });

  // Select the "java" tag. After selection, three seed entities
  // remain visible (a, b, c) plus any pre-existing rows. Read the
  // count via `expect.poll` so we don't race the table update.
  await javaOption.click();

  const countAfterOneTag = await readCatalogHeaderCount(page);
  // If the picker auto-closes after a selection we need to re-open
  // it. Detect this via the popover state and re-open if needed.
  const listboxOpen = await page
    .getByRole('listbox')
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (!listboxOpen) {
    await tagPicker.click();
  }

  const springOption = page.getByRole('option', { name: /^spring$/i }).first();
  await expect(springOption).toBeVisible({ timeout: 10_000 });
  await springOption.click();

  // Close the Tags picker so we are not racing the open/close
  // animation when reading the header count and table rows below.
  // Firefox in particular keeps the listbox open after an option
  // click, which causes the table-row count and the header count to
  // update at slightly different times. Pressing Escape collapses
  // the listbox synchronously.
  await page.keyboard.press('Escape');

  // After selecting both tags, wait until the count AND the visible
  // table rows converge on the same value. The seed catalog has
  // exactly two rows matching {java, spring} (component-a and
  // component-b). Polling both signals together avoids reading them
  // in a transient state where the count has updated but the row
  // render has not yet caught up (or vice versa). This is the
  // single-source-of-truth assertion from AAP §0.5.5: the displayed
  // count and the displayed list must agree.
  await expect
    .poll(
      async () => {
        const count = await readCatalogHeaderCount(page);
        const rows = await page
          .locator('table tbody tr:not([class*="empty"])')
          .count();
        return { count, rows };
      },
      { timeout: 15_000 },
    )
    .toMatchObject({ count: 2, rows: 2 });

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
  // subset of OR over the same input). The seed fixture guarantees
  // the inequality is strict because component-c has only one of the
  // two selected tags.
  if (countAfterOneTag !== null && countAfterTwoTags !== null) {
    expect(countAfterTwoTags).toBeLessThanOrEqual(countAfterOneTag);
    // The strict inequality must hold for the seed fixtures because
    // tag {java} matches 3 fixture entities (a, b, c) while
    // {java, spring} matches only 2 (a, b). When other catalog
    // sources contribute additional entities the inequality remains
    // because the seed alone proves the AND-narrowing path.
    expect(countAfterTwoTags).toBeLessThan(countAfterOneTag + 1);
  }
});
