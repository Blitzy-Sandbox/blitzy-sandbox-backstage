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
 * The `catalog-backend-module-access-audit` backend module emits an
 * `entity-access` audit event each time a principal reads a single
 * catalog entity via the catalog plugin's HTTP routes.
 *
 * @remarks
 *
 * The module attaches an HTTP middleware to the catalog plugin's Express
 * router that intercepts `GET /entities/by-name/:kind/:namespace/:name`
 * and `GET /entities/by-uid/:uid` requests. After the response is sent,
 * it emits an `entity-access` audit event via
 * `coreServices.auditor` that records the entity ref, the principal, and
 * the action so downstream consumers (SIEMs, log aggregators) can audit
 * project-level access without modifying the catalog backend itself.
 *
 * Register the module by adding the following line to
 * `packages/backend/src/index.ts`:
 *
 * ```ts
 * backend.add(import('@internal/plugin-catalog-backend-module-access-audit'));
 * ```
 *
 * Implements the project access tracking requirement from the Blitzy
 * Sandbox Backstage refactor (AAP §0.5.1.3, §0.6.1.4).
 *
 * @packageDocumentation
 */

export { catalogModuleAccessAudit as default } from './module';
