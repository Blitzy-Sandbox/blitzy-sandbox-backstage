/*
 * Copyright 2022 The Backstage Authors
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

import { createBackend } from '@backstage/backend-defaults';
import { rootSystemMetadataServiceFactory } from '@backstage/backend-defaults/alpha';
import {
  coreServices,
  createBackendFeatureLoader,
} from '@backstage/backend-plugin-api';
import { blitzyE2EAuditorServiceFactory } from './blitzyE2EAuditCapture';

const backend = createBackend();

// An example of how to group together and load multiple features. You can also
// access root-scoped services by adding `deps`.
const searchLoader = createBackendFeatureLoader({
  deps: {
    config: coreServices.rootConfig,
  },
  *loader({ config }) {
    yield import('@backstage/plugin-search-backend');
    yield import('@backstage/plugin-search-backend-module-catalog');
    // TechDocs search collator disabled — causes OOM indexing 36 repos with no docs built
    // yield import('@backstage/plugin-search-backend-module-techdocs');
    if (config.has('search.elasticsearch')) {
      yield import('@backstage/plugin-search-backend-module-elasticsearch');
    }
  },
});

backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('./authModuleGithubProvider'));
backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));
backend.add(import('@backstage/plugin-auth-backend-module-openshift-provider'));

// E2E TEST-ONLY: when BLITZY_E2E_TEST_MODE=true, register the
// `blitzy-e2e` proxy auth provider that mints identity tokens with
// arbitrary email claims via custom HTTP headers, the capturing
// AuditorService factory, and the audit-events debug HTTP endpoint.
// All three pieces gate themselves on the env var even if a
// misconfigured deployment imports the modules. See
// `authModuleBlitzyE2E.ts` and `blitzyE2EAuditCapture.ts` for the
// full security posture.
if (process.env.BLITZY_E2E_TEST_MODE === 'true') {
  backend.add(import('./authModuleBlitzyE2E'));
  backend.add(blitzyE2EAuditorServiceFactory);
  backend.add(import('./blitzyE2EAuditCapture'));
}
backend.add(import('@backstage/plugin-app-backend'));
backend.add(import('@backstage/plugin-catalog-backend-module-unprocessed'));
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(import('./catalogModuleConfigLocations'));
backend.add(import('@backstage/plugin-catalog-backend-module-github'));
backend.add(import('@backstage/plugin-catalog-backend-module-github-org'));
backend.add(import('@backstage/plugin-events-backend'));
backend.add(import('@internal/plugin-permission-backend-module-blitzy-policy'));
backend.add(import('@internal/plugin-catalog-backend-module-access-audit'));
backend.add(import('@backstage/plugin-permission-backend'));
backend.add(import('@backstage/plugin-proxy-backend'));
backend.add(
  import('@backstage/plugin-catalog-backend-module-backstage-openapi'),
);
backend.add(searchLoader);
backend.add(import('@backstage/plugin-techdocs-backend'));
backend.add(import('@backstage/plugin-signals-backend'));
backend.add(import('@backstage/plugin-notifications-backend'));
backend.add(rootSystemMetadataServiceFactory);

backend.start();
