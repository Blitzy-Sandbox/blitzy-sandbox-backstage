/*
 * Copyright 2020 The Backstage Authors
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
  alertApiRef,
  identityApiRef,
  ProfileInfo,
  useApi,
} from '@backstage/core-plugin-api';
import { useEffect } from 'react';
import useAsync from 'react-use/esm/useAsync';
import { catalogApiRef, CatalogApi } from '@backstage/plugin-catalog-react';
import { UserEntity } from '@backstage/catalog-model';

/**
 * In-flight + completed catalog-profile promise cache, keyed by Backstage
 * user-entity ref.
 *
 * QA finding F5 (CP7) traced the Settings page issuing three identical
 * `GET /api/catalog/entities/by-name/user/development/guest` requests on a
 * single mount because three sibling components (`UserSettingsSignInAvatar`,
 * `UserSettingsIdentityCard`, `UserSettingsProfileCard`) each instantiate
 * `useUserProfile()` and each runs its own `useAsync(() => catalogApi.
 * getEntityByRef(...))`. The catalog entity for the Guest principal is
 * guaranteed to be missing, so the user observed three back-to-back 404s
 * with no behavioral benefit.
 *
 * The cache below holds the in-flight Promise so that subsequent calls
 * within the same browser session resolve to the same network request.
 * The cache key includes both the entity ref AND the CatalogApi instance
 * identity, so a fresh API (e.g., a remounted MSW handler in tests, or a
 * provider change) starts a fresh fetch.
 *
 * The cache is bounded by the number of distinct identities a user
 * authenticates as during a single session — typically one. It is not
 * size-bounded because that ceiling is already <= a handful in practice.
 */
const catalogProfilePromiseCache = new WeakMap<
  CatalogApi,
  Map<string, Promise<UserEntity | undefined>>
>();

/**
 * Returns true for any entity ref of the form `user:<namespace>/guest`
 * (case-insensitive). Matches the canonical `user:default/guest` AND the
 * `user:development/guest` ref produced by this fork's Guest sign-in
 * provider in `packages/backend/src/authModuleGuestProvider.ts`. The same
 * detection lives in `plugins/permission-backend-module-blitzy-policy/src/
 * policy.ts` (`isGuestPrincipal` helper) — see QA finding F1 for the
 * symmetric backend fix.
 */
function isGuestEntityRef(ref: string): boolean {
  const lower = ref.toLowerCase();
  if (!lower.startsWith('user:')) {
    return false;
  }
  const slashIndex = lower.indexOf('/');
  if (slashIndex < 0) {
    return false;
  }
  return lower.substring(slashIndex + 1) === 'guest';
}

/**
 * Returns the cached or freshly fetched catalog profile for the given
 * user-entity ref. Guest principals short-circuit to `undefined`
 * synchronously (no network call). All other refs resolve through a
 * promise cache keyed by `(CatalogApi, entityRef)`, so N parallel
 * consumers result in exactly one HTTP request.
 *
 * @internal exported for testing
 */
export function getCachedCatalogProfile(
  catalogApi: CatalogApi,
  userEntityRef: string,
): Promise<UserEntity | undefined> {
  // Skip the catalog fetch entirely for the Guest principal — the entity
  // is known never to exist in the catalog for this fork, so a network
  // round-trip would always return 404.
  if (isGuestEntityRef(userEntityRef)) {
    return Promise.resolve(undefined);
  }

  let perApi = catalogProfilePromiseCache.get(catalogApi);
  if (!perApi) {
    perApi = new Map();
    catalogProfilePromiseCache.set(catalogApi, perApi);
  }

  const existing = perApi.get(userEntityRef);
  if (existing) {
    return existing;
  }

  // Store the in-flight promise so concurrent consumers share the request.
  // We intentionally do NOT clear the cache on failure — a failed lookup
  // (404 for a non-Guest, transient network error, etc.) is sticky for
  // the lifetime of the page mount, mirroring how React Query treats
  // settled queries with default `staleTime`. Subsequent calls return
  // the rejected promise, which the caller handles via the existing
  // `useAsync` error path.
  const promise = (async () => {
    try {
      return (await catalogApi.getEntityByRef(userEntityRef)) as unknown as
        | UserEntity
        | undefined;
    } catch (err) {
      // Re-throw so the consuming `useAsync` propagates the error and
      // the alertApi surfaces a user-visible message. The cache holds
      // the rejected promise so repeated mounts within the same session
      // don't re-hit the same broken endpoint.
      throw err;
    }
  })();

  perApi.set(userEntityRef, promise);
  return promise;
}

/** @public */
export const useUserProfile = () => {
  const identityApi = useApi(identityApiRef);
  const alertApi = useApi(alertApiRef);
  const catalogApi = useApi(catalogApiRef);

  const { value, loading, error } = useAsync(async () => {
    let identityProfile = await identityApi.getProfileInfo();
    const backStageIdentity = await identityApi.getBackstageIdentity();
    // QA finding F5 (CP7) — route through the shared cache so multiple
    // consumers of `useUserProfile()` (SignInAvatar, IdentityCard,
    // ProfileCard) issue a single (or zero, for Guest) catalog fetch
    // per mount.
    const catalogProfile = await getCachedCatalogProfile(
      catalogApi,
      backStageIdentity.userEntityRef,
    );
    if (
      identityProfile.picture === undefined &&
      catalogProfile?.spec?.profile?.picture
    ) {
      identityProfile = {
        ...identityProfile,
        picture: catalogProfile.spec.profile.picture,
      };
    }
    return {
      profile: identityProfile,
      identity: backStageIdentity,
    };
  }, []);

  useEffect(() => {
    if (error) {
      alertApi.post({
        message: `Failed to load user identity: ${error}`,
        severity: 'error',
      });
    }
  }, [error, alertApi]);

  if (loading || error) {
    return {
      profile: {} as ProfileInfo,
      displayName: '',
      loading,
    };
  }

  return {
    profile: value!.profile,
    backstageIdentity: value!.identity,
    displayName: value!.profile.displayName ?? value!.identity.userEntityRef,
    loading,
  };
};
