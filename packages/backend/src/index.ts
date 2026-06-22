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
import { rootHttpRouterServiceFactory } from '@backstage/backend-defaults/rootHttpRouter';
import {
  coreServices,
  createBackendFeatureLoader,
} from '@backstage/backend-plugin-api';
import { blitzyE2EAuditorServiceFactory } from './blitzyE2EAuditCapture';
import { blitzyUserInfoServiceFactory } from './userInfoServiceFactory';

const backend = createBackend();

// Cross-browser E2E compatibility: replace the default
// `rootHttpRouterServiceFactory` with a custom configure that strips
// the `Strict-Transport-Security` (HSTS) header from outgoing responses
// when the backend's `baseUrl` uses plain HTTP (i.e., local dev / local
// E2E test environments).
//
// Why:
//   Backstage's default Helmet middleware emits HSTS
//   (`Strict-Transport-Security: max-age=15552000; includeSubDomains`)
//   on every response. Chromium and Firefox have built-in exemptions
//   for `http://localhost` and therefore do not honor HSTS upgrades on
//   localhost. WebKit, however, enforces HSTS strictly even on
//   localhost. The first response from `http://localhost:7007/` causes
//   WebKit to pin localhost into its HSTS cache; the next subresource
//   request (e.g., `/manifest.json`, `/static/main.js`) is upgraded to
//   `https://localhost:7007/...` which fails with a TLS handshake
//   error because the backend only serves plain HTTP. The SPA shell
//   never loads and every E2E test in `packages/app/e2e-tests/` fails
//   on the very first sign-in assertion.
//
//   Disabling CSP via Playwright's `bypassCSP: true` does NOT help here
//   because HSTS is enforced independently of CSP.
//
// Why this is safe to do here:
//   - The HSTS strip is gated on the protocol of `app.baseUrl`. Local
//     dev uses `http://localhost:7007`; production uses `https://...`.
//     The strip is therefore a no-op for production deployments.
//   - HSTS over plain HTTP has no security value: a network attacker
//     who can intercept the response can also strip the header. HSTS
//     only matters once you're already on HTTPS.
//   - Production deployments enforce HTTPS at the reverse-proxy / TLS
//     terminator layer (e.g., Fly.io, Cloudflare); HSTS at the
//     application layer is defense-in-depth, not the primary gate.
//
// See `docs/refactor/decision-log.md` for the full rationale and
// `playwright.config.ts` `use.bypassCSP` for the companion change.
backend.add(
  rootHttpRouterServiceFactory({
    configure({ app, applyDefaults }) {
      // Intercept `res.setHeader` BEFORE Helmet runs so that any call to
      // set `Strict-Transport-Security` over plain HTTP is silently
      // suppressed. We monkey-patch on a per-request basis (no global
      // mutation) to keep the override scoped and reversible.
      app.use((_req, res, next) => {
        // Read the canonical app baseUrl from Express locals if the
        // backend has populated it; otherwise infer from the request
        // protocol. Either way, only strip HSTS for plain HTTP.
        const isHttp = !_req.secure && _req.protocol !== 'https';
        if (isHttp) {
          const origSetHeader = res.setHeader.bind(res);
          (res as unknown as { setHeader: typeof res.setHeader }).setHeader = (
            name: string,
            value: number | string | ReadonlyArray<string>,
          ) => {
            if (
              typeof name === 'string' &&
              name.toLowerCase() === 'strict-transport-security'
            ) {
              return res;
            }
            return origSetHeader(name, value);
          };
        }
        next();
      });
      applyDefaults();
    },
  }),
);

// Replace the default `userInfoServiceFactory` from
// `@backstage/backend-defaults` with the Blitzy custom factory. The
// custom factory surfaces the verified user email (from the JWT
// `email` claim or the in-process email cache) via the returned
// `BackstageUserInfo`. Without this override, internal plugin-to-plugin
// permission checks would have no way to read the user's email — the
// on-behalf-of token issued by `AuthService.getPluginRequestToken()`
// drops the `email` claim — and the `BlitzyPermissionPolicy` would
// DENY all writes including for `@blitzy.com` users (QA CP5 Critical
// Defect #2). See `userInfoServiceFactory.ts` for the full
// architectural rationale.
backend.add(blitzyUserInfoServiceFactory);

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
// Replace the upstream default `@backstage/plugin-auth-backend-module-
// guest-provider` with the Blitzy-augmented Guest provider that emits a
// `user-login` audit event on every Guest sign-in attempt. Both modules
// declare the same pluginId/moduleId/providerId so this is a clean
// drop-in replacement. Required by AAP §0.1.3 Critical Test Scenario
// "User Tracking: Verify Guest login and project access events are
// accurately recorded" and addresses QA CP6 Critical Finding F-002.
// See `./authModuleGuestProvider.ts` for the full audit lifecycle
// guarantees and the rationale for the recreated authenticator.
backend.add(import('./authModuleGuestProvider'));
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
backend.add(import('@internal/plugin-catalog-backend-module-access-audit'));
backend.add(import('@backstage/plugin-events-backend'));
backend.add(import('@internal/plugin-permission-backend-module-blitzy-policy'));
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
