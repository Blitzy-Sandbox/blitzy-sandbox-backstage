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

/**
 * The Blitzy permission policy backend module for the Backstage `permission`
 * plugin.
 *
 * @remarks
 *
 * This package will install `BlitzyPermissionPolicy`, which enforces
 * read-only access for any user whose verified email domain is not
 * `@blitzy.com` and for Backstage Guest principals. It is intended to
 * replace the registration of
 * `@backstage/plugin-permission-backend-module-allow-all-policy` in
 * `packages/backend/src/index.ts`.
 *
 * At the current Checkpoint 1 milestone this package contains only its
 * workspace scaffolding (`package.json`, `tsconfig`, `.eslintrc.js`,
 * `catalog-info.yaml`, `README.md`, `CHANGELOG.md`, `knip-report.md`)
 * plus this entry-point placeholder. The policy implementation
 * (`src/policy.ts`), backend module wiring (`src/module.ts`), and unit
 * tests (`src/policy.test.ts`) are forthcoming in a subsequent
 * implementation checkpoint per Agent Action Plan §0.6.1.4.
 *
 * Once the policy implementation lands, this entry point will re-export
 * the backend module as the package's default export so that
 * `backend.add(import('@internal/plugin-permission-backend-module-blitzy-policy'))`
 * resolves to the registered policy module.
 *
 * @packageDocumentation
 */

/**
 * Placeholder shape of the package entry point.
 *
 * The shape will be replaced when `src/module.ts` exists. Declaring an
 * explicit interface (rather than `export {}`) keeps this file linted as
 * production TypeScript and gives IDE consumers a discoverable symbol
 * during the metadata-scaffolding milestone.
 *
 * @public
 */
export interface BlitzyPermissionPolicyModulePlaceholder {
  /**
   * Identifier of the upcoming Backstage backend module that will install
   * `BlitzyPermissionPolicy`. The value mirrors what `createBackendModule`
   * will receive in `src/module.ts`.
   */
  readonly moduleId: 'blitzy-policy';
  /**
   * Identifier of the Backstage plugin the module attaches to.
   */
  readonly pluginId: 'permission';
}
