# @internal/plugin-catalog-backend-module-access-audit

## 0.1.0

### Minor Changes

- Initial release: emits `entity-access` audit events for catalog entity reads via the `AuditorService` (`coreServices.auditor`). Catches user-credentialed GET requests on `/api/catalog/entities/by-name/:kind/:namespace/:name` and `/api/catalog/entities/by-uid/:uid` and records the entity ref, principal type/identity, and action as low-severity audit events. For by-uid reads the canonical entity ref is recovered from the response body and recorded as `meta.entityRef` (with `meta.entityUid` always populated as a fallback for unresolvable UIDs); for by-name reads the entity ref is derived directly from the request path. Implements the project access tracking requirement from the Blitzy Sandbox Backstage refactor (AAP §0.5.1.3).
