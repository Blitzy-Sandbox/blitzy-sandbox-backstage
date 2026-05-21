# @internal/plugin-catalog-backend-module-access-audit

## 0.1.0

### Minor Changes

- Initial release: emits `entity-access` audit events for catalog entity reads via the `AuditorService` (`coreServices.auditor`). Catches user-credentialed GET requests on `/api/catalog/entities/by-name/:kind/:namespace/:name` and `/api/catalog/entities/by-uid/:uid` and records the entity ref, principal type/identity, and action as low-severity audit events. Implements the project access tracking requirement from the Blitzy Sandbox Backstage refactor (AAP §0.5.1.3).
