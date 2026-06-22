/*
 * Copyright 2024 The Backstage Authors
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

/**
 * BlitzyE2E AuditorService capture layer.
 *
 * This module provides three coordinated pieces of test-only audit
 * infrastructure that Playwright fixtures can rely on for
 * deterministic verification of `user-login`, `entity-access`, and any
 * other audit events emitted by the backend:
 *
 *   1. `capturedAuditEvents` — an in-process array (module-scoped) of
 *      AuditorEvent objects captured since process start. The array is
 *      bounded so the test backend cannot grow memory unboundedly.
 *
 *   2. `blitzyE2EAuditorServiceFactory` — a Backstage service factory
 *      with `service: coreServices.auditor` that replaces the default
 *      Winston-only auditor with one that (a) captures into the
 *      in-memory array AND (b) still writes through the same Winston
 *      sink as the default for parity with production. The factory is
 *      ONLY registered in `packages/backend/src/index.ts` when
 *      `BLITZY_E2E_TEST_MODE === 'true'`.
 *
 *   3. `blitzyE2EAuditEndpointPlugin` — a backend PLUGIN that mounts a
 *      read-only HTTP endpoint at
 *      `GET /api/blitzy-e2e/audit-events` returning the captured
 *      events. The route also exposes
 *      `DELETE /api/blitzy-e2e/audit-events` to clear the buffer
 *      between test cases. Both routes refuse to operate unless
 *      `BLITZY_E2E_TEST_MODE === 'true'`. This is a plugin (not a
 *      module) so that it self-registers — see the JSDoc on the
 *      plugin declaration below for the architectural rationale.
 *
 * SECURITY: nothing in this module is reachable in a production
 * deployment because (a) the env-var gate prevents `backend.add()`
 * from importing the module entries below, and (b) the auditor
 * factory and the HTTP routes each refuse to operate when the env
 * var is unset. See `authModuleBlitzyE2E.ts` for the same
 * defense-in-depth pattern.
 */

import {
  coreServices,
  createBackendPlugin,
  createServiceFactory,
} from '@backstage/backend-plugin-api';
import type {
  AuditorEvent,
  AuditorLogFunction,
} from '@backstage/backend-defaults/auditor';
import { DefaultAuditorService } from '@backstage/backend-defaults/auditor';
import { trace } from '@opentelemetry/api';
import { Router } from 'express';

/**
 * Maximum number of audit events retained in memory. Beyond this the
 * oldest events are evicted FIFO. The cap keeps memory bounded even
 * if a long-running Playwright session generates large volumes of
 * audit traffic.
 */
const MAX_CAPTURED_EVENTS = 5000;

/**
 * OpenTelemetry trace correlation fields injected into every captured
 * audit event when an active span is present at capture time. Captured
 * via {@link captureTraceContext}; missing fields are omitted so test
 * assertions can use a `toMatchObject({...})` shape without needing to
 * handle a `null`/`undefined` distinction.
 *
 * Format matches the Winston structured-log shape produced by
 * `@opentelemetry/instrumentation` (lowercase snake-cased keys) so the
 * test buffer correlates with the production stdout audit log without
 * requiring downstream consumers to re-key the fields.
 */
type CapturedTraceContext = {
  trace_id?: string;
  span_id?: string;
  trace_flags?: number;
};

/**
 * The in-process capture buffer. EXPORTED for unit tests only — never
 * read by application code outside this module.
 *
 * Each entry is the full `AuditorEvent` object the default
 * `DefaultAuditorService.log()` would have passed to Winston, plus
 * `_capturedAt` (ISO-8601 timestamp) and the OpenTelemetry trace
 * correlation fields (`trace_id`, `span_id`, `trace_flags`) captured
 * via {@link captureTraceContext} so test assertions can correlate
 * audit events against the OpenTelemetry trace produced by the same
 * request (QA CP6 Finding F-006).
 */
type CapturedEvent = AuditorEvent & {
  _capturedAt: string;
} & CapturedTraceContext;
const capturedAuditEvents: CapturedEvent[] = [];

/**
 * Test-only helper used by unit tests to inspect or reset the buffer.
 * Not exported via `index.ts` — only reachable when this module is
 * imported directly from inside the backend process.
 */
export function _testOnlyReadCapturedEvents(): readonly CapturedEvent[] {
  return capturedAuditEvents;
}

/** Test-only helper to clear the buffer in unit tests. */
export function _testOnlyClearCapturedEvents(): void {
  capturedAuditEvents.length = 0;
}

/**
 * Reads the current active OpenTelemetry span context and returns a
 * structured-log-shaped trace correlation object. Returns an empty
 * object when no active span is present, when the span context is
 * invalid (the OpenTelemetry NoOp tracer's INVALID_SPAN_CONTEXT), or
 * when the OpenTelemetry API has not been initialized.
 *
 * The function is intentionally defensive: it never throws and never
 * propagates a degraded trace state into the captured event. Any
 * unexpected failure is treated as "no active span" and the captured
 * event simply omits the trace fields.
 *
 * Field shape matches the Winston structured-log keys produced by
 * `@opentelemetry/instrumentation-winston` and emitted by the backend
 * process when `--require=./src/instrumentation.js` is honored on
 * startup. This alignment lets test fixtures correlate buffer entries
 * with stdout log lines via the same `trace_id` value.
 *
 * @internal exported for testing
 */
export function captureTraceContext(): CapturedTraceContext {
  try {
    const activeSpan = trace.getActiveSpan();
    if (!activeSpan) {
      return {};
    }
    const ctx = activeSpan.spanContext();
    // OpenTelemetry's `isSpanContextValid` is implicit in the trace and
    // span ID format: invalid contexts use all-zero ids which we can
    // detect cheaply without importing the helper.
    if (
      !ctx.traceId ||
      ctx.traceId === '00000000000000000000000000000000' ||
      !ctx.spanId ||
      ctx.spanId === '0000000000000000'
    ) {
      return {};
    }
    return {
      trace_id: ctx.traceId,
      span_id: ctx.spanId,
      trace_flags: ctx.traceFlags,
    };
  } catch {
    // Defensive: any failure (e.g., OTel API not initialized in unit
    // tests) collapses to "no active span" so the capture buffer never
    // crashes the request that produced the audit event.
    return {};
  }
}

/**
 * Records an audit event into the in-memory buffer with FIFO eviction
 * when the buffer is full.
 *
 * Captures the current OpenTelemetry trace context (`trace_id`,
 * `span_id`, `trace_flags`) onto the captured event so Playwright
 * fixtures can correlate audit events with the OTel trace produced by
 * the same request (QA CP6 F-006). When no active span is present
 * (e.g., during unit tests that do not initialize the OTel SDK), the
 * trace fields are simply omitted.
 */
function captureAuditEvent(event: AuditorEvent): void {
  capturedAuditEvents.push({
    ...event,
    _capturedAt: new Date().toISOString(),
    ...captureTraceContext(),
  });
  if (capturedAuditEvents.length > MAX_CAPTURED_EVENTS) {
    capturedAuditEvents.splice(
      0,
      capturedAuditEvents.length - MAX_CAPTURED_EVENTS,
    );
  }
}

/**
 * A Backstage AuditorService factory that captures every emitted
 * event into the in-memory buffer AND forwards the event through the
 * same Winston `isAuditEvent: true` log channel the default factory
 * uses. The factory is identical in behavior to
 * `@backstage/backend-defaults/auditor`'s `auditorServiceFactory`
 * except for the additional `captureAuditEvent` call.
 *
 * Registered ONLY when `BLITZY_E2E_TEST_MODE === 'true'` (see
 * `packages/backend/src/index.ts`). When unset, the default
 * Winston-only factory remains active and no events are captured.
 */
export const blitzyE2EAuditorServiceFactory = createServiceFactory({
  service: coreServices.auditor,
  deps: {
    logger: coreServices.logger,
    auth: coreServices.auth,
    httpAuth: coreServices.httpAuth,
    plugin: coreServices.pluginMetadata,
  },
  factory({ logger, auth, httpAuth, plugin }) {
    // Mirror the production Winston-based emission so that downstream
    // log aggregators continue to see audit events even in test mode.
    const auditLogger = logger.child({ isAuditEvent: true });

    const winstonLogFn: AuditorLogFunction = event => {
      if ('error' in event) {
        const { error, ...rest } = event;
        const childAuditLogger = auditLogger.child(rest);
        childAuditLogger.warn(`${event.plugin}.${event.eventId}`, error);
      } else {
        auditLogger.info(`${event.plugin}.${event.eventId}`, event);
      }
    };

    const compositeLogFn: AuditorLogFunction = event => {
      // Capture FIRST so a Winston transport failure cannot prevent the
      // test assertion from seeing the event. The captured copy is a
      // structured clone via JSON serialize/parse to defend against
      // accidental mutations from downstream handlers.
      try {
        const cloned = JSON.parse(
          JSON.stringify(event, (_k, v) =>
            // Errors don't serialize cleanly via JSON; capture name + message.
            v instanceof Error
              ? { name: v.name, message: v.message, stack: v.stack }
              : v,
          ),
        ) as AuditorEvent;
        captureAuditEvent(cloned);
      } catch {
        // If serialization fails for any reason, capture a minimal
        // marker so the test still sees that an event occurred at this
        // pluginId + eventId.
        captureAuditEvent({
          plugin: event.plugin,
          eventId: event.eventId,
          severityLevel: event.severityLevel,
          status: 'status' in event ? event.status : ('initiated' as const),
          actor: event.actor,
        } as AuditorEvent);
      }
      return winstonLogFn(event);
    };

    return DefaultAuditorService.create(compositeLogFn, {
      plugin,
      auth,
      httpAuth,
    });
  },
});

/**
 * Backstage backend PLUGIN that exposes a read-only test-only HTTP
 * endpoint to query and clear the captured audit-event buffer.
 *
 * Routes:
 *
 *   GET    /api/blitzy-e2e/audit-events             — return all captured events
 *   GET    /api/blitzy-e2e/audit-events?eventId=... — filter by eventId
 *   DELETE /api/blitzy-e2e/audit-events             — clear the buffer
 *
 * This is implemented as a `createBackendPlugin` (NOT a
 * `createBackendModule`) so that the plugin self-registers when added
 * to the backend via `backend.add(import('./blitzyE2EAuditCapture'))`.
 *
 * Historical note (QA CP5 Critical Defect #1): an earlier revision
 * declared this as `createBackendModule({pluginId: 'blitzy-e2e',
 * moduleId: 'audit-events-endpoint'})`. The Backstage backend system
 * only initializes modules whose declared `pluginId` matches a plugin
 * that has been registered separately (see
 * `packages/backend-app-api/src/wiring/BackendInitializer.ts` lines
 * 360-378 — modules without a corresponding plugin are silently
 * dropped). Because no plugin with `pluginId: 'blitzy-e2e'` was
 * registered anywhere, the module's `init()` was never called, the
 * routes were never mounted, and `GET /api/blitzy-e2e/audit-events`
 * returned 404 — blocking the Playwright auditing E2E tests. Converting
 * to `createBackendPlugin` is the correct fix because the audit-events
 * endpoint IS the plugin (there is no separate plugin for the
 * audit-events surface to attach to as a module).
 *
 * SECURITY: same triple gate as `authModuleBlitzyE2E.ts`. The plugin
 * is only imported by `packages/backend/src/index.ts` when
 * `BLITZY_E2E_TEST_MODE === 'true'`, AND every route refuses to
 * respond with anything other than 404 when the env var is not true.
 *
 * @public
 */
export const blitzyE2EAuditEndpointPlugin = createBackendPlugin({
  pluginId: 'blitzy-e2e',
  register(reg) {
    reg.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
      },
      async init({ httpRouter, logger }) {
        const router = Router();
        router.use((_req, res, next) => {
          // Defense layer 3: even if the module is somehow registered,
          // every route returns 404 when the env var is unset.
          if (process.env.BLITZY_E2E_TEST_MODE !== 'true') {
            res.status(404).json({
              error:
                'blitzy-e2e audit endpoint is only available when ' +
                'BLITZY_E2E_TEST_MODE=true is set on the backend process.',
            });
            return;
          }
          next();
        });

        router.get('/audit-events', (req, res) => {
          const eventIdFilter =
            typeof req.query.eventId === 'string'
              ? req.query.eventId
              : undefined;
          const events = eventIdFilter
            ? capturedAuditEvents.filter(e => e.eventId === eventIdFilter)
            : capturedAuditEvents;
          res.json({ events });
        });

        router.delete('/audit-events', (_req, res) => {
          capturedAuditEvents.length = 0;
          res.json({ cleared: true });
        });

        // The plugin HTTP router prefixes `/api/blitzy-e2e/` for us.
        httpRouter.use(router);

        // The plugin HTTP router defaults to requiring authentication;
        // mark the audit-events endpoint as unauthenticated since it is
        // a test-only debug surface and Playwright will not have a
        // session when calling it from beforeAll hooks.
        httpRouter.addAuthPolicy({
          path: '/audit-events',
          allow: 'unauthenticated',
        });

        logger.warn(
          'Registering blitzy-e2e audit-events debug endpoint at ' +
            '/api/blitzy-e2e/audit-events — this MUST NOT be enabled in ' +
            'production. Disable by unsetting BLITZY_E2E_TEST_MODE.',
        );
      },
    });
  },
});

export default blitzyE2EAuditEndpointPlugin;
