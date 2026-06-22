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
- `severityLevel`: `'medium'` — chosen so the default `severityLogLevelMappings` (defined in `packages/backend-defaults/src/entrypoints/auditor/utils.ts`) route the event to log level `info`, which is persisted by the default Winston root logger. The previous `'low'` severity mapped to `debug` and was therefore silently filtered out of the structured audit log even while the `entity_access_total` Prometheus counter continued incrementing — see QA finding F9 (CP7) for the regression history.
- `meta.entityRef`: the canonical stringified entity ref (for example, `'component:default/my-service'`). For `/entities/by-name/:kind/:namespace/:name` reads this is parsed directly from the request path. For `/entities/by-uid/:uid` reads it is recovered from the canonicalized response body; if the body cannot be canonicalized (for example, on a 404 or a malformed response) `entityRef` is omitted and the audit trail records `entityUid` alone.
- `meta.entityUid`: for `/entities/by-uid/:uid` reads only, the opaque UID parsed from the request path. Always populated for by-uid reads so the audit trail remains non-empty even when the canonical ref cannot be recovered.
- `meta.principal`: an object describing the authenticated caller, with:
  - `type`: one of `'user'`, `'service'`, or `'none'`
  - identifier: `userEntityRef` for user principals or `subject` for service principals (absent for `'none'`)
- `meta.action`: the literal string `'read'`
- `meta.statusCode`: the HTTP response status code (added on completion)

Events that complete with a status code less than `400` (successful `2xx` reads and redirect `3xx` responses) are recorded via `auditor.createEvent(...).success({ meta })`; events that complete with a status code of `400` or higher (client errors `4xx` and server errors `5xx`, including 404 Not Found and 403 Forbidden) are recorded via `auditor.createEvent(...).fail({ error, meta })` so that downstream consumers can distinguish granted reads from denied or failed reads.

## Querying the audit log

Audit events flow through the standard Backstage `AuditorService`, which writes structured JSON records to the Winston logger configured by `backend-defaults`. During local development, the events appear in the stdout stream of:

```
yarn workspace backend start
```

In deployed environments, the same JSON records can be shipped to an external SIEM, log aggregator, or Grafana Loki instance by configuring the Winston transports in `app-config.yaml` or the equivalent environment-specific override. Filter for `eventId="entity-access"` to isolate project-access events from other audit categories.

## Implementation strategy

The module wires an HTTP middleware against the catalog plugin's Express router rather than wrapping the `CatalogService` directly. This middleware:

1. Pattern-matches the request URL against `/entities/by-name/:kind/:namespace/:name` and `/entities/by-uid/:uid`. Collection endpoints (such as `/entities`, `/entities/by-query`, `/entities/by-refs`) and entity sub-routes (such as `/ancestry`) are deliberately excluded so that only single-entity reads are audited.
2. Resolves the canonical entity ref:
   - For `by-name` reads, parses `kind`, `namespace`, and `name` directly from the URL path and stringifies them via `@backstage/catalog-model`'s `stringifyEntityRef`.
   - For `by-uid` reads, wraps `res.json` and `res.end` so the response body can be inspected after the catalog backend has resolved the UID to a concrete entity. The wrappers are pass-through and do not affect the response lifecycle; they only capture the canonical ref (when the body conforms to the expected `{ kind, metadata: { namespace?, name } }` shape) so the emitted audit event records the canonical ref alongside the opaque UID. If the canonical ref cannot be recovered (404, malformed JSON, unexpected schema), `meta.entityRef` is omitted and the audit trail records `meta.entityUid` alone.
3. Resolves the authenticated principal from `coreServices.httpAuth`, defaulting to a `{ type: 'none' }` principal for anonymous traffic so the audit log still records the access.
4. Waits for the response to be sent (via Express's `finish` / `close` events with a one-shot finalize guard for aborted requests), then emits the appropriate `success` or `fail` audit event based on the final status code.

Audit emission failures are caught and logged via `coreServices.logger` but never block or fail the underlying entity read response. The response-body inspector is wrapped in its own try/catch so a parse failure cannot disturb the entity read. This graceful-degradation posture ensures that an audit subsystem outage cannot create a denial-of-service condition for ordinary catalog browsing.

_This plugin was created as part of the Blitzy Sandbox Backstage refactor (AAP §0.5.1.3, §0.6.1.4)._
