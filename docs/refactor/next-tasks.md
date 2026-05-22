# Next Tasks — Discovered Improvements Out of Scope

This document lists improvements that were discovered during the Blitzy Sandbox Backstage refactor (sidebar removal, top-bar chrome, read-only enforcement, audit emission, catalog count fix) but are **intentionally out of scope** of this pull request. They are captured per **Rule R2 — Onboarding & Continued Development** of the Agent Action Plan so that future contributors can pick them up without rediscovering the ideas.

Each item has:

- **Description** — what the improvement does and why it matters.
- **Priority** — `low`, `medium`, or `high` based on user impact and risk.
- **Suggested approach** — a concrete starting point for the implementer.

See also: [`decision-log.md`](decision-log.md), [`onboarding-addendum.md`](onboarding-addendum.md), [`architecture-before-after.md`](architecture-before-after.md), [`traceability-matrix.md`](traceability-matrix.md).

---

## How priorities were assigned

The priority labels in this list follow a deliberate rubric so that anyone extending the list later can stay consistent:

- `high` — closes a logical or security gap introduced by this refactor. The change is bounded, mechanical, and unblocks downstream work. Only Entry 5 (`entity-write` audit event) carries this priority, because the audit trail this PR establishes is asymmetric without it.
- `medium` — improves the platform but is not blocking. Either it wires planned observability instrumentation (Entry 1), closes a pending unit-test gap (Entry 8), advances an in-flight migration (Entry 2), adds observability depth (Entry 4), or hardens CI infrastructure (Entry 7).
- `low` — net-new feature work or hygiene with a limited blast radius. Entries 3, 6, and 9 fall here.

When you add a new entry, ask whether the item closes a gap this refactor introduced (then `high`), improves the platform without blocking (`medium`), or is net-new optional work (`low`). Record the rationale inline in the entry's Description so reviewers can validate the call.

---

## 1. Wire the custom Prometheus counters into their planned emission sites

- **Description:** The refactor's observability story (per Rule R1) documents three custom Prometheus counters — `user_login_total{provider, email_domain}`, `entity_access_total{action}`, and `blitzy_permission_decisions_total{result, email_domain, action}` — as the operator's quantitative view of sign-in volume, project-access volume, and policy decisions. The Grafana dashboard template at [`../observability/dashboard-template.json`](../observability/dashboard-template.json) ships with panels that query these counters by name. As of this checkpoint, **no source code in this repository registers or increments these counters**: `plugins/permission-backend-module-blitzy-policy/src/policy.ts`, `packages/backend/src/authModuleGithubProvider.ts`, and `plugins/catalog-backend-module-access-audit/src/module.ts` all emit audit events via `coreServices.auditor` but no `@opentelemetry/api-metrics` import or `Counter.add(...)` call has been wired. Until the counters land, the corresponding dashboard panels render "No data" and operators must consume sign-in / entity-access signals from the structured audit log channel. Closing this gap is a `medium`-priority follow-up because the gap is observability-only (the audit trail itself is intact) and the scope is mechanical: add three counter registrations and the increment call sites. The canonical names, label sets, and label-value vocabularies are documented in [`../observability/dashboards.md`](../observability/dashboards.md) §4.3 so the implementation, dashboard template, and operator runbooks converge on a single contract.
- **Priority:** `medium`
- **Suggested approach:** In `packages/backend/src/instrumentation.js`, import `metrics` from `@opentelemetry/api` (or install `@opentelemetry/api-metrics` if the repository hasn't picked it up — verify with `yarn workspace backend why @opentelemetry/api-metrics` first), and obtain a `Meter` via `metrics.getMeter('blitzy-backstage')`. Add three counter registrations to a shared module (for example, a new `packages/backend/src/metrics.ts`) and export them:

  ```ts
  export const userLoginTotal = meter.createCounter('user_login_total', {
    description:
      'GitHub user sign-in events recorded by the augmented signInResolver.',
  });
  export const entityAccessTotal = meter.createCounter('entity_access_total', {
    description:
      'Catalog single-entity reads recorded by the access-audit middleware.',
  });
  export const blitzyPermissionDecisionsTotal = meter.createCounter(
    'blitzy_permission_decisions_total',
    {
      description:
        'Permission policy ALLOW/DENY decisions recorded by BlitzyPermissionPolicy.handle().',
    },
  );
  ```

  Wire the increment calls at the three emission sites:

  1. `packages/backend/src/authModuleGithubProvider.ts` — call `userLoginTotal.add(1, { provider: 'github', email_domain })` immediately before the existing `auditor.createEvent(...).success(...)` line; on the failure path, call it with `email_domain: 'unknown'` next to the `auditor.createEvent(...).fail(...)` line.
  2. `plugins/catalog-backend-module-access-audit/src/module.ts` — call `entityAccessTotal.add(1, { action: 'read' })` inside the finalize callback that emits the `entity-access` event, before the `auditor.createEvent(...).success(...)` / `.fail(...)` branch.
  3. `plugins/permission-backend-module-blitzy-policy/src/policy.ts` — call `blitzyPermissionDecisionsTotal.add(1, { result, email_domain, action })` at the end of `handle()` before returning the `PolicyDecision`. Derive `email_domain` via the same `bucketEmailDomain()` helper documented in [`../observability/dashboards.md`](../observability/dashboards.md) §4.3 to ensure label values stay in the `{ blitzy.com, other, guest }` set and never leak PII.

  Re-run the local verification recipe in [`../observability/dashboards.md`](../observability/dashboards.md) §8: after `yarn dev`, sign in via GitHub and click into a project; `curl http://localhost:9464/metrics | grep -E '^(user_login_total|entity_access_total|blitzy_permission_decisions_total)'` should print three counter families. Import the dashboard template at `docs/observability/dashboard-template.json` and confirm the previously-empty panels render data. Add a Jest test under each of the three plugins asserting that the counter is incremented once per emission path (use the `@opentelemetry/sdk-metrics`'s `InMemoryMetricExporter` test harness, or stub the counter in the test).

## 2. Complete the MUI-to-shadcn migration for the catalog plugin

- **Description:** The Blitzy Sandbox is mid-migration from Material-UI v4 to shadcn/ui. The tracking metric in [`../index.md`](../index.md) reports 88.8% of 154 plugins migrated, and the catalog plugin family is among the remaining 11.2%. MUI v4 components still ship inside `plugins/catalog/`, `plugins/catalog-react/`, and `plugins/catalog-graph/`, which means the largest plugin family still pulls in the legacy styling layer. Completing the migration unifies the visual language with the rest of the portal and lets the MUI v4 peer dependency be dropped from the catalog packages. The current refactor intentionally avoided advancing the migration to keep the diff focused on the requested user-facing changes (see AAP §0.3.2).
- **Priority:** `medium`
- **Suggested approach:** Run the existing `mui-to-bui` codemod against the three catalog packages in dependency order — `plugins/catalog-react/` first (lowest-level primitives), then `plugins/catalog/`, then `plugins/catalog-graph/`. The dependency ordering matters because consumer packages can re-render only after the primitives they import expose the new shadcn API surface.

  After each package, run `yarn workspace <pkg> test` and `yarn workspace <pkg> build` to catch breakage early. Regenerate the visual regression baselines under `packages/app/e2e-tests/__screenshots__/` once the surface stabilizes, and update the 88.8% / 154 metric in [`../index.md`](../index.md) when the catalog family crosses 100%.

## 3. Replace TechDocs with first-party documentation rendering

- **Description:** TechDocs is the per-entity documentation system inherited from upstream Backstage. It depends on a MkDocs build step plus an internal builder/publisher pipeline. After the global Documentation tab was removed in this refactor, only the per-entity Documentation tab remains, which narrows the surface that TechDocs needs to serve. Swapping the per-entity renderer for a first-party shadcn-based Markdown renderer would remove the MkDocs dependency, shrink the publisher/builder pipeline, and align the docs styling with the rest of the portal.
- **Priority:** `low`
- **Suggested approach:** Prototype an in-repo Markdown renderer that reads `docs/` folders directly from each entity's source repository, bypassing the MkDocs build step entirely. Run a side-by-side spike of MkDocs Material against the shadcn-based candidate to compare layout fidelity, search, and admonition support. Maintain backward compatibility with the existing `backstage.io/techdocs-ref` annotation so already-onboarded projects continue to render without recataloging. Coordinate the cutover with the `EntityTechdocsContent` extension currently registered in `packages/app/src/App.tsx` so the per-entity Documentation tab keeps mounting through the same route.

## 4. Expand the audit dashboard with per-user breakdowns

- **Description:** The Grafana dashboard template introduced by this refactor (`docs/observability/dashboard-template.json`) reports counters at the aggregate level — `user_login_total`, `entity_access_total`, `permission_denied_total`. Administrators investigating an incident currently have to correlate stdout audit JSON manually to identify which principal triggered which event. Adding per-user breakdowns to the dashboard would close that gap, but the implementation has to avoid leaking PII into Prometheus labels, which are stored, scraped, and exported broadly. This entry assumes the planned counters from Entry 1 have landed; otherwise the per-user breakdown work is a no-op against empty time series.
- **Priority:** `medium`
- **Suggested approach:** Add a panel that groups `entity_access_total` by an `email_domain` label rather than by the full email or `userEntityRef`. The `BlitzyPermissionPolicy` already derives the email domain from the custom JWT `email` claim (see `Technical Specifications.md` IR-2), so the label is available at the call site without an additional lookup. Avoid emitting raw email or `userEntityRef` as a Prometheus label — that combination would be both high-cardinality and PII-sensitive. Document the new panel in [`../observability/dashboards.md`](../observability/dashboards.md) alongside the existing metric catalog.

## 5. Add an `entity-write` audit event type

- **Description:** This refactor emits `user-login` and `entity-access` audit events. There is no symmetrical `entity-write` event for catalog mutations (create / update / delete) that the policy allows. As a result, the audit trail captures who signed in and what they read, but not what they changed. Administrators need a complete view of mutations to investigate incidents, satisfy compliance, and reconstruct change history. Closing this gap is the highest-priority follow-up on this list because it directly extends the security posture that this PR introduces.
- **Priority:** `high`
- **Suggested approach:** In `plugins/permission-backend-module-blitzy-policy/src/policy.ts`, after `handle()` returns `ALLOW` for a write action against a `@blitzy.com` principal, call `auditor.createEvent({ eventId: 'entity-write', severityLevel: 'medium', request, meta: { permission: permission.name, principal: userEntityRef, action: 'write' } }).success()`. Inject `coreServices.auditor` via the module's `deps` block in `module.ts`.

  Add an `entity_write_total` counter panel to `docs/observability/dashboard-template.json` and describe the new event in [`../observability/dashboards.md`](../observability/dashboards.md). Extend the policy unit tests to assert both the `ALLOW` decision and the audit emission; keep coverage above the >80% threshold required for authorization logic.

## 6. Integrate the access audit into an in-app admin UI surface

- **Description:** Audit events currently land in stdout as structured JSON and (once Entry 1 lands) in Prometheus counters scraped at `:9464/metrics`. There is no in-portal UI to browse them, which means administrators have to attach to backend logs or open Grafana to see who accessed what. An `/admin/audit` page would let `@blitzy.com` administrators inspect recent sign-ins and entity accesses inline. This is the heaviest item on the list because it introduces a new plugin, a new backend endpoint, and a new permission surface.
- **Priority:** `low`
- **Suggested approach:** Create a new `plugins/audit/` frontend plugin registering a route at `/admin/audit`. Pair it with a backend endpoint at `/api/audit/events` that streams from the auditor service's log channel (or from a dedicated event sink, to be designed). Gate the route with either `<RequirePermission permission={catalogEntityCreatePermission} />` to inherit the `@blitzy.com`-only enforcement transitively, or define a dedicated `auditViewPermission` and extend `BlitzyPermissionPolicy.handle()` to allow it for `@blitzy.com` principals only. Document the new permission in [`decision-log.md`](decision-log.md) when added.

## 7. Add a per-environment LocalGCP step to CI

- **Description:** Rule R6 (LocalGCP Verification) requires that integration tests run against the LocalGCP emulators rather than against live GCP. This refactor adds the `docker-compose.localgcp.yml` compose file but does not modify `.github/workflows/ci.yml` to start the emulators automatically. Local developers can already spin LocalGCP up via the steps in [`onboarding-addendum.md`](onboarding-addendum.md), but CI relies on developers remembering to enable a matrix flag. Wiring LocalGCP into the CI workflow closes that gap so future tests against GCS, Pub/Sub, or Firestore run by default without per-PR setup.
- **Priority:** `medium`
- **Suggested approach:** Add either a `services:` block or a `docker compose -f docker-compose.localgcp.yml up -d` step to the `jobs.build.steps` array in `.github/workflows/ci.yml`, with a matching teardown step. Gate the step behind `if: matrix.localgcp == true` initially so only the integration-test matrix entry pays the startup cost; the lint and unit matrix entries should stay lightweight.

  Document the env vars (`STORAGE_EMULATOR_HOST`, `PUBSUB_EMULATOR_HOST` (port 8085), `FIRESTORE_EMULATOR_HOST` (port 8088)) the tests depend on in the workflow comments so future contributors can correlate test failures back to the emulator state. See [`onboarding-addendum.md`](onboarding-addendum.md) for the local-development equivalent.

## 8. Add the access-audit middleware plugin-local unit test

- **Description:** The `plugins/catalog-backend-module-access-audit/` plugin was created in this refactor to emit `entity-access` audit events whenever a user-credentialed entity read passes through the catalog backend. The plugin's behavior is covered today by E2E tests (`packages/app/e2e-tests/auditing.test.ts`) and by the integration assertions in the catalog backend itself, but the plugin's own unit-test file (`plugins/catalog-backend-module-access-audit/src/module.test.ts`) was not created in this PR. Several documentation artifacts originally listed this file as if it existed; those references have since been corrected to point at this entry. Adding the plugin-local unit test closes the symmetry gap with the sibling `plugins/permission-backend-module-blitzy-policy/src/policy.test.ts` and gives module authors a fast inner-loop test target that does not require booting the full backend.
- **Priority:** `medium`
- **Suggested approach:** Create `plugins/catalog-backend-module-access-audit/src/module.test.ts` using the Backstage `mockServices` pattern (`@backstage/backend-test-utils`). Mock `coreServices.auditor`, `coreServices.httpAuth`, and the `catalogServiceRef` ref. Assert that a single-entity read through the wrapped catalog service emits exactly one `auditor.createEvent({ eventId: 'entity-access', ... })` call, that `.success({ meta: { entityRef, principal, action: 'read' } })` is invoked, and that requests without a user principal (service-to-service) do not emit an audit event. Aim for ≥80% statement coverage on `module.ts`, matching the AAP standard for audit-emission logic. Cross-link the new test from [`traceability-matrix.md`](traceability-matrix.md) once committed.

## 9. Drop the `homePlugin` workspace dependency

- **Description:** This refactor removed the `homePlugin` registration from `packages/app/src/App.tsx` because Catalog is now the landing page. The `@backstage/plugin-home` package nevertheless remains in the workspace dependency closure because other Backstage plugins may still re-export from it transitively. A future audit can confirm there are no remaining callsites in `packages/app/` or in any local plugin and drop the workspace pin entirely, shrinking the install surface and removing a now-unused dependency from the dependency graph.
- **Priority:** `low`
- **Suggested approach:** Run `grep -rn "@backstage/plugin-home" packages/ plugins/` to enumerate remaining imports. If only transitive re-exports remain (no direct imports outside `plugin-home-react` or other home-family packages), remove `@backstage/plugin-home` from `packages/app/package.json` and run `yarn install`, `yarn test:all`, and `yarn build:all` to confirm nothing breaks. If callsites remain, list them in this entry and reduce the priority to reflect the increased work.

---

## See also

- [`decision-log.md`](decision-log.md) — Decisions made for each non-trivial choice in this refactor.
- [`traceability-matrix.md`](traceability-matrix.md) — Bidirectional map of user requirements to files and tests.
- [`architecture-before-after.md`](architecture-before-after.md) — Mermaid diagrams of the chrome and permission layers.
- [`onboarding-addendum.md`](onboarding-addendum.md) — Clean-machine setup, LocalGCP, and customization guides.
- [`../observability/dashboards.md`](../observability/dashboards.md) — Logs, traces, metrics, dashboards.
