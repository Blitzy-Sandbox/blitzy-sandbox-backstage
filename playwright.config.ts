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

import { defineConfig } from '@playwright/test';
import { generateProjects } from '@backstage/e2e-test-utils/playwright';

/**
 * Playwright E2E test configuration for the Backstage monorepo.
 *
 * This configuration includes visual regression screenshot validation settings
 * to support the shadcn/ui migration. Programmatic screenshots are captured for
 * every redesigned user flow in both light and dark modes to verify component
 * rendering, layout consistency, and theme correctness.
 *
 * See https://playwright.dev/docs/test-configuration.
 */
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

  projects: generateProjects(), // Find all packages with e2e-test folders
});
