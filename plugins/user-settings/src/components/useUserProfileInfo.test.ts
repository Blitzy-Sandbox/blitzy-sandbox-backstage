/*
 * Copyright 2025 The Backstage Authors
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

import type { CatalogApi } from '@backstage/plugin-catalog-react';
import { getCachedCatalogProfile } from './useUserProfileInfo';

/**
 * Minimal CatalogApi stub — only `getEntityByRef` is exercised by the
 * cache helper. The other methods are typed as no-ops so TypeScript
 * accepts the stub as a `CatalogApi`.
 */
function makeCatalogApiStub(): CatalogApi & {
  calls: { entityByRef: string[] };
} {
  const calls = { entityByRef: [] as string[] };
  const api = {
    calls,
    getEntityByRef: jest.fn(async (ref: string) => {
      calls.entityByRef.push(ref);
      return undefined;
    }),
  } as unknown as CatalogApi & { calls: { entityByRef: string[] } };
  return api;
}

describe('getCachedCatalogProfile (F5 regression — Settings page entity fetch)', () => {
  it('returns undefined synchronously for user:default/guest without firing a request', async () => {
    const api = makeCatalogApiStub();
    const result = await getCachedCatalogProfile(api, 'user:default/guest');
    expect(result).toBeUndefined();
    expect(api.calls.entityByRef).toEqual([]);
  });

  it('returns undefined synchronously for user:development/guest without firing a request', async () => {
    const api = makeCatalogApiStub();
    const result = await getCachedCatalogProfile(api, 'user:development/guest');
    expect(result).toBeUndefined();
    expect(api.calls.entityByRef).toEqual([]);
  });

  it('returns undefined synchronously for case-variant guest refs', async () => {
    const api = makeCatalogApiStub();
    await getCachedCatalogProfile(api, 'USER:Development/Guest');
    await getCachedCatalogProfile(api, 'User:Default/GUEST');
    expect(api.calls.entityByRef).toEqual([]);
  });

  it('does NOT skip the request for similar-looking non-guest refs', async () => {
    const api = makeCatalogApiStub();
    await getCachedCatalogProfile(api, 'user:default/guest-account');
    await getCachedCatalogProfile(api, 'user:default/guests');
    expect(api.calls.entityByRef).toEqual([
      'user:default/guest-account',
      'user:default/guests',
    ]);
  });

  it('deduplicates concurrent calls for the same entity ref', async () => {
    const api = makeCatalogApiStub();
    const p1 = getCachedCatalogProfile(api, 'user:default/alice');
    const p2 = getCachedCatalogProfile(api, 'user:default/alice');
    const p3 = getCachedCatalogProfile(api, 'user:default/alice');
    await Promise.all([p1, p2, p3]);
    // The three consumers must share the SAME in-flight promise, so the
    // CatalogApi should only have been hit once.
    expect(api.calls.entityByRef).toEqual(['user:default/alice']);
  });

  it('deduplicates sequential calls after settlement', async () => {
    const api = makeCatalogApiStub();
    await getCachedCatalogProfile(api, 'user:default/bob');
    await getCachedCatalogProfile(api, 'user:default/bob');
    expect(api.calls.entityByRef).toEqual(['user:default/bob']);
  });

  it('does not dedupe across different entity refs', async () => {
    const api = makeCatalogApiStub();
    await getCachedCatalogProfile(api, 'user:default/alice');
    await getCachedCatalogProfile(api, 'user:default/bob');
    expect(api.calls.entityByRef).toEqual([
      'user:default/alice',
      'user:default/bob',
    ]);
  });

  it('does not dedupe across different CatalogApi instances', async () => {
    const api1 = makeCatalogApiStub();
    const api2 = makeCatalogApiStub();
    await getCachedCatalogProfile(api1, 'user:default/alice');
    await getCachedCatalogProfile(api2, 'user:default/alice');
    expect(api1.calls.entityByRef).toEqual(['user:default/alice']);
    expect(api2.calls.entityByRef).toEqual(['user:default/alice']);
  });
});
