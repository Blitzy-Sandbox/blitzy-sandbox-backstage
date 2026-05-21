# @internal/plugin-catalog-backend-module-access-audit

Catalog backend module that emits `entity-access` audit events for user-credentialed catalog entity reads.

## Purpose

This module implements the project access tracking requirement from the Blitzy Sandbox Backstage refactor described in the project's Agent Action Plan (AAP §0.5.1.3 and §0.6.1.4). It specifically satisfies the user requirement _"Track all users who log in via GitHub, specifically recording which projects they access"_ by recording every catalog single-entity read as an immutable audit event.

The module attaches an HTTP middleware to the catalog backend that intercepts GET requests to `/api/catalog/entities/by-name/:kind/:namespace/:name` and `/api/catalog/entities/by-uid/:uid`. After the response is sent, it emits an `entity-access` event via the Backstage `AuditorService` (accessed through `coreServices.auditor`) so that the principal, the entity ref, and the request outcome are captured in the audit log channel alongside other security-relevant events.

## Installation

Register the module in your backend entry point at `packages/backend/src/index.ts`:

```typescript
backend.add(import('@internal/plugin-catalog-backend-module-access-audit'));
```

No additional configuration is required. The module reuses the auditor implementation registered by `backend-defaults` and the HTTP authentication context provided by `coreServices.httpAuth`.

## Emitted Audit Event

Each intercepted entity read produces a single audit event with the following shape:

- `eventId`: `'entity-access'`
- `severityLevel`: `'low'`
- `meta.entityRef`: the stringified entity ref (for example, `'component:default/my-service'`) parsed from the request path
- `meta.principal`: an object describing the authenticated caller, with:
  - `type`: one of `'user'`, `'service'`, or `'none'`
  - identifier: `userEntityRef` for user principals or `subject` for service principals (absent for `'none'`)
- `meta.action`: the literal string `'read'`
- `meta.statusCode`: the HTTP response status code (added on completion)

Events that complete with a `2xx` status are recorded via `auditor.createEvent(...).success({ meta })`; events that complete with a non-`2xx` status are recorded via `auditor.createEvent(...).fail({ error, meta })` so that downstream consumers can distinguish granted reads from denied or failed reads.

## Querying the audit log

Audit events flow through the standard Backstage `AuditorService`, which writes structured JSON records to the Winston logger configured by `backend-defaults`. During local development, the events appear in the stdout stream of:

```
yarn workspace backend start
```

In deployed environments, the same JSON records can be shipped to an external SIEM, log aggregator, or Grafana Loki instance by configuring the Winston transports in `app-config.yaml` or the equivalent environment-specific override. Filter for `eventId="entity-access"` to isolate project-access events from other audit categories.

## Implementation strategy

The module wires an HTTP middleware against the catalog plugin's Express router rather than wrapping the `CatalogService` directly. This middleware:

1. Pattern-matches the request URL against `/entities/by-name/:kind/:namespace/:name` and `/entities/by-uid/:uid`.
2. Extracts the entity ref from the request path (for `by-name`) or from the response body (for `by-uid`).
3. Resolves the authenticated principal from `coreServices.httpAuth`.
4. Waits for the response to be sent, then emits the appropriate `success` or `fail` audit event based on the final status code.

Audit emission failures are caught and logged via `coreServices.logger` but never block or fail the underlying entity read response. This graceful-degradation posture ensures that an audit subsystem outage cannot create a denial-of-service condition for ordinary catalog browsing.

_This plugin was created as part of the Blitzy Sandbox Backstage refactor (AAP §0.5.1.3, §0.6.1.4)._
