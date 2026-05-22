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

This is the path documented in the user-provided environment instructions and matches the verified setup status log of this repository:

```bash
curl -LO https://github.com/slokam-ai/localgcp/releases/latest/download/localgcp-linux-amd64
sudo install localgcp-linux-amd64 /usr/local/bin/localgcp
localgcp up --data-dir=./.localgcp &
sleep 3
```

The `--data-dir=./.localgcp` directory is gitignored at the repository root. The `&` backgrounds the emulator so the shell remains usable. `sleep 3` allows the gRPC and REST listeners to come online before the first SDK call.

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
- `FIRESTORE_EMULATOR_HOST` — defaults to `localhost:8080`. Consumed by `@google-cloud/firestore` clients directly.
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

The current refactor does **not** introduce new GCS code paths; the workaround is preserved as a constraint for any future code (for example, a TechDocs publisher reconfigured to use GCS) that exercises the emulator. See entry 6 in [`next-tasks.md`](next-tasks.md) regarding adding a CI step that boots LocalGCP and runs GCS-touching integration tests.

---

## 4. `PUBSUB_EMULATOR_HOST` and `FIRESTORE_EMULATOR_HOST`

Unlike `@google-cloud/storage` v7, the `@google-cloud/pubsub` and `@google-cloud/firestore` SDKs honor their respective `PUBSUB_EMULATOR_HOST` and `FIRESTORE_EMULATOR_HOST` environment variables directly. No constructor injection or per-call option override is required — the SDKs detect the variables at module load and route gRPC traffic to the emulator.

To start the backend with all three emulator variables set in one line:

```bash
STORAGE_EMULATOR_HOST=http://localhost:4443 PUBSUB_EMULATOR_HOST=localhost:8085 FIRESTORE_EMULATOR_HOST=localhost:8080 yarn start
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

Audit events are emitted via the injected `auditor` service. Construct the event with `auditor.createEvent({ eventId: 'entity-access', severityLevel: 'low', request, meta: { entityRef, principal, action: 'read' } })`, then call `.success({ meta })` on success or `.fail({ error, meta })` on failure paths so the audit log captures the failure mode. To add an `entity-write` event when a future workstream introduces write paths through the policy, see entry 4 in [`next-tasks.md`](next-tasks.md) for the suggested approach.

### 6.5 Registering a different policy module

The policy is wired in `packages/backend/src/index.ts` via `backend.add(import('@internal/plugin-permission-backend-module-blitzy-policy'))`. To swap policies (for example, back to `allow-all` for a debug session), comment out the Blitzy module line and uncomment the `allow-all` line (or replace with another module). Only one `PermissionPolicy` may be registered at a time — registering both produces a startup error. The catalog access audit module is registered separately at `backend.add(import('@internal/plugin-catalog-backend-module-access-audit'))`. These two modules are independent — swapping the policy does not change audit emission, and disabling the audit module does not change permission decisions.

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

The Prometheus exporter on `http://localhost:9464/metrics` surfaces the audit volume as three counter families:

- `user_login_total{provider, email_domain}` — incremented on every successful sign-in
- `entity_access_total{kind}` — incremented on every catalog entity read
- `permission_decisions_total{result, email_domain, action}` — incremented on every policy decision (ALLOW or DENY)

See [`../observability/dashboards.md`](../observability/dashboards.md) for the full metric inventory and the Grafana dashboard import workflow.

### 7.4 Grafana dashboard

The repository ships a Grafana dashboard template at `docs/observability/dashboard-template.json`. Import it via Grafana's "Import Dashboard" UI (Dashboards → New → Import → Upload JSON), select your Prometheus datasource, and the dashboard renders panels for audit events per minute, permission decisions by result, catalog query latency p50/p95/p99, HTTP error rate, and Node.js heap usage. The panel inventory and customization notes are in [`../observability/dashboards.md`](../observability/dashboards.md).

---

## 8. Common Pitfalls

The following issues account for most of the new-contributor support questions. Address them up front:

- **`permission.enabled` must be `true` in `app-config.yaml`.** Without this flag, the Backstage backend does not route requests through the `PermissionPolicy` at all, and `BlitzyPermissionPolicy.handle()` is never called. The audit events still emit, but the read-only enforcement is silently bypassed — a security regression. Verify the flag in the base `app-config.yaml` and in any per-environment override (`app-config.production.yaml`, `app-config.docker.yaml`, `app-config.railway.yaml`).
- **Backstage backend must run on Node 22 or 24.** Older Node versions (16, 18, 20) are unsupported by Backstage 1.48.0 and will fail at install or runtime. If `node --version` returns anything other than `v22.x` or `v24.x`, run `nvm use 22` before `yarn install` and `yarn start`.
- **Yarn 4 workspace commands.** Per-package commands use `yarn workspace <package-name> ...` syntax (for example, `yarn workspace @backstage/plugin-catalog test`). Plain `yarn test` runs across the root and may not isolate the workspace you intended.
- **Guest principal detection.** `BlitzyPermissionPolicy.handle()` checks `user?.principal?.type === 'guest'` (or by inspecting the entity ref). If a Guest somehow carries an `@blitzy.com` email in their claim (for example, spoofed during local testing), the principal-type check prevents elevation. Do NOT refactor the policy to short-circuit on email alone — the explicit Guest check is the security boundary.
- **LocalGCP must be running** before integration tests that exercise GCP services. If you see "connection refused" against ports 4443, 8085, or 8080, start LocalGCP via Option A (host binary) or Option B (Docker Compose) above. The `LOCALGCP_HOST` env var gates which suites attempt emulator-bound work.
- **Top-bar mount point.** The top-bar mounts into `Header.rightItemsBox`. If you remove or forget to register `appModuleTopBar` in the `features` array of `packages/app/src/App.tsx`, the right side of the header renders empty and the Logo, Settings, and Support items vanish — there is no fallback chrome. Add it back before opening a PR.
- **TechDocs is per-entity only after this refactor.** The global `/docs` index page was removed; TechDocs content is accessible only from an entity page (via the per-entity Documentation tab). Linking to `/docs` directly returns a 404 — link to the entity Documentation tab instead.

---

## 9. See also

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
