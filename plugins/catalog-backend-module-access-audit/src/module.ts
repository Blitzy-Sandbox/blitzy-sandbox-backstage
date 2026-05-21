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
 * Extracts the entity ref described by a request path, or returns
 * undefined if the path does not match one of the supported single-entity
 * GET endpoints.
 */
function extractEntityRef(path: string): string | undefined {
  const byName = BY_NAME_PATH.exec(path);
  if (byName) {
    const [, kind, namespace, name] = byName;
    return stringifyEntityRef({ kind, namespace, name });
  }

  const byUid = BY_UID_PATH.exec(path);
  if (byUid) {
    const [, uid] = byUid;
    return `uid:${uid}`;
  }

  return undefined;
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

    const entityRef = extractEntityRef(req.path);
    if (!entityRef) {
      next();
      return;
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
        try {
          const credentials = await resolveCredentialsSafely(
            httpAuth,
            req,
            logger,
          );
          const principal = buildPrincipalMeta(credentials);
          const statusCode = res.statusCode;

          let event: AuditorServiceEvent;
          try {
            event = await auditor.createEvent({
              eventId: 'entity-access',
              severityLevel: 'low',
              request: req,
              meta: {
                entityRef,
                principal,
                action: 'read',
              },
            });
          } catch (error) {
            logger.warn(
              `entity-access audit: failed to create event for ${entityRef}: ${error}`,
            );
            return;
          }

          try {
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
              `entity-access audit: failed to finalize event for ${entityRef}: ${error}`,
            );
          }
        } catch (error) {
          logger.warn(
            `entity-access audit: unexpected failure for ${entityRef}: ${error}`,
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
