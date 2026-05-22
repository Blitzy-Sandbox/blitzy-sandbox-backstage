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
 * The catalog-backend-module-access-audit module emits an `entity-access`
 * audit event whenever a single catalog entity is read through the catalog
 * backend (GET `/entities/by-name/:kind/:namespace/:name` or GET
 * `/entities/by-uid/:uid`). The event records the resolved principal, the
 * stringified entity ref, the action (`read`), and the HTTP status code
 * via Backstage's AuditorService.
 *
 * @packageDocumentation
 */

export { catalogModuleAccessAudit as default } from './module';
