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
 * This package installs `BlitzyPermissionPolicy`, which enforces
 * read-only access for any user whose verified email domain is not
 * `@blitzy.com` and for Backstage Guest principals (including anonymous
 * callers). It replaces the registration of
 * `@backstage/plugin-permission-backend-module-allow-all-policy` in
 * `packages/backend/src/index.ts`.
 *
 * @packageDocumentation
 */

export { permissionModuleBlitzyPolicy as default } from './module';
export { BlitzyPermissionPolicy } from './policy';
