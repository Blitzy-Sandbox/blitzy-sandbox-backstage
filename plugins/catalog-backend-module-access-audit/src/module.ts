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

import {
  AuditorService,
  AuditorServiceEvent,
  BackstageCredentials,
  HttpAuthService,
  LoggerService,
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { stringifyEntityRef } from '@backstage/catalog-model';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { entityAccessTotal } from './metrics';

/**
 * Regex matching exact `GET /entities/by-name/:kind/:namespace/:name` paths,
 * relative to the catalog plugin's base path. Allows an optional trailing
 * slash but no further path segments (so sub-routes such as `/ancestry`
 * are deliberately excluded).
 */
const BY_NAME_PATH = /^\/entities\/by-name\/([^/]+)\/([^/]+)\/([^/]+)\/?$/;

/**
 * Regex matching exact `GET /entities/by-uid/:uid` paths, relative to
 * the catalog plugin's base path. Allows an optional trailing slash but
 * no further path segments.
 */
const BY_UID_PATH = /^\/entities\/by-uid\/([^/]+)\/?$/;

/**
 * Shape of the principal block that we record in the audit event meta.
 * Kept JSON-serializable so it satisfies AuditorService's meta typing
 * without an explicit `JsonObject` import.
 */
type PrincipalMeta =
  | { type: 'user'; userEntityRef: string }
  | { type: 'service'; subject: string }
  | { type: 'none' };

/**
 * Result of inspecting a request path against the supported single-
 * entity GET endpoints. The audit middleware uses these descriptors to
 * (a) decide whether to audit the request at all and (b) carry the
 * canonicalization strategy that will populate the emitted event's
 * `meta.entityRef` (and, for by-uid reads, `meta.entityUid`).
 *
 * @remarks
 *
 * For `by-name` reads the canonical entity ref can be derived directly
 * from the URL — `/entities/by-name/:kind/:namespace/:name` carries all
 * three components needed by `stringifyEntityRef`. For `by-uid` reads
 * the URL only carries the opaque UID; the canonical ref is only
 * available after the catalog backend has resolved the UID and written
 * the entity to the response. The audit middleware therefore wraps
 * `res.json`/`res.end` for by-uid responses and inspects the serialized
 * entity body to recover the canonical ref. The UID is always recorded
 * as `meta.entityUid` so that the audit trail remains non-empty even
 * when the canonical ref cannot be recovered (for example, on 404 or
 * malformed JSON responses).
 */
type AuditTarget =
  | {
      kind: 'by-name';
      /** Canonical entity ref derived from the request path. */
      entityRef: string;
    }
  | {
      kind: 'by-uid';
      /** Opaque UID parsed from the request path. */
      uid: string;
    };

/**
 * Inspects the request path and returns the audit target descriptor for
 * the supported single-entity GET endpoints. Returns `undefined` for any
 * other path (including collection endpoints and sub-routes such as
 * `/ancestry`) so the audit middleware short-circuits.
 */
function classifyRequest(path: string): AuditTarget | undefined {
  const byName = BY_NAME_PATH.exec(path);
  if (byName) {
    const [, kind, namespace, name] = byName;
    return {
      kind: 'by-name',
      entityRef: stringifyEntityRef({ kind, namespace, name }),
    };
  }

  const byUid = BY_UID_PATH.exec(path);
  if (byUid) {
    const [, uid] = byUid;
    return { kind: 'by-uid', uid };
  }

  return undefined;
}

/**
 * Attempts to canonicalize an entity ref from a parsed response body.
 *
 * @remarks
 *
 * Both response shapes emitted by the catalog backend's by-uid handler
 * carry the same JSON entity envelope (see
 * `plugins/catalog-backend/src/service/response/write.ts` —
 * `writeSingleEntityResponse`):
 *
 * - Object mode writes `res.json(entity)` so the body inspected here is
 *   a JavaScript object literal.
 * - Raw-string mode writes `res.end(entity)` where the entity is a JSON
 *   string; the audit middleware parses the string before invoking this
 *   helper so the input is again a JavaScript object literal.
 *
 * The function defensively narrows `unknown` to the minimal `kind` +
 * `metadata.name` shape required to construct a canonical entity ref
 * and returns `undefined` if the body does not match (so the audit
 * trail records the UID alone rather than crashing the middleware).
 */
function canonicalizeEntityRefFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const root = body as Record<string, unknown>;
  const kind = root.kind;
  const metadata = root.metadata;
  if (typeof kind !== 'string' || !metadata || typeof metadata !== 'object') {
    return undefined;
  }
  const meta = metadata as Record<string, unknown>;
  const name = meta.name;
  if (typeof name !== 'string') {
    return undefined;
  }
  const namespace =
    typeof meta.namespace === 'string' ? meta.namespace : 'default';
  try {
    return stringifyEntityRef({ kind, namespace, name });
  } catch {
    return undefined;
  }
}

/**
 * Coerces an Express response chunk (string, Buffer, or undefined) into
 * a UTF-8 string suitable for JSON parsing, or `undefined` when the
 * chunk is neither a string nor a Buffer.
 *
 * @remarks
 *
 * Express's `res.end(chunk, encoding, cb)` overload permits the chunk
 * argument to be any of: `string`, `Buffer`, `Uint8Array`, or
 * `undefined`. Only string and Buffer chunks are inspected for a JSON
 * entity envelope; other shapes (sparse `Uint8Array` payloads,
 * pre-serialized binary content) cannot meaningfully contribute a
 * canonical entity ref, so they are treated as non-inspectable.
 */
function coerceResponseChunkToString(chunk: unknown): string | undefined {
  if (typeof chunk === 'string') {
    return chunk;
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk.toString('utf8');
  }
  return undefined;
}

/**
 * Wraps `res.json` and `res.end` so the audit middleware can inspect
 * the entity body emitted for a by-uid read and recover the canonical
 * entity ref before the audit event is emitted.
 *
 * @remarks
 *
 * The captured ref is exposed back to the middleware through the
 * `getCapturedRef` accessor returned alongside the install function.
 * The wrappers are pass-through with respect to the response lifecycle:
 * they invoke the original `res.json` / `res.end` with the same
 * arguments and the same `this` binding, so streaming and status-code
 * propagation are unaffected. Errors raised during body inspection are
 * swallowed so the original entity read never fails on the audit path.
 */
function installByUidResponseInspector(res: Response): {
  getCapturedRef: () => string | undefined;
} {
  let captured: string | undefined;

  const originalJson = res.json.bind(res);
  const wrappedJson: typeof res.json = function wrappedJsonResponse(
    body?: unknown,
  ) {
    if (!captured) {
      try {
        const ref = canonicalizeEntityRefFromBody(body);
        if (ref) {
          captured = ref;
        }
      } catch {
        // Body inspection must never break the response.
      }
    }
    return originalJson(body as never);
  };
  res.json = wrappedJson;

  const originalEnd = res.end.bind(res);
  const wrappedEnd: Response['end'] = function wrappedEndResponse(
    this: Response,
    chunk?: unknown,
    encoding?: unknown,
    cb?: unknown,
  ): Response {
    if (!captured && chunk !== undefined && chunk !== null) {
      try {
        const bodyStr = coerceResponseChunkToString(chunk);
        if (bodyStr) {
          const parsed = JSON.parse(bodyStr);
          const ref = canonicalizeEntityRefFromBody(parsed);
          if (ref) {
            captured = ref;
          }
        }
      } catch {
        // Not a JSON entity envelope; leave captured ref undefined and
        // let the audit middleware fall back to `meta.entityUid`.
      }
    }
    // Forward to the original `res.end` overload exactly as called.
    return (originalEnd as (...args: unknown[]) => Response)(
      chunk,
      encoding,
      cb,
    );
  };
  res.end = wrappedEnd as typeof res.end;

  return { getCapturedRef: () => captured };
}

/**
 * Translates a resolved Backstage credential into the principal meta
 * shape we record in the audit event. A missing credential collapses
 * to `{ type: 'none' }` so anonymous accesses are still observable.
 */
function buildPrincipalMeta(
  credentials: BackstageCredentials | undefined,
): PrincipalMeta {
  if (!credentials) {
    return { type: 'none' };
  }

  const principal = credentials.principal as
    | { type: 'user'; userEntityRef: string }
    | { type: 'service'; subject: string }
    | { type: 'none' }
    | undefined;

  if (!principal || principal.type === 'none') {
    return { type: 'none' };
  }
  if (principal.type === 'user') {
    return { type: 'user', userEntityRef: principal.userEntityRef };
  }
  if (principal.type === 'service') {
    return { type: 'service', subject: principal.subject };
  }
  return { type: 'none' };
}

/**
 * Resolves the credentials associated with the inbound request, swallowing
 * any authentication-related errors so that anonymous traffic is still
 * recorded with `{ type: 'none' }` rather than crashing the middleware.
 */
async function resolveCredentialsSafely(
  httpAuth: HttpAuthService,
  req: Request,
  logger: LoggerService,
): Promise<BackstageCredentials | undefined> {
  try {
    return await httpAuth.credentials(req, {
      allow: ['user', 'service', 'none'],
    });
  } catch (error) {
    logger.debug(
      `entity-access audit: failed to resolve credentials, defaulting to anonymous principal: ${error}`,
    );
    return undefined;
  }
}

/**
 * Builds the Express middleware that records `entity-access` audit events
 * for single-entity reads against the catalog backend.
 */
function createAuditMiddleware(deps: {
  auditor: AuditorService;
  httpAuth: HttpAuthService;
  logger: LoggerService;
}): RequestHandler {
  const { auditor, httpAuth, logger } = deps;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Only single-entity GET reads are audited; everything else (POST,
    // PUT, DELETE, collection endpoints, sub-routes like `/ancestry`)
    // passes through unchanged.
    if (req.method !== 'GET') {
      next();
      return;
    }

    const target = classifyRequest(req.path);
    if (!target) {
      next();
      return;
    }

    // For by-uid reads, install response-body inspectors so the audit
    // event can record the canonical entity ref (e.g.
    // `component:default/my-service`) rather than only the opaque UID.
    // For by-name reads the canonical ref is already available from the
    // request path, so no response interception is needed.
    let getByUidCapturedRef: (() => string | undefined) | undefined;
    if (target.kind === 'by-uid') {
      try {
        ({ getCapturedRef: getByUidCapturedRef } =
          installByUidResponseInspector(res));
      } catch (error) {
        logger.debug(
          `entity-access audit: failed to install by-uid response inspector for uid ${target.uid}: ${error}`,
        );
      }
    }

    // Guard so finalize runs exactly once even when both 'finish' and
    // 'close' fire on the response (which can happen on aborted requests).
    let finalized = false;

    const finalize = (): void => {
      if (finalized) {
        return;
      }
      finalized = true;

      // Detach the sibling listener so that the second emission (which
      // node.js can produce on aborted responses) does not re-enter.
      res.removeListener('finish', finalize);
      res.removeListener('close', finalize);

      // All audit work is deferred to a fire-and-forget async IIFE so
      // that any failures are isolated from the response lifecycle.
      void (async () => {
        // Resolve the entity descriptors before any awaits so failures
        // in credential resolution do not strip them.
        const entityRef =
          target.kind === 'by-name'
            ? target.entityRef
            : getByUidCapturedRef?.();
        const entityUid = target.kind === 'by-uid' ? target.uid : undefined;
        // Identifier used purely for log lines when an audit emission
        // fails. Prefers the canonical ref but falls back to the UID so
        // the operator can still correlate the failure with a request.
        const logIdentifier = entityRef ?? entityUid ?? 'unknown';

        try {
          const credentials = await resolveCredentialsSafely(
            httpAuth,
            req,
            logger,
          );
          const principal = buildPrincipalMeta(credentials);
          const statusCode = res.statusCode;

          // Build the audit event meta. `entityRef` is included only
          // when canonicalization succeeded; `entityUid` is included
          // for every by-uid read so the trail remains observable even
          // when the entity could not be canonicalized (e.g. 404 or an
          // unparseable response body). `action` is fixed to `read`
          // since the middleware only audits GET requests.
          const meta: {
            principal: PrincipalMeta;
            action: 'read';
            entityRef?: string;
            entityUid?: string;
          } = {
            principal,
            action: 'read',
          };
          if (entityRef) {
            meta.entityRef = entityRef;
          }
          if (entityUid) {
            meta.entityUid = entityUid;
          }

          // Increment the entity-access counter exactly once per
          // observed read. Recorded before createEvent so the metric is
          // not skipped if the auditor itself fails (the counter
          // tracks middleware-observed reads, not successful audit
          // emissions).
          entityAccessTotal.add(1, { action: meta.action });

          let event: AuditorServiceEvent;
          try {
            event = await auditor.createEvent({
              eventId: 'entity-access',
              // QA finding F9 (CP7) — the previous `'low'` severity
              // routed entity-access events through the default
              // severity-to-log-level mapping at
              // `packages/backend-defaults/src/entrypoints/auditor/utils.ts`
              // L33-44 (`low → debug`). The default Winston root logger
              // filters out `debug`, so the events were silently
              // dropped from the structured audit log even while the
              // `entityAccessTotal` counter continued incrementing.
              // This contradicts AAP §0.1.1 ("captures an immutable
              // audit trail of every … project (catalog entity)
              // access"). Promoting to `'medium'` maps to log level
              // `'info'` which is persisted by the default logger and
              // by any downstream log aggregator that consumes Winston
              // output. The severity choice aligns with the GitHub
              // `user-login` event which is also recorded at
              // `'medium'` (see
              // `packages/backend/src/authModuleGithubProvider.ts`).
              severityLevel: 'medium',
              request: req,
              meta,
            });
          } catch (error) {
            logger.warn(
              `entity-access audit: failed to create event for ${logIdentifier}: ${error}`,
            );
            return;
          }

          try {
            // HTTP statuses below 400 — i.e. successful 2xx and
            // redirect 3xx responses — record the read as a granted
            // access via `.success(...)`. 4xx (client errors, denied
            // reads, missing entities) and 5xx (server errors) record
            // the read as a denied or failed access via `.fail(...)`,
            // letting downstream consumers distinguish granted reads
            // from denied or failed reads.
            if (statusCode < 400) {
              await event.success({ meta: { statusCode } });
            } else {
              await event.fail({
                error: new Error(`HTTP ${statusCode}`),
                meta: { statusCode },
              });
            }
          } catch (error) {
            logger.warn(
              `entity-access audit: failed to finalize event for ${logIdentifier}: ${error}`,
            );
          }
        } catch (error) {
          logger.warn(
            `entity-access audit: unexpected failure for ${logIdentifier}: ${error}`,
          );
        }
      })();
    };

    res.on('finish', finalize);
    res.on('close', finalize);

    next();
  };
}

/**
 * The `catalog-backend-module-access-audit` backend module registers an
 * Express middleware against the catalog plugin's HTTP router that emits
 * an `entity-access` audit event each time an authenticated user (or any
 * principal) reads a single catalog entity.
 *
 * @public
 */
export const catalogModuleAccessAudit = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'access-audit',
  register(reg) {
    reg.registerInit({
      deps: {
        auditor: coreServices.auditor,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
      },
      async init({ auditor, httpAuth, httpRouter, logger }) {
        httpRouter.use(createAuditMiddleware({ auditor, httpAuth, logger }));
      },
    });
  },
});
