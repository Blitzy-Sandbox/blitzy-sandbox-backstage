# Getting Started

## Navigating the Portal

### Landing Page

The root URL `/` automatically redirects to `/catalog`. The catalog is the landing page of the portal — there is no dashboard or welcome page. Open the portal at `http://localhost:3000/` and you will be taken directly to the catalog of Blitzy-generated projects.

### Navigation Bar (Top-Right Cluster)

Primary navigation lives in the top-right corner of every page header:

- **Blitzy logo** — A non-interactive brand mark (no link, no click target).
- **Settings** — A gear icon that takes you to `/settings` for account preferences, theme, and feature flags.
- **Support** — A help icon that opens a popover with the GitHub Issues link and the official Blitzy support email: `support@blitzy.com`.

There is no left-rail menu. All navigation between top-level pages happens through the catalog (use the catalog's filters and entity links to drill into projects). For visual diagrams of the chrome before and after the refactor, see `docs/refactor/architecture-before-after.md`.

### Software Catalog

The catalog page lists all registered components. Use the filter chips on the left side of the catalog page to narrow the results by:

- **Kind** — Component, System, Group, API
- **Type** — website, library, service
- **Tags** — typescript, rust, python, go, etc.
- **Tag intersection (AND logic)** — When you select two or more tags, the displayed count at the top of the table matches the number of entities that have **all** selected tags (intersection), aligned with the rendered row count.

### Viewing a Project

Click any component to see its detail page:

- **Overview** — Description, metadata, links to GitHub
- **TechDocs** — Auto-generated documentation (if the repo has `mkdocs.yml`)
- **Dependencies** — Related systems and APIs

Each project's overview displays the project's display name only — the favorite (star) icon, System link, and Owner link have been removed in favor of a cleaner header (see `docs/refactor/architecture-before-after.md`). TechDocs are accessible **per entity** via the Documentation tab on the project entity page; there is no global Documentation index in the navigation anymore.

### Search

Use the search bar (or press `/`) to search across all catalog entities and documentation.

## Authentication & Authorization

The portal supports two sign-in methods, and applies a domain-based authorization policy on top of authentication:

1. **GitHub OAuth** — Sign in with your GitHub account. The portal extracts your verified GitHub primary email and uses its domain to authorize write actions.
2. **Guest access** — Browse the catalog without signing in. Guest sessions are constrained to read-only.

**Authorization posture (BlitzyPermissionPolicy):**

- **Read actions** (browsing the catalog, viewing entity details, searching, reading TechDocs) — allowed for all authenticated users and for Guest.
- **Write/edit actions** (refreshing entities, registering new locations, updating annotations, deleting entities) — allowed only when your verified GitHub email ends in `@blitzy.com`. Non-`@blitzy.com` users and Guest sessions receive a permission-denied response.

For details on writing or customizing the policy, see `docs/refactor/onboarding-addendum.md` (Policy Customization section) and the upstream Backstage permission framework docs at `docs/permissions/writing-a-policy.md`.

## Audit Trail

The backend emits structured audit events through Backstage's `AuditorService`:

- `user-login` — Recorded on every sign-in (GitHub or Guest). Metadata includes the provider (`github` or `guest`), username, and email domain.
- `entity-access` — Recorded on every project (catalog entity) read by a user-credentialed request. Metadata includes the entity reference, principal, and action.

Audit events appear in the backend's structured JSON log on stdout and are correlated with the request's correlation ID. For dashboards, Prometheus counters, and Grafana imports, see `docs/observability/dashboards.md`.

## See also

- **Architecture (before / after the refactor):** `docs/refactor/architecture-before-after.md`
- **Decision Log (why each refactor choice was made):** `docs/refactor/decision-log.md`
- **Traceability Matrix (requirement → file/test):** `docs/refactor/traceability-matrix.md`
- **Onboarding Addendum (clean-machine setup, LocalGCP, policy customization):** `docs/refactor/onboarding-addendum.md`
- **Next Tasks (discovered improvements):** `docs/refactor/next-tasks.md`
- **Observability (logs, traces, metrics, dashboards):** `docs/observability/dashboards.md`
- **Authentication providers and identity resolvers:** `docs/auth/index.md`, `docs/auth/identity-resolver.md`, `docs/auth/github/provider.md`
