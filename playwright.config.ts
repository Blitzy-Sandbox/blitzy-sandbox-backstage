/*
 * Copyright 2023 The Backstage Authors
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

import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from '@playwright/test';
import { generateProjects } from '@backstage/e2e-test-utils/playwright';

/**
 * Playwright E2E test configuration for the Backstage monorepo.
 *
 * This configuration includes visual regression screenshot validation settings
 * to support the shadcn/ui migration. Programmatic screenshots are captured for
 * every redesigned user flow in both light and dark modes to verify component
 * rendering, layout consistency, and theme correctness.
 *
 * Cross-browser coverage (AAP §0.8.2.5):
 *   `generateProjects()` from `@backstage/e2e-test-utils/playwright` scans the
 *   monorepo for packages with an `e2e-tests/` folder and emits a single project
 *   per discovered package keyed to `channel: 'chrome'`. To satisfy the AAP's
 *   cross-browser mandate without modifying that public export's signature, we
 *   fan each discovered package out into three browser-specific projects
 *   (chromium, firefox, webkit) using Playwright's bundled browser binaries via
 *   `devices`. Each project's `name` is `<package>-<browser>` so test selection
 *   via `--project` remains ergonomic in CI.
 *
 * Visual regression scope:
 *   The 10 existing PNG baselines under `packages/app/e2e-tests/__screenshots__/`
 *   were captured on chromium. To avoid spurious failures from cross-browser
 *   pixel drift (font rendering, scrollbar widths, sub-pixel anti-aliasing —
 *   industry-standard sources of cross-browser flake), tests prefixed with
 *   `Visual regression:` are skipped on firefox and webkit at the test-file level
 *   via a `test.beforeEach` gate. firefox and webkit therefore run the full
 *   functional-assertion surface (welcome page, theme correctness, search,
 *   authorization, auditing, refactor coverage) while visual regression remains
 *   chromium-only. The chromium baselines remain the single source of truth.
 *   See `docs/refactor/decision-log.md` Entry 18 and `docs/refactor/next-tasks.md`.
 *
 * See https://playwright.dev/docs/test-configuration.
 */

/**
 * Browser dimension for the cross-browser fan-out below. Each entry maps a
 * suffix used in the Playwright project name (e.g., `example-app-chromium`) to
 * the `devices` preset that selects Playwright's bundled browser binary. We
 * unset `channel` from the base project's `use` object because `channel` and
 * a `devices[…]` preset are mutually exclusive — `channel` forces Playwright
 * to launch the system-installed browser, whereas `devices[…]` configures
 * Playwright's own bundled binary.
 */
const browsers = [
  { suffix: 'chromium', use: devices['Desktop Chrome'] },
  { suffix: 'firefox', use: devices['Desktop Firefox'] },
  { suffix: 'webkit', use: devices['Desktop Safari'] },
] as const;

const baseProjects = generateProjects() ?? [];

/**
 * Fan each base project (one per package with `e2e-tests/`) across the three
 * browsers above. The resulting `projects` array has length
 * `baseProjects.length * browsers.length` (today: 1 × 3 = 3 projects, since
 * only `packages/app/e2e-tests/` exists).
 */
const projects: PlaywrightTestConfig['projects'] = baseProjects.flatMap(base =>
  browsers.map(b => ({
    name: `${base.name}-${b.suffix}`,
    testDir: base.testDir,
    use: {
      ...(base.use ?? {}),
      // Drop `channel: 'chrome'` from generateProjects() — the devices preset
      // selects Playwright's bundled browser, which is what we want for
      // reproducible CI runs that don't depend on a system-installed Chrome.
      channel: undefined,
      ...b.use,
    },
  })),
);

export default defineConfig({
  timeout: 30_000,

  expect: {
    timeout: 5_000,
    /**
     * Visual regression tolerance for screenshot comparisons.
     * Used to validate the shadcn/ui migration produces consistent rendering
     * across both light and dark themes (WCAG 2.1 AA compliance).
     */
    toHaveScreenshot: {
      maxDiffPixels: 100,
      threshold: 0.2,
    },
  },

  // Run your local dev server before starting the tests.
  //
  // BLITZY_E2E_TEST_MODE=true is exported into the backend's environment
  // so that the `blitzy-e2e` proxy auth provider is registered and able
  // to mint identity tokens with arbitrary `email` JWT claims for the
  // `authorization.test.ts` deterministic-token suite. The provider is
  // intentionally gated behind this env var with multiple layers of
  // defense (see `packages/backend/src/authModuleBlitzyE2E.ts`).
  //
  // CI environments that start the backend out-of-band MUST set the
  // same env var; otherwise the authorization E2E suite will fail-fast
  // rather than silently skip the non-Blitzy and Blitzy-domain paths.
  webServer: process.env.CI
    ? []
    : [
        {
          command: 'yarn start example-app',
          port: 3000,
          reuseExistingServer: true,
          timeout: 60_000,
        },
        {
          command: 'yarn start example-backend',
          port: 7007,
          reuseExistingServer: true,
          timeout: 60_000,
          env: {
            ...process.env,
            BLITZY_E2E_TEST_MODE: 'true',
          },
        },
      ],

  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 2 : 0,

  reporter: [
    ['html', { open: 'never', outputFolder: 'e2e-test-report' }],
    ['json', { outputFile: 'e2e-test-report/test-results.json' }],
  ],

  use: {
    actionTimeout: 0,
    baseURL:
      process.env.PLAYWRIGHT_URL ??
      (process.env.CI ? 'http://localhost:7007' : 'http://localhost:3000'),
    /** Capture screenshots for every test to validate shadcn/ui visual consistency */
    screenshot: 'on',
    trace: 'on-first-retry',
    /** Retain video recordings on failure for debugging visual regression issues */
    video: 'retain-on-failure',
    /**
     * Fixed viewport dimensions ensure consistent screenshot comparisons
     * across different CI environments and local development machines.
     */
    viewport: { width: 1280, height: 720 },
    /**
     * Bypass Content-Security-Policy enforcement during E2E tests.
     *
     * Rationale (cross-browser correctness — AAP §0.8.2.5):
     *   Backstage's default Helmet middleware emits a `upgrade-insecure-requests`
     *   CSP directive on every response. Chromium and Firefox have built-in
     *   exemptions for `http://localhost` URLs and therefore do not upgrade
     *   subresources to `https://` during tests. WebKit, by contrast, enforces
     *   the directive strictly even on `localhost`, which causes every static
     *   JS/CSS chunk fetched by the SPA to fail with a TLS handshake error
     *   (the local backend only serves plain HTTP). Without disabling CSP at
     *   the browser context level, the WebKit project cannot load the Backstage
     *   shell at all and every test in `refactor.test.ts`, `app.test.ts`,
     *   `authorization.test.ts`, `auditing.test.ts`, `HomePage.test.ts`, and
     *   `SearchPage.test.ts` fails with "element not found" on the very first
     *   sign-in assertion.
     *
     * Why it is safe to set globally rather than per-browser:
     *   - Chromium and Firefox already exempt `localhost` from CSP upgrades, so
     *     toggling this flag is a no-op for those two projects (verified locally;
     *     the existing chromium and firefox suites remain green).
     *   - The flag only affects the browser context running test traffic. It
     *     does not alter the backend's CSP headers in any way; production
     *     deployments (which terminate TLS at a reverse proxy) are unaffected.
     *   - CSP is not part of the assertion surface for any test in this
     *     refactor — we verify chrome layout, permissions, audit events, and
     *     catalog count semantics, none of which depend on CSP enforcement.
     *
     * See `docs/refactor/decision-log.md` for the full rationale.
     */
    bypassCSP: true,
  },

  outputDir: 'node_modules/.cache/e2e-test-results',

  /**
   * Snapshot directory for visual regression baseline images.
   * Screenshots from both light and dark mode flows are stored here
   * as validation artifacts for the shadcn/ui component migration.
   */
  snapshotDir: 'e2e-test-snapshots',

  /**
   * Organized snapshot path template for screenshot storage.
   * Ensures screenshots are grouped by test file and identified by
   * a descriptive argument name and file extension.
   */
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',

  // Cross-browser fan-out of the packages discovered by `generateProjects()`.
  // See the module-level JSDoc above for the strategy. Today this expands the
  // single discovered package (`packages/app/e2e-tests/`, `name: example-app`)
  // into three projects: `example-app-chromium`, `example-app-firefox`,
  // `example-app-webkit`. Visual regression tests are gated to chromium at the
  // test-file level via `test.beforeEach`; functional tests run on all three.
  projects,
});
