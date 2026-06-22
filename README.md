<!-- Shields bar -->

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stars][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![License][license-shield]][license-url]
[![CI][ci-shield]][ci-url]

<!-- Project header -->
<div align="center">
  <a href="https://backstage.io/">
    <img src="docs/assets/header.png" alt="Blitzy Backstage" />
  </a>
  <h1>Blitzy Backstage</h1>
  <p>Blitzy's internal developer portal — a customized fork of <a href="https://backstage.io">Backstage</a> providing a unified service catalog, scaffolder, TechDocs, and developer tooling for the Blitzy platform.</p>
  <a href="https://github.com/Blitzy-Sandbox/blitzy-sandbox-backstage"><strong>Explore the docs</strong></a>
  &middot;
  <a href="https://github.com/Blitzy-Sandbox/blitzy-sandbox-backstage/issues/new?labels=bug">Report Bug</a>
  &middot;
  <a href="https://github.com/Blitzy-Sandbox/blitzy-sandbox-backstage/issues/new?labels=enhancement">Request Feature</a>
</div>

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about-the-project">About The Project</a></li>
    <li><a href="#built-with">Built With</a></li>
    <li><a href="#getting-started">Getting Started</a></li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#structure">Structure</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

---

## About The Project

**Blitzy Backstage** is Blitzy's customized fork of the [Backstage](https://backstage.io) open-source developer portal. It serves as the internal developer platform for the Blitzy organization, providing:

- **Software Catalog** — unified registry of all services, APIs, libraries, and infrastructure components, with GitHub and GitHub Org entity providers
- **Scaffolder** — self-service templates for spinning up new projects following Blitzy's standards
- **TechDocs** — documentation-as-code integrated directly with the service catalog
- **Search** — cross-catalog full-text search, with optional Elasticsearch backend
- **Auth** — GitHub OAuth and Guest sign-in; OpenShift provider available
- **Notifications & Signals** — real-time alerts and event-driven messages across the portal
- **PR Review Plugin** — custom Blitzy plugin for surfacing pull request status in the portal

The portal runs on a **TypeScript monorepo** (~970k lines, 10k+ files) using Yarn workspaces. The frontend uses Backstage's new Declarative Integration system; the backend uses the new plugin-as-service DI model.

### Chrome and Landing Page

The Blitzy fork has refactored the application chrome and landing page. The current source state is:

- The left sidebar has been replaced with a **top-right cluster** containing a non-clickable Blitzy logo, a Settings icon button linking to `/settings`, and a Support button that surfaces `support@blitzy.com`. The cluster is mounted in `packages/app/src/modules/appModuleTopBar.tsx` via `NavContentBlueprint` and an `app/layout` extension override (see `blitzy/documentation/Technical Specifications.md` Implementation Reality Addendum entry IR-3 for the as-implemented blueprint choice).
- `/catalog` is the application landing page; the bare URL `/` redirects to `/catalog`, and the previous Dashboard / Home landing page has been removed.
- Per-entity TechDocs is preserved; the global `/docs` index has been removed.

See the **Refactor Documentation** section below for the decision log, traceability matrix, and architecture-before/after diagrams.

## Built With

[![TypeScript][typescript-shield]][typescript-url]
[![React][react-shield]][react-url]
[![Node.js][node-shield]][node-url]
[![Tailwind CSS][tailwind-shield]][tailwind-url]
[![Yarn][yarn-shield]][yarn-url]
[![SQLite][sqlite-shield]][sqlite-url]
[![Docker][docker-shield]][docker-url]

## Getting Started

### Prerequisites

- **Node.js** 20 or later
- **Yarn** 4 (`corepack enable && corepack prepare yarn@stable --activate`)
- **Git**
- (Optional) **Docker** for containerized deployments

### Installation

1. Clone the repository:

   ```sh
   git clone git@github.com:Blitzy-Sandbox/blitzy-sandbox-backstage.git
   cd blitzy-sandbox-backstage
   ```

2. Install dependencies:

   ```sh
   yarn install
   ```

3. Configure local overrides:

   ```sh
   cp app-config.yaml app-config.local.yaml
   # Edit app-config.local.yaml — set GITHUB_TOKEN, auth credentials, etc.
   ```

4. Start the development servers (frontend + backend):
   ```sh
   yarn start
   ```
   This invokes `backstage-cli repo start`, which boots the frontend (`packages/app`) and the backend (`packages/backend`, workspace name `example-backend`) together. The app will be available at `http://localhost:3000` and the backend at `http://localhost:7007`.

### Environment Setup

Key config values (set in `app-config.local.yaml` or as environment variables):

| Variable                    | Purpose                                                         |
| --------------------------- | --------------------------------------------------------------- |
| `GITHUB_TOKEN`              | GitHub PAT for catalog entity ingestion and the GitHub provider |
| `AUTH_GITHUB_CLIENT_ID`     | GitHub OAuth App client ID                                      |
| `AUTH_GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret                                  |
| `BACKEND_SECRET`            | Shared secret for backend service-to-service auth               |

## Usage

### Running in Development

```sh
# Start frontend and backend together (canonical local-dev launcher,
# invokes `backstage-cli repo start` against both packages)
yarn start

# Backend only (run the example-backend workspace directly)
yarn start example-backend
# equivalently: yarn workspace example-backend start
```

Note: the legacy `yarn dev` and `yarn start-backend` scripts in `package.json`
are deprecation stubs that only print a pointer to the commands above; they do
not start any service themselves. The canonical entry points are `yarn start`
(frontend + backend together) and `yarn start example-backend` (backend only).

### Building for Production

```sh
# Build all workspaces (frontend + backend + plugins) via the Backstage CLI
yarn build:all

# Or build only the backend workspace bundle
yarn build:backend
```

Note: there is no root-level `yarn build` script; the canonical entry point is
`yarn build:all`, which delegates to `backstage-cli repo build --all`.

### Running Tests

```sh
# All tests
yarn test:all

# A single package
yarn workspace @backstage/plugin-catalog test
```

### Linting & Type Checks

```sh
yarn lint:all
yarn tsc
```

### Adding a New Plugin

```sh
# Scaffold a new backend plugin
yarn backstage-cli new --select backend-plugin

# Scaffold a new frontend plugin
yarn backstage-cli new --select plugin
```

Register the backend plugin in `packages/backend/src/index.ts` and the frontend plugin in `packages/app/src/App.tsx`.

## Structure

```
blitzy-backstage/
├── packages/
│   ├── app/                    # Frontend app (Declarative Integration system)
│   ├── app-legacy/             # Legacy frontend (being deprecated)
│   ├── backend/                # Backend process entry point
│   ├── backend-plugin-api/     # Backend plugin/service DI framework
│   ├── backend-defaults/       # Default service implementations
│   ├── frontend-plugin-api/    # Frontend extension/blueprint framework
│   ├── catalog-model/          # Entity types, kinds, and validators
│   ├── catalog-client/         # HTTP client for the catalog API
│   ├── config/                 # Config reader
│   ├── cli/                    # Backstage CLI toolchain
│   └── ...                     # ~50 total core packages
├── plugins/
│   ├── auth-backend/                              # Authentication backend
│   ├── catalog-backend/                           # Software catalog backend
│   ├── scaffolder-backend/                        # Template engine backend
│   ├── techdocs-backend/                          # TechDocs backend
│   ├── search-backend/                            # Search backend
│   ├── notifications-backend/                     # Notifications backend
│   ├── permission-backend-module-blitzy-policy/   # BlitzyPermissionPolicy (read-only for non-@blitzy.com and Guest)
│   └── ...                                        # ~100+ feature plugins
├── contrib/
│   └── catalog/                # Experimental catalog providers
├── blitzy-deck/                # Executive presentation HTML deck (reveal.js)
├── docs/
│   ├── refactor/               # Decision log, traceability matrix, before/after architecture, onboarding addendum
│   ├── observability/          # Observability docs and Grafana dashboard template
│   └── ...                     # Upstream Backstage documentation
├── app-config.yaml             # Base configuration
├── app-config.production.yaml  # Production overrides
└── knexfile.js                 # Database migration config
```

### Key Entry Points

| File                                                            | Purpose                                                                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/backend/src/index.ts`                                 | Backend process — registers all plugins via `backend.add()`                                                                                 |
| `packages/app/src/App.tsx`                                      | Frontend app root — assembles all features via `createApp()`                                                                                |
| `app-config.yaml`                                               | App configuration (URLs, database, auth, integrations, support email)                                                                       |
| `docker-compose.localgcp.yml`                                   | Containerized LocalGCP emulators (GCS, Pub/Sub, Firestore) for integration tests                                                            |
| `plugins/permission-backend-module-blitzy-policy/`              | Workspace package containing the `BlitzyPermissionPolicy` backend module — read-only enforcement for non-`@blitzy.com` and Guest principals |
| `plugins/permission-backend-module-blitzy-policy/src/policy.ts` | `BlitzyPermissionPolicy` class — implements `PermissionPolicy.handle()`; ALLOW for read actions and Blitzy-domain users, DENY otherwise     |
| `plugins/catalog-backend-module-access-audit/`                  | Catalog access audit module — emits `entity-access` audit events on per-entity reads via `AuditorService`                                   |
| `packages/app/src/modules/appModuleTopBar.tsx`                  | Top-right chrome cluster (Blitzy logo, Settings, Support); mounted via `NavContentBlueprint` and `app/layout` override                      |

### Architecture Notes

- The backend uses a **DI container** (`ServiceRegistry`) that resolves typed `ServiceRef` → `ServiceFactory` at startup. Plugins declare their service dependencies declaratively.
- The frontend uses **Declarative Integration** — plugins expose typed `Extension` objects (pages, nav items, entity content) assembled by `createApp()`. Routing is automatic.
- **TechDocs search** is intentionally disabled to prevent OOM when indexing repositories that haven't built docs — see the comment in `packages/backend/src/index.ts`.
- **Authorization** — A custom `BlitzyPermissionPolicy` is implemented in `plugins/permission-backend-module-blitzy-policy/` and registered in `packages/backend/src/index.ts`, replacing the upstream `AllowAllPermissionPolicy`. Users whose verified email domain is `@blitzy.com` retain full access; all other authenticated users and Guest sessions are constrained to **read-only** permissions enforced by the backend permission layer. The policy extracts the user email from the custom JWT `email` claim populated by the GitHub `signInResolver` (`packages/backend/src/authModuleGithubProvider.ts`) and decoded via `jose.decodeJwt(user.credentials.token)` — see `blitzy/documentation/Technical Specifications.md` IR-2 for the as-implemented email propagation path.
- **Audit logging** — GitHub sign-in attempts and project (catalog entity) reads are recorded via Backstage's `AuditorService`. A `user-login` event is emitted on every sign-in (success and failure) by the augmented GitHub resolver; an `entity-access` event is emitted on every catalog entity read by the access-audit module in `plugins/catalog-backend-module-access-audit/`. `entity-access` events carry the canonical HTTP request correlation id; `user-login` events carry a synthetic resolver-generated `correlationId` (UUID) because the `SignInResolver` callback does not expose the HTTP request — see `docs/auth/index.md` and `docs/auth/identity-resolver.md` for the exact event contracts. The Grafana dashboard template lives at `docs/observability/dashboard-template.json` and is documented at `docs/observability/dashboards.md`. The custom Prometheus counters (`user_login_total`, `entity_access_total`, `blitzy_permission_decisions_total`) are emitted by the augmented sign-in resolver, the access-audit middleware, and the `BlitzyPermissionPolicy` respectively; auto-instrumented HTTP/runtime metrics from `@opentelemetry/auto-instrumentations-node` are available alongside them. Unit coverage on the access-audit middleware lives at `plugins/catalog-backend-module-access-audit/src/module.test.ts` (25 executed cases) in addition to the Playwright `auditing.test.ts` E2E suite. The CI workflow does **not yet invoke** `docker compose -f docker-compose.localgcp.yml up -d` before integration tests, even though the compose file is committed — this remaining item is tracked in `docs/refactor/next-tasks.md` entry 7.

### Refactor Documentation

The Blitzy refactor ships the following documentation artifacts. The canonical refactor specification lives in `blitzy/documentation/Technical Specifications.md` (which includes the **Implementation Reality Addendum** documenting every deviation from the original AAP plan, IR-1 through IR-9), and the executive overview in `blitzy-deck/executive-summary.html`.

- [`docs/refactor/decision-log.md`](docs/refactor/decision-log.md) — non-trivial decisions, alternatives, and risks
- [`docs/refactor/traceability-matrix.md`](docs/refactor/traceability-matrix.md) — bidirectional requirement-to-implementation mapping
- [`docs/refactor/architecture-before-after.md`](docs/refactor/architecture-before-after.md) — Mermaid diagrams of chrome and permission flows
- [`docs/refactor/onboarding-addendum.md`](docs/refactor/onboarding-addendum.md) — clean-machine setup, LocalGCP setup, customization guides
- [`docs/refactor/next-tasks.md`](docs/refactor/next-tasks.md) — discovered improvements out of current scope (CI LocalGCP wiring, MUI-to-shadcn migration, in-app audit UI, `entity-write` audit event, per-user dashboard breakdowns)
- [`docs/observability/dashboards.md`](docs/observability/dashboards.md) — structured logging, tracing, metrics, dashboard import (covers the three custom Prometheus counters now emitted by the runtime modules)
- [`docs/observability/dashboard-template.json`](docs/observability/dashboard-template.json) — importable Grafana dashboard JSON (counter panels populate from `user_login_total`, `entity_access_total`, and `blitzy_permission_decisions_total`; auto-instrumented panels are available alongside them)

Refer to `blitzy/documentation/Project Guide.md` §0 _Verification Status (Implementation Reality)_ for a single-glance table of which AAP claims correspond to source code vs. which are tracked as deferred follow-ups.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines, including development environment setup, the changeset process, and pull request requirements.

## License

Copyright 2020-2026 © The Backstage Authors. Distributed under the Apache License 2.0. See [`LICENSE`](LICENSE) for full text.

## Acknowledgments

- [Backstage](https://backstage.io) — the upstream open-source project this fork is based on, maintained by the CNCF community
- [Spotify](https://engineering.atspotify.com/2020/04/how-we-use-backstage-at-spotify/) — original creators of Backstage
- The [CNCF](https://www.cncf.io/projects/backstage/) for hosting Backstage at Incubation level

---

<!-- Reference-style links -->

[contributors-shield]: https://img.shields.io/github/contributors/Blitzy-Sandbox/blitzy-sandbox-backstage.svg?style=flat
[contributors-url]: https://github.com/Blitzy-Sandbox/blitzy-sandbox-backstage/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/Blitzy-Sandbox/blitzy-sandbox-backstage.svg?style=flat
[forks-url]: https://github.com/Blitzy-Sandbox/blitzy-sandbox-backstage/network/members
[stars-shield]: https://img.shields.io/github/stars/Blitzy-Sandbox/blitzy-sandbox-backstage.svg?style=flat
[stars-url]: https://github.com/Blitzy-Sandbox/blitzy-sandbox-backstage/stargazers
[issues-shield]: https://img.shields.io/github/issues/Blitzy-Sandbox/blitzy-sandbox-backstage.svg?style=flat
[issues-url]: https://github.com/Blitzy-Sandbox/blitzy-sandbox-backstage/issues
[license-shield]: https://img.shields.io/github/license/Blitzy-Sandbox/blitzy-sandbox-backstage.svg?style=flat
[license-url]: https://github.com/Blitzy-Sandbox/blitzy-sandbox-backstage/blob/master/LICENSE
[ci-shield]: https://img.shields.io/github/actions/workflow/status/Blitzy-Sandbox/blitzy-sandbox-backstage/ci.yml?style=flat&label=CI
[ci-url]: https://github.com/Blitzy-Sandbox/blitzy-sandbox-backstage/actions/workflows/ci.yml
[typescript-shield]: https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white
[typescript-url]: https://typescriptlang.org
[react-shield]: https://img.shields.io/badge/React-61DAFB?style=flat&logo=react&logoColor=black
[react-url]: https://react.dev
[node-shield]: https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white
[node-url]: https://nodejs.org
[tailwind-shield]: https://img.shields.io/badge/Tailwind%20CSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white
[tailwind-url]: https://tailwindcss.com
[yarn-shield]: https://img.shields.io/badge/Yarn-2C8EBB?style=flat&logo=yarn&logoColor=white
[yarn-url]: https://yarnpkg.com
[sqlite-shield]: https://img.shields.io/badge/SQLite-003B57?style=flat&logo=sqlite&logoColor=white
[sqlite-url]: https://sqlite.org
[docker-shield]: https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white
[docker-url]: https://docker.com
