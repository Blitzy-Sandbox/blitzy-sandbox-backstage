# Onboarding Addendum — Blitzy Sandbox Backstage Refactor

This document is the contributor-facing companion to [`../getting-started.md`](../getting-started.md) and [`../index.md`](../index.md). It captures the setup, customization, and operational knowledge that a new developer needs **specifically for the refactored chrome, permission policy, and audit infrastructure** delivered by this pull request. Per **Rule R2 (Onboarding & Continued Development)** and **Rule R6 (LocalGCP Verification)** of the Agent Action Plan, it goes from a clean machine to a running, modifiable application without requiring questions.

For the WHY behind each choice, see [`decision-log.md`](decision-log.md). For the WHAT-CHANGED diagrams, see [`architecture-before-after.md`](architecture-before-after.md). For discovered follow-on work, see [`next-tasks.md`](next-tasks.md).

---

## 1. Clean-Machine Setup

The application targets **Node.js 22 (forward-compatible with Node 24)** and **Yarn 4.8.1**, as declared by the root `package.json` (`engines.node = "22 || 24"`, `packageManager = "yarn@4.8.1"`).

### 1.1 Install Node.js 22

The recommended path is `nvm`. Run `nvm install 22 && nvm use 22`, then verify with `node --version` (expect `v22.x.x`). If you do not use `nvm`, install Node.js 22 LTS from [nodejs.org](https://nodejs.org) directly. Older Node versions (16, 18, 20) are unsupported by Backstage 1.48.0 and will fail at install or runtime.

### 1.2 Enable Yarn 4.8.1 via Corepack

Yarn 4 is provisioned through Node's bundled `corepack` shim:

```bash
corepack enable
corepack prepare yarn@4.8.1 --activate
yarn --version   # expect 4.8.1
```

If `corepack` prompts for a download confirmation in a non-interactive shell, prepend `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`.

### 1.3 Clone and install

```bash
git clone https://github.com/Blitzy-Sandbox/blitzy-sandbox-backstage.git
cd blitzy-sandbox-backstage
yarn install
```

The first install may take several minutes due to the workspace size — 53 `packages/*` and 155 `plugins/*` workspaces, approximately 2.9 GB of `node_modules`. Subsequent installs are incremental.

### 1.4 Build and start

Run `yarn start`. This launches the frontend (`packages/app`) on `http://localhost:3000` and the backend (`packages/backend`) on `http://localhost:7007` concurrently. The Prometheus metrics exporter is reachable at `http://localhost:9464/metrics`. The bare URL `/` automatically redirects to `/catalog` — the refactor's new landing page.

Verify the bring-up by checking the following from a browser:

- The catalog page renders at `http://localhost:3000/` (which redirects to `/catalog`).
- The top-right cluster of the page header shows the Logo, the Settings icon button, and the Support icon button.
- Clicking the Support button opens a popover listing `support@blitzy.com` and the GitHub Issues link.
- No left-side sidebar is visible — the navigation lives entirely in the top bar now.

---

## 2. LocalGCP Setup

Per **Rule R6 (LocalGCP Verification)**, every Google Cloud Platform (GCP) service interaction must be verifiable against LocalGCP with zero live GCP dependencies. The setup below ensures contributor workstations and CI pipelines can exercise GCS, Pub/Sub, and Firestore against the emulator without requiring real GCP credentials.

### 2.1 Option A — Host binary install

The user-provided environment instructions reference a single-binary asset URL. As of LocalGCP v0.6.0 the upstream `slokam-ai/localgcp` releases ship a tarball rather than a single static binary at that path — the original URL is deprecated and resolves to a 404 for current releases (see the Setup Status Log "LocalGCP setup adaptation" note). Use the tarball-based install command below as the canonical path; the original command is retained for older releases.

Recommended (LocalGCP v0.6.0 and later, tarball-based):

```bash
curl -LO https://github.com/slokam-ai/localgcp/releases/download/v0.6.0/localgcp_0.6.0_linux_amd64.tar.gz
tar -xzf localgcp_0.6.0_linux_amd64.tar.gz
sudo install localgcp /usr/local/bin/localgcp
nohup localgcp up --data-dir=./.localgcp --quiet --no-docker > /tmp/localgcp.log 2>&1 &
sleep 3
```

Legacy (for releases that still publish the single-binary asset):

```bash
# Will return 404 against current releases — kept here only because it matches
# the user-provided environment instructions verbatim. Prefer the tarball path
# above for any new contributor setup.
curl -LO https://github.com/slokam-ai/localgcp/releases/latest/download/localgcp-linux-amd64
sudo install localgcp-linux-amd64 /usr/local/bin/localgcp
localgcp up --data-dir=./.localgcp &
sleep 3
```

The `--data-dir=./.localgcp` directory is gitignored at the repository root. The `--quiet` flag silences the emulator's stdout banner; `--no-docker` disables the orchestrated services (Spanner, Bigtable, Cloud SQL, Memorystore, BigQuery) that would otherwise require Docker-in-Docker — none of those are needed by the current Backstage refactor. `nohup` plus `&` backgrounds the emulator so the shell remains usable; `sleep 3` allows the gRPC and REST listeners to come online before the first SDK call.

### 2.2 Option B — Docker Compose

For CI runners and developer machines that prefer not to install the host binary, the repository provides a dedicated compose file:

```bash
docker compose -f docker-compose.localgcp.yml up -d     # start
docker compose -f docker-compose.localgcp.yml down      # teardown
```

The compose file exposes the same ports as the host binary, so application code does not need to vary based on which option is in use.

### 2.3 Environment variables

The Backstage backend and any contributor scripts read four environment variables to locate the emulator:

- `STORAGE_EMULATOR_HOST` — defaults to `http://localhost:4443` in the documented setup. Consumed by `@google-cloud/storage` clients (with the v7 workaround in Section 3).
- `PUBSUB_EMULATOR_HOST` — defaults to `localhost:8085`. Consumed by `@google-cloud/pubsub` clients directly.
- `FIRESTORE_EMULATOR_HOST` — defaults to `localhost:8088`, matching the Firestore gRPC port exposed by `docker-compose.localgcp.yml` and the host-binary defaults documented in the Setup Status Log. Consumed by `@google-cloud/firestore` clients directly.
- `LOCALGCP_HOST` — optional. Used by test fixtures to gate integration tests on emulator availability; if unset, tests that exercise GCP services may be skipped rather than fail.

Export these in your shell before running `yarn start` or tests that exercise GCP-bound code paths.

### 2.4 Verification

Confirm the GCS emulator is up with `curl http://localhost:4443/`. The response is JSON of the form `{"kind":"storage#serviceAccount","service":"localgcp"}` (not HTML), confirming the emulator is reachable. If you receive `connection refused`, restart the emulator via Option A or Option B above.

---

## 3. `@google-cloud/storage` v7 Workaround

The v7+ `@google-cloud/storage` SDK splits its JSON API and upload URL derivation into two separate code paths. Setting `STORAGE_EMULATOR_HOST` alone is insufficient — the SDK must be constructed with an explicit `apiEndpoint`, and `.save()` calls must opt out of the default resumable upload and validation behaviors which fail against the emulator. This is reproduced verbatim from the user-provided environment instructions and is the canonical pattern for any code that instantiates `Storage` in this repository.

The canonical pattern:

- Strip the protocol from `STORAGE_EMULATOR_HOST` and pass it as the `apiEndpoint` option to the `new Storage(...)` constructor.
- Pass `{ resumable: false, validation: false, metadata: { name: filePath } }` to every `.save()` call.

```typescript
import { Storage } from '@google-cloud/storage';

const rawHost = process.env.STORAGE_EMULATOR_HOST!.replace(/^https?:\/\//, '');
delete process.env.STORAGE_EMULATOR_HOST;

const storage = new Storage({
  projectId: PROJECT_ID,
  apiEndpoint: `http://${rawHost}`,
});

const bucket = storage.bucket(BUCKET_NAME);
const file = bucket.file(filePath);

await file.save(contents, {
  resumable: false,
  validation: false,
  metadata: { name: filePath },
});
```

The current refactor does **not** introduce new GCS code paths; the workaround is preserved as a constraint for any future code (for example, a TechDocs publisher reconfigured to use GCS) that exercises the emulator. See entry 7 in [`next-tasks.md`](next-tasks.md) regarding adding a CI step that boots LocalGCP and runs GCS-touching integration tests.

---

## 4. `PUBSUB_EMULATOR_HOST` and `FIRESTORE_EMULATOR_HOST`

Unlike `@google-cloud/storage` v7, the `@google-cloud/pubsub` and `@google-cloud/firestore` SDKs honor their respective `PUBSUB_EMULATOR_HOST` and `FIRESTORE_EMULATOR_HOST` environment variables directly. No constructor injection or per-call option override is required — the SDKs detect the variables at module load and route gRPC traffic to the emulator.

To start the backend with all three emulator variables set in one line:

```bash
STORAGE_EMULATOR_HOST=http://localhost:4443 PUBSUB_EMULATOR_HOST=localhost:8085 FIRESTORE_EMULATOR_HOST=localhost:8088 yarn start
```

If you launch `yarn start` from a shell that already exports these variables (recommended), the command degenerates to plain `yarn start`.

---

## 5. Top-Bar Customization

The top-right cluster (Logo, Settings, Support) is mounted by a single frontend module, making it easy to add or remove items without touching `packages/core-components`.

### 5.1 Where the top-bar lives

The module is at `packages/app/src/modules/appModuleTopBar.tsx`. It is registered in the `features` array of `packages/app/src/App.tsx`. This file **replaces** `packages/app/src/modules/appModuleNav.tsx`, which was deleted in this refactor — the sidebar no longer exists, and no other module mounts navigation chrome.

### 5.2 Adding a new icon

To add (for example) a notifications bell between Settings and Support:

1. Import an icon from `lucide-react`, e.g. `import { Bell } from 'lucide-react';`. The icon set is already a workspace dependency.
2. Insert a new component in the cluster JSX of `appModuleTopBar.tsx` between the existing Settings and Support nodes.
3. Wrap with `<Link to="/notifications">` if the icon navigates, or use a plain `<button onClick={...}>` if it triggers a modal or popover.
4. Update the corresponding E2E assertion in `packages/app/e2e-tests/refactor.test.ts` so the new icon is exercised by CI.

### 5.3 Where the Blitzy SVG lives

The Blitzy logo is an inline SVG inside `appModuleTopBar.tsx`. The SVG path data is preserved verbatim from the deleted `appModuleNav.tsx` `SidebarLogo` component, but the wrapping element is a plain `<div>` instead of a `<Link to="/">`. The deliberate result is that the logo is non-clickable — it is purely a brand mark. See the entry "Logo non-clickability mechanism" in [`decision-log.md`](decision-log.md) for the rationale, alternatives considered, and risks.

### 5.4 Customizing the Support popover

The Support button's popover content is sourced from `app-config.yaml`'s `app.support.items` array, NOT from React code. To add a new help link (for example, a Slack channel), append a new entry to the array in `app-config.yaml`:

```yaml
- title: Slack
  icon: chat
  links:
    - url: 'slack://channel?team=...&id=...'
      title: '#blitzy-help'
```

Restart `yarn start` (or just the backend) to pick up the change. No code change or rebuild is required — the `SupportButton` component in `packages/core-components` reads the configuration on every render.

---

## 6. Policy Customization

The `BlitzyPermissionPolicy` enforces read-only access for any user whose verified email domain is not `@blitzy.com` and for every Guest session. It is implemented as a stand-alone backend module so that it can be tested, swapped, or extended independently of `packages/backend`.

### 6.1 Where the policy lives

The class lives at `plugins/permission-backend-module-blitzy-policy/src/policy.ts`, named `BlitzyPermissionPolicy`, with entry point `handle(request: PolicyQuery, user?: PolicyQueryUser): Promise<PolicyDecision>`. The backend module wiring lives at `src/module.ts` and uses `createBackendModule({ pluginId: 'permission', moduleId: 'blitzy-policy', ... })`. Unit tests live at `src/policy.test.ts` and exercise every branch of `handle()` at ≥80% coverage (AAP §0.7.2).

### 6.2 Changing the allowed email domain

Locate the `isBlitzyDomain` helper (or the equivalent string check) in `policy.ts` and change the `@blitzy.com` literal to another domain (for example, `@example.com`). Unit tests in `policy.test.ts` that assert allow-vs-deny decisions for `@blitzy.com` emails must be updated in tandem — the failing tests are the safety net that catches drift between the runtime literal and the documented contract.

### 6.3 Adding a decision rule

To add a new rule (for example, deny all actions for a known compromised username regardless of email domain), extend `handle()` with an additional branch evaluated **before** the read/write split. Add a unit test in `policy.test.ts` that constructs the matching `user` shape and asserts the expected `PolicyDecision`. Keep `handle()` O(1) and side-effect-free; heavy lookups belong in a separate service injected via `deps`.

### 6.4 Adding a new audit event ID

Audit events are emitted via the injected `auditor` service. Construct the event with `auditor.createEvent({ eventId: 'entity-access', severityLevel: 'low', request, meta: { entityRef, principal, action: 'read' } })`, then call `.success({ meta })` on success or `.fail({ error, meta })` on failure paths so the audit log captures the failure mode. To add an `entity-write` event when a future workstream introduces write paths through the policy, see entry 5 in [`next-tasks.md`](next-tasks.md) for the suggested approach.

### 6.5 Registering a different policy module

The policy is wired in `packages/backend/src/index.ts` via `backend.add(import('@internal/plugin-permission-backend-module-blitzy-policy'))`. To swap policies (for example, back to `allow-all` for a debug session), comment out the Blitzy module line and uncomment the `allow-all` line (or replace with another module). Only one `PermissionPolicy` may be registered at a time — registering both produces a startup error. The catalog access audit module is registered separately at `backend.add(import('@internal/plugin-catalog-backend-module-access-audit'))`. These two modules are independent — swapping the policy does not change audit emission, and disabling the audit module does not change permission decisions.

### 6.6 Email propagation — the two-source architecture

The policy's read of `email` from `PolicyQueryUser` involves three pieces of code that work together to close the **on-behalf-of token gap**. This is the architectural fix that resolves QA CP5 Critical Defect #2 ("@blitzy.com users DENIED writes through real Backstage endpoints"). Before this fix, internal plugin-to-plugin permission checks (e.g., catalog → permission) were denied for ALL users — including `@blitzy.com` — because the on-behalf-of token that the permission backend router constructs does NOT carry the user's original `email` claim. The decode in `policy.ts` returned `undefined`, the policy classified the user as non-Blitzy, and the write was denied.

The three pieces:

1. **The email cache** (`packages/backend/src/userEmailCache.ts`) — a module-scoped `Map<userEntityRef, email>` with FIFO eviction at 10,000 entries. The cache is process-local and reset on every backend restart; there is no persistence layer. Two functions are exported: `cacheUserEmail(userEntityRef, email)` and `lookupUserEmail(userEntityRef)`. The cache is intentionally simple — it is a memoization of the email claim across a user's authenticated session, not a database.
2. **The custom UserInfoService** (`packages/backend/src/userInfoServiceFactory.ts`) — registers a `BlitzyUserInfoService` that overrides the default `userInfoServiceFactory` from `@backstage/backend-defaults`. The custom service's `getUserInfo()` method reads the `email` claim from the credentials' JWT when present; when the on-behalf-of token has stripped the claim, it falls back to `lookupUserEmail(userEntityRef)`. The returned `BackstageUserInfo` includes an additional `email` field (typed as `BlitzyBackstageUserInfo = BackstageUserInfo & { email?: string }` via structural cast — the upstream interface does not declare `email`, but the policy reads it via the same structural cast pattern). This is the source of `user.info.email` that the policy reads as its PRIMARY path.
3. **The auth resolvers** (`packages/backend/src/authModuleGithubProvider.ts` and `packages/backend/src/authModuleBlitzyE2E.ts`) — both call `cacheUserEmail(userEntityRef, email)` AFTER successful `ctx.issueToken()` and BEFORE the auditor's `.success()` call. This dual-write populates the cache for the subsequent on-behalf-of permission-check path.

Why these three pieces and not a simpler design:

- **Why not just decode the on-behalf-of token in the policy?** The on-behalf-of token is minted by `auth.getPluginRequestToken({ onBehalfOf, targetPluginId })` and contains only `sub`, `ent`, `act`, `aud` — the user's original `email` claim is stripped. A decode at the policy is exactly what was failing before this fix.
- **Why not query the catalog for the user's email entity?** This would add a network round-trip to every permission check, breaking the policy's O(1) stateless contract and adding a hard dependency on the catalog backend being reachable at policy evaluation time.
- **Why not persist the cache?** A persistent cache would require a database, schema migrations, and cache invalidation logic. The in-process cache is good enough because (a) it is populated synchronously at sign-in, before any permission check can occur for the new session, and (b) a stale cache entry is harmless — the policy fails closed (DENY) when the email is missing, and the cache only grows monotonically until eviction.
- **Why FIFO eviction at 10,000 entries?** 10,000 simultaneous authenticated sessions exceeds Backstage's typical deployment scale by an order of magnitude. FIFO is the simplest eviction policy that bounds memory. LRU would be marginally better but adds bookkeeping cost on every lookup; for the cache's actual scale, FIFO is indistinguishable.

When you debug a permission denial:

1. First, verify the policy's `email` lookup path. The policy reads `user.info.email` FIRST (the custom user-info service's output) and falls back to `decodeJwt(user.credentials.token).email`. If `user.info.email` is missing, check the custom user-info service is registered in `packages/backend/src/index.ts` via `backend.add(blitzyUserInfoServiceFactory)` (the factory is exported from `userInfoServiceFactory.ts`).
2. Verify the cache is populated for the user. Add a temporary log statement in `userInfoServiceFactory.ts` showing `[userEntityRef, lookupResult]` to confirm the cache lookup is finding the user.
3. Verify the sign-in resolver populated the cache. Both `authModuleGithubProvider.ts` and `authModuleBlitzyE2E.ts` should log a `Cached email for <userEntityRef>` line at sign-in time. If it is missing, the resolver short-circuited before the cache write (e.g., `ctx.issueToken` threw, in which case the cache write is intentionally skipped).
4. Confirm the Prometheus counter `blitzy_permission_decisions_total` increments with `email_domain="blitzy.com"` rather than `"other"` for the affected user's writes. The bucket label is the unambiguous signal that the email was found.

The unit tests at `packages/backend/src/userInfoServiceFactory.test.ts` exercise the full JWT-then-cache path with a mocked discovery service. The unit tests at `packages/backend/src/userEmailCache.test.ts` exercise the FIFO eviction at the 10,000-entry boundary.

---

## 7. Audit Log Location

Audit events emitted by the `AuditorService` land in the backend's structured JSON log on stdout, correlated with the originating request's correlation ID. The default backend logger (`coreServices.logger`) routes audit channel records through Winston with JSON formatting, so events are greppable with standard CLI tools.

### 7.1 Filtering by event ID

```bash
yarn start 2>&1 | grep '"eventId":"user-login"'      # GitHub and Guest sign-ins
yarn start 2>&1 | grep '"eventId":"entity-access"'   # project (catalog entity) reads
```

`user-login` records contain `provider`, `username`, `emailDomain` (not the full email), and the resulting `userEntityRef`. `entity-access` records contain `entityRef`, the requesting `principal`, and the `action` (always `read` for the catalog access audit module).

### 7.2 Filtering by email domain

The policy emits `meta.emailDomain` rather than the full email address — the user-identifying portion is intentionally redacted from the audit channel to limit PII exposure. To list every entity access by a user whose domain is not `@blitzy.com`:

```bash
yarn start 2>&1 | grep '"emailDomain":' | grep -v '"emailDomain":"blitzy.com"'
```

The same pattern works for `user-login` events.

### 7.3 Mapping to Prometheus counters

The Prometheus exporter on `http://localhost:9464/metrics` surfaces the **auto-instrumented** HTTP, runtime, and process metrics out of the box (for example, `http_server_requests_total`, `http_server_request_duration_seconds_bucket`, `nodejs_eventloop_lag_seconds`, `process_resident_memory_bytes`). The audit channel itself remains the authoritative source of truth for sign-in and entity-access events at this checkpoint.

Three custom counters are planned to surface the audit volume directly as Prometheus time series:

- `blitzy_permission_decisions_total{result, email_domain, action}` — to be incremented inside `BlitzyPermissionPolicy.handle()` on every ALLOW or DENY decision
- `user_login_total{provider, email_domain}` — to be incremented inside the augmented GitHub `signInResolver` (and any future Guest provider augmentation) on every successful sign-in
- `entity_access_total{action}` — to be incremented inside the catalog access-audit middleware on every user-credentialed entity read

These counters are **NOT** emitted by the source code at this checkpoint and will return no rows from `curl :9464/metrics`. Their implementation is tracked in [`next-tasks.md`](next-tasks.md) entry 1 ("Wire the custom Prometheus counters documented in `docs/observability/dashboards.md` Section 4.3 into the actual emission sites"). Until they land, the Grafana dashboard panels that depend on them are marked as pending in [`../observability/dashboards.md`](../observability/dashboards.md) §6, and operator runbooks should join audit events to operational metrics via the structured-log channel and OpenTelemetry trace spans (which are emitted).

See [`../observability/dashboards.md`](../observability/dashboards.md) for the full metric inventory, the canonical metric names and label sets, and the Grafana dashboard import workflow.

### 7.4 Grafana dashboard

The repository ships a Grafana dashboard template at `docs/observability/dashboard-template.json`. Import it via Grafana's "Import Dashboard" UI (Dashboards → New → Import → Upload JSON), select your Prometheus datasource, and the dashboard renders panels for catalog query latency p50/p95/p99, HTTP error rate, and Node.js heap usage. Panels that depend on the custom counters listed in §7.3 will not display data until those counters are implemented (see [`next-tasks.md`](next-tasks.md) entry 1). The panel inventory and customization notes are in [`../observability/dashboards.md`](../observability/dashboards.md).

---

## 8. Common Pitfalls

The following issues account for most of the new-contributor support questions. Address them up front:

- **`permission.enabled` must be `true` in `app-config.yaml`.** Without this flag, the Backstage backend does not route requests through the `PermissionPolicy` at all, and `BlitzyPermissionPolicy.handle()` is never called. The audit events still emit, but the read-only enforcement is silently bypassed — a security regression. Verify the flag in the base `app-config.yaml` and in any per-environment override (`app-config.production.yaml`, `app-config.docker.yaml`, `app-config.railway.yaml`).
- **Backstage backend must run on Node 22 or 24.** Older Node versions (16, 18, 20) are unsupported by Backstage 1.48.0 and will fail at install or runtime. If `node --version` returns anything other than `v22.x` or `v24.x`, run `nvm use 22` before `yarn install` and `yarn start`.
- **Yarn 4 workspace commands.** Per-package commands use `yarn workspace <package-name> ...` syntax (for example, `yarn workspace @backstage/plugin-catalog test`). Plain `yarn test` runs across the root and may not isolate the workspace you intended.
- **Guest principal detection.** `BlitzyPermissionPolicy.handle()` checks `user?.principal?.type === 'guest'` (or by inspecting the entity ref). If a Guest somehow carries an `@blitzy.com` email in their claim (for example, spoofed during local testing), the principal-type check prevents elevation. Do NOT refactor the policy to short-circuit on email alone — the explicit Guest check is the security boundary.
- **LocalGCP must be running** before integration tests that exercise GCP services. If you see "connection refused" against ports 4443, 8085, or 8088, start LocalGCP via Option A (host binary) or Option B (Docker Compose) above. The `LOCALGCP_HOST` env var gates which suites attempt emulator-bound work.
- **Top-bar mount point.** The top-bar mounts into `Header.rightItemsBox`. If you remove or forget to register `appModuleTopBar` in the `features` array of `packages/app/src/App.tsx`, the right side of the header renders empty and the Logo, Settings, and Support items vanish — there is no fallback chrome. Add it back before opening a PR.
- **TechDocs is per-entity only after this refactor.** The global `/docs` index page was removed; TechDocs content is accessible only from an entity page (via the per-entity Documentation tab). Linking to `/docs` directly returns a 404 — link to the entity Documentation tab instead.

---

## 9. Production Deployment Hardening

The local-development defaults of the Backstage backend are tuned for developer ergonomics, not production security. Before promoting any build to a production environment (Railway, Fly.io, Docker, Kubernetes, etc.), apply the following checklist. Each item resolves a known information-disclosure or operational risk surfaced by QA Checkpoint 5.

### 9.1 Set `NODE_ENV=production`

The single most important deployment toggle. The Backstage backend's default error middleware emits full JavaScript stack traces (including absolute filesystem paths like `/tmp/blitzy/.../plugins/catalog-backend/src/service/AuthorizedRefreshService.ts:45:13`) in 4xx and 5xx response bodies when `NODE_ENV !== 'production'`. This is acceptable for local debugging and intentionally enabled for developer experience, but it leaks server-side implementation details that an attacker can use to fingerprint the deployment, locate vulnerable middleware versions, and craft targeted attacks. Set `NODE_ENV=production` in every production process manager:

```bash
# systemd / shell scripts
NODE_ENV=production node packages/backend/dist/index.cjs.js

# Dockerfile (verify Dockerfile.railway already sets this)
ENV NODE_ENV=production

# Railway, Fly.io, Vercel, etc.
# Set NODE_ENV=production in the platform's environment variable UI
```

Verify the suppression is active by issuing a deliberately failing request against the deployed backend and inspecting the response body:

```bash
# A request guaranteed to 401 (no Authorization header on a protected endpoint)
curl -s -i https://your-deployment.example.com/api/catalog/refresh \
     -X POST -H "Content-Type: application/json" \
     -d '{"entityRef":"component:default/test"}' \
     | tee /tmp/prod-error-response.txt

# Confirm the response body does NOT contain a "stack" field or absolute paths
grep -E '"stack"|/usr/|/app/|/tmp/' /tmp/prod-error-response.txt
# Expected: zero matches in production
```

The Dockerfile at `Dockerfile.railway` already exports `NODE_ENV=production` for Railway deployments. The development Dockerfile (`Dockerfile.dev`) deliberately does NOT — that image is intended for local container development and reproduces the developer-mode behavior. Confirm the production image is the one being deployed.

### 9.2 Disable the test-only `blitzy-e2e` auth provider

The custom `blitzy-e2e` auth provider (`packages/backend/src/authModuleBlitzyE2E.ts`) and its associated audit-events HTTP endpoint (`packages/backend/src/blitzyE2EAuditCapture.ts`) are gated behind the environment variable `BLITZY_E2E_TEST_MODE`. In production these MUST remain unset (or set to anything other than `true`). The provider issues tokens for arbitrary `email` and `username` values passed via HTTP headers — that is exactly the surface attackers look for. Confirm with `printenv | grep BLITZY_E2E_TEST_MODE` on the running container; the expected output is an empty string.

The audit-events HTTP endpoint at `/api/blitzy-e2e/audit-events` is registered via `createBackendPlugin({ pluginId: 'blitzy-e2e' })` and is also gated by the same env var. When the var is unset, the plugin is not added to the backend and the endpoint returns 404 — the desired production posture.

### 9.3 Verify Prometheus metrics endpoint is not publicly exposed

The OpenTelemetry Prometheus exporter binds to `:9464/metrics`. In production, this port should be bound to localhost only (or to a private network) so that only the metric scraper (Prometheus server, Grafana Cloud agent, Datadog agent, etc.) can reach it. Verify with `ss -tlnp | grep 9464` or `netstat -tlnp | grep 9464` on the production host — the bind address should be `127.0.0.1:9464` or a private interface, never `0.0.0.0:9464`. The exporter currently emits histogram buckets that label by `email_domain` (`blitzy.com`, `other`, `guest`) and `action` — these labels are PII-safe (no email addresses), but exposure of the volume itself reveals the user population size to anyone who can scrape the endpoint.

### 9.4 Audit log retention and rotation

Audit events are emitted to stdout via `coreServices.logger`. Production deployments MUST capture stdout to a durable log destination (Cloud Logging, Splunk, Datadog, ELK, etc.) and apply a retention policy that satisfies the organization's compliance posture. The default container runtime (Docker, containerd, Kubernetes) captures stdout but applies its own rotation that may discard events. Verify the log shipping pipeline is configured to capture lines matching `"isAuditEvent":true` (the AuditorService channel marker) or `"eventId":"user-login"|"entity-access"|"entity-mutate"` (the specific event IDs) BEFORE any rotation discards them.

### 9.5 JWT secret material

Backstage backend secret material (the signing key for the identity tokens that carry the `email` claim and drive the permission policy) must be loaded from `app-config.production.yaml`'s `backend.auth.keys` array — not from the in-repo `app-config.yaml`. Verify with `grep -A3 'auth:' app-config.production.yaml` on the production deployment; the entries should reference environment variables (`${BACKEND_SECRET}` style) rather than literal strings. Rotate keys per the organization's policy; the policy and audit emission paths are agnostic to key rotation because they read pre-verified tokens.

### 9.6 Email cache memory bound

The email cache at `packages/backend/src/userEmailCache.ts` is bounded at 10,000 entries with FIFO eviction. Production deployments serving more than 10,000 simultaneously authenticated users will see cache thrash — older sessions' emails are evicted, and the next on-behalf-of permission check for those users will fall through to the JWT decode (which fails for the email-stripped on-behalf-of token), resulting in DENY for legitimate users. If the deployment serves more than 10,000 simultaneous sessions, raise the constant `MAX_CACHE_ENTRIES` in `userEmailCache.ts` and rebuild. The memory cost is approximately 0.5 KB per entry, so 10,000 entries cost ~5 MB; 100,000 would cost ~50 MB.

### 9.7 LocalGCP must NOT be used in production

The LocalGCP emulator (Section 2 above) is for local development and CI only. Production deployments that exercise GCS, Pub/Sub, or Firestore MUST use real GCP service endpoints with real credentials. Confirm `STORAGE_EMULATOR_HOST`, `PUBSUB_EMULATOR_HOST`, and `FIRESTORE_EMULATOR_HOST` are unset in production with `printenv | grep -E 'EMULATOR_HOST'` — the expected output is empty.

---

## 10. See also

- [`decision-log.md`](decision-log.md) — Why each non-trivial refactor choice was made.
- [`traceability-matrix.md`](traceability-matrix.md) — Requirement to file and test mapping.
- [`architecture-before-after.md`](architecture-before-after.md) — Mermaid diagrams of the chrome and permission layers.
- [`next-tasks.md`](next-tasks.md) — Discovered improvements out of current PR scope.
- [`../getting-started.md`](../getting-started.md) — User-facing portal navigation guide (updated in this PR).
- [`../index.md`](../index.md) — Documentation tree landing page (updated in this PR).
- [`../observability/dashboards.md`](../observability/dashboards.md) — Logs, traces, metrics, Grafana dashboards.
- [`../auth/identity-resolver.md`](../auth/identity-resolver.md) — Identity resolver patterns and the augmented GitHub `signInResolver`.
- [`../auth/github/provider.md`](../auth/github/provider.md) — GitHub auth provider configuration.
- [`../permissions/writing-a-policy.md`](../permissions/writing-a-policy.md) — Upstream Backstage permission policy authoring guide.
