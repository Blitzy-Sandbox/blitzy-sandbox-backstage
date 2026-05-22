/*
 * Copyright 2021 The Backstage Authors
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

import type { GetEntitiesResponse } from '@backstage/catalog-client';
import { Entity } from '@backstage/catalog-model';
import {
  alertApiRef,
  configApiRef,
  errorApiRef,
  identityApiRef,
  storageApiRef,
} from '@backstage/core-plugin-api';
import { translationApiRef } from '@backstage/core-plugin-api/alpha';
import { catalogApiMock } from '@backstage/plugin-catalog-react/testUtils';
import { TestApiProvider } from '@backstage/test-utils';
import { mockApis } from '@backstage/frontend-test-utils';
import { useMountEffect } from '@react-hookz/web';
import { act, renderHook, waitFor } from '@testing-library/react';
import qs from 'qs';
import { PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { catalogApiRef } from '../api';
import { MockStarredEntitiesApi, starredEntitiesApiRef } from '../apis';
import {
  EntityKindFilter,
  EntityOwnerFilter,
  EntityTagFilter,
  EntityTextFilter,
  EntityTypeFilter,
  EntityUserFilter,
} from '../filters';
import { createDeferred } from '@backstage/types';
import { EntityListPagination } from '../types';
import {
  EntityListContextProps,
  EntityListProvider,
  NewEntityListContext,
  useEntityList,
} from './useEntityListProvider';
import { createVersionedValueMap } from '@backstage/version-bridge';

const entities: Entity[] = [
  {
    apiVersion: '1',
    kind: 'Component',
    metadata: {
      name: 'component-1',
    },
    relations: [
      {
        type: 'ownedBy',
        targetRef: 'user:default/guest',
      },
    ],
  },
  {
    apiVersion: '1',
    kind: 'Component',
    metadata: {
      name: 'component-2',
    },
  },
];

const ownershipEntityRefs = ['user:default/guest'];

const mockIdentityApi = mockApis.identity({
  userEntityRef: 'user:default/guest',
  ownershipEntityRefs,
});
const mockCatalogApi = catalogApiMock.mock({
  getEntities: jest.fn().mockResolvedValue({ items: entities }),
  queryEntities: jest.fn().mockResolvedValue({
    items: entities,
    pageInfo: { prevCursor: 'prevCursor', nextCursor: 'nextCursor' },
    totalItems: 10,
  }),
  getEntityByRef: jest.fn().mockResolvedValue(undefined),
});

const createWrapper =
  (options: { location?: string; pagination: EntityListPagination }) =>
  (props: PropsWithChildren) => {
    const InitialFiltersWrapper = ({ children }: PropsWithChildren) => {
      const { updateFilters } = useEntityList();

      useMountEffect(() => {
        updateFilters({ kind: new EntityKindFilter('component', 'Component') });
      });

      return <>{children}</>;
    };

    return (
      <MemoryRouter initialEntries={[options.location ?? '']}>
        <TestApiProvider
          apis={[
            [configApiRef, mockApis.config()],
            [catalogApiRef, mockCatalogApi],
            [identityApiRef, mockIdentityApi],
            [storageApiRef, mockApis.storage()],
            [starredEntitiesApiRef, new MockStarredEntitiesApi()],
            [alertApiRef, mockApis.alert()],
            [translationApiRef, mockApis.translation()],
            [errorApiRef, { error$: jest.fn(), post: jest.fn() }],
          ]}
        >
          <EntityListProvider pagination={options.pagination}>
            <InitialFiltersWrapper>{props.children}</InitialFiltersWrapper>
          </EntityListProvider>
        </TestApiProvider>
      </MemoryRouter>
    );
  };

describe('<EntityListProvider />', () => {
  const origReplaceState = window.history.replaceState;
  const pagination = false;

  beforeEach(() => {
    window.history.replaceState = jest.fn();
  });
  afterEach(() => {
    window.history.replaceState = origReplaceState;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should send backend filters', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    await waitFor(() => {
      expect(result.current.backendEntities.length).toBe(2);
    });

    expect(result.current.entities.length).toBe(2);
    expect(mockCatalogApi.getEntities).toHaveBeenCalledTimes(1);
    expect(mockCatalogApi.getEntities).toHaveBeenCalledWith({
      filter: { kind: 'component' },
      order: [{ field: 'metadata.name', order: 'asc' }],
    });
  });

  it('resolves frontend filters', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
      initialProps: {
        userFilter: 'all',
      },
    });

    act(() =>
      result.current.updateFilters({
        user: EntityUserFilter.owned(ownershipEntityRefs),
      }),
    );

    await waitFor(() => {
      expect(result.current.backendEntities.length).toBe(2);
      expect(result.current.entities.length).toBe(1);
      expect(mockCatalogApi.getEntities).toHaveBeenCalledTimes(1);
    });
  });

  it('ignores search text when not paginating', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
      initialProps: {
        userFilter: 'all',
      },
    });

    act(() =>
      result.current.updateFilters({
        text: new EntityTextFilter('1'),
      }),
    );

    await waitFor(() => {
      expect(result.current.backendEntities.length).toBe(2);
      expect(result.current.entities.length).toBe(1);
      expect(mockCatalogApi.getEntities).toHaveBeenCalledTimes(1);
      expect(mockCatalogApi.getEntities).toHaveBeenCalledWith({
        filter: { kind: 'component' },
        order: [{ field: 'metadata.name', order: 'asc' }],
      });
    });
  });

  it('resolves query param filter values', async () => {
    const query = qs.stringify({
      filters: { kind: 'component', type: 'service' },
    });
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({
        location: `/catalog?${query}`,
        pagination,
      }),
    });

    await waitFor(() => {
      expect(result.current.queryParameters).toBeTruthy();
    });
    expect(result.current.queryParameters).toEqual({
      kind: 'component',
      type: 'service',
    });
  });

  it('resolves query param filter values with large arrays', async () => {
    const largeArray = Array.from({ length: 50 }, (_, i) => `owner-${i}`);
    const query = qs.stringify({
      filters: { kind: 'component', owners: largeArray },
    });
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({
        location: `/catalog?${query}`,
        pagination,
      }),
    });

    await waitFor(() => {
      expect(result.current.queryParameters).toBeTruthy();
    });
    expect(result.current.queryParameters).toEqual({
      kind: 'component',
      owners: largeArray,
    });
  });

  it('does not fetch when only frontend filters change', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    await waitFor(() => {
      expect(result.current.entities.length).toBe(2);
      expect(mockCatalogApi.getEntities).toHaveBeenCalledTimes(1);
    });

    act(() =>
      result.current.updateFilters({
        user: EntityUserFilter.owned(ownershipEntityRefs),
      }),
    );

    await waitFor(() => {
      expect(result.current.entities.length).toBe(1);
    });
    expect(result.current.totalItems).toBe(1);

    await expect(() =>
      waitFor(() => {
        expect(mockCatalogApi.getEntities).not.toHaveBeenCalledTimes(1);
      }),
    ).rejects.toThrow();
  });

  it('debounces multiple filter changes', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    await waitFor(() => {
      expect(result.current.backendEntities.length).toBeGreaterThan(0);
    });
    expect(result.current.totalItems).toBe(2);
    expect(result.current.backendEntities.length).toBe(2);
    expect(mockCatalogApi.getEntities).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.updateFilters({
        kind: new EntityKindFilter('api', 'API'),
      });
      result.current.updateFilters({ type: new EntityTypeFilter('service') });
    });

    await waitFor(() => {
      expect(mockCatalogApi.getEntities).toHaveBeenNthCalledWith(2, {
        filter: { kind: 'api', 'spec.type': ['service'] },
        order: [{ field: 'metadata.name', order: 'asc' }],
      });
    });
  });

  it('returns an error on catalogApi failure', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    await waitFor(() => {
      expect(result.current.backendEntities.length).toBeGreaterThan(0);
    });
    expect(result.current.backendEntities.length).toBe(2);

    expect(result.current.totalItems).toBe(2);

    mockCatalogApi.getEntities!.mockRejectedValueOnce('error');
    act(() => {
      result.current.updateFilters({
        kind: new EntityKindFilter('api', 'API'),
      });
    });
    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });
  });

  it('returns an empty pageInfo', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });
    await waitFor(() => {
      expect(mockCatalogApi.getEntities).toHaveBeenCalled();
    });

    expect(result.current.pageInfo).toBeUndefined();
  });

  it('should omit owners filter when kind is "user"', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    act(() => {
      result.current.updateFilters({
        kind: new EntityKindFilter('user', 'User'),
        owners: new EntityOwnerFilter(['user:default/guest']),
      });
    });

    await waitFor(() => {
      expect(mockCatalogApi.getEntities).toHaveBeenCalled();
    });

    expect(mockCatalogApi.getEntities).toHaveBeenCalledWith({
      filter: { kind: 'user' },
      order: [{ field: 'metadata.name', order: 'asc' }],
    });
  });

  it('should omit owners filter when kind is "group"', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    act(() => {
      result.current.updateFilters({
        kind: new EntityKindFilter('group', 'Group'),
        owners: new EntityOwnerFilter(['group:default/team-a']),
      });
    });

    await waitFor(() => {
      expect(mockCatalogApi.getEntities).toHaveBeenCalled();
    });

    expect(mockCatalogApi.getEntities).toHaveBeenCalledWith({
      filter: { kind: 'group' },
      order: [{ field: 'metadata.name', order: 'asc' }],
    });
  });

  it('uses the last applied filter even if an earlier request finishes later', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    const firstResult = createDeferred<GetEntitiesResponse>();
    const secondResult = createDeferred<GetEntitiesResponse>();

    await waitFor(() => {
      expect(result.current.backendEntities.length).toBeGreaterThan(0);
    });
    expect(result.current.totalItems).toBe(2);
    expect(result.current.backendEntities.length).toBe(2);
    expect(mockCatalogApi.getEntities).toHaveBeenCalledTimes(1);

    mockCatalogApi.getEntities!.mockReturnValueOnce(firstResult);

    await act(async () => {
      result.current.updateFilters({
        kind: new EntityKindFilter('api', 'API'),
      });
    });

    await waitFor(() => {
      expect(mockCatalogApi.getEntities).toHaveBeenNthCalledWith(2, {
        filter: { kind: 'api' },
        order: [{ field: 'metadata.name', order: 'asc' }],
      });
    });

    mockCatalogApi.getEntities!.mockReturnValueOnce(secondResult);

    await act(async () => {
      result.current.updateFilters({
        kind: new EntityKindFilter('system', 'System'),
      });
    });

    await waitFor(() => {
      expect(mockCatalogApi.getEntities).toHaveBeenNthCalledWith(3, {
        filter: { kind: 'system' },
        order: [{ field: 'metadata.name', order: 'asc' }],
      });
    });

    await act(async () => {
      secondResult.resolve({
        items: [],
      });
      firstResult.resolve({
        items: entities,
      });
    });

    expect(result.current.filters.kind!.value).toBe('system');
    expect(result.current.backendEntities.length).toBe(0);
  });
});

describe('<EntityListProvider pagination />', () => {
  const origReplaceState = window.history.replaceState;
  const pagination = true;
  const limit = 20;
  const orderFields = [{ field: 'metadata.name', order: 'asc' }];

  beforeEach(() => {
    window.history.replaceState = jest.fn();
  });
  afterEach(() => {
    window.history.replaceState = origReplaceState;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends search text to the backend', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
      initialProps: {
        userFilter: 'all',
      },
    });

    act(() =>
      result.current.updateFilters({
        text: new EntityTextFilter('2'),
      }),
    );

    await waitFor(() => {
      expect(mockCatalogApi.getEntities).not.toHaveBeenCalledTimes(1);
      expect(result.current.entities.length).toBe(1);
      expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(1);
      expect(mockCatalogApi.queryEntities).toHaveBeenCalledWith({
        filter: { kind: 'component' },
        limit,
        orderFields,
        fullTextFilter: {
          term: '2',
          fields: [
            'metadata.name',
            'metadata.title',
            'spec.profile.displayName',
          ],
        },
      });
    });
  });

  it('should send backend filters', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    await waitFor(() => {
      expect(result.current.backendEntities.length).toBe(2);
    });

    expect(result.current.entities.length).toBe(2);
    expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(1);
    expect(mockCatalogApi.queryEntities).toHaveBeenCalledWith({
      filter: { kind: 'component' },
      limit,
      orderFields,
    });
  });

  it('resolves frontend filters', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
      initialProps: {
        userFilter: 'all',
      },
    });

    act(() =>
      result.current.updateFilters({
        user: EntityUserFilter.owned(ownershipEntityRefs),
      }),
    );

    await waitFor(() => {
      expect(result.current.backendEntities.length).toBe(2);
      expect(result.current.entities.length).toBe(1);
      expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(1);
    });
  });

  it('applies frontend-only filters without refetching', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    await waitFor(() => {
      expect(result.current.backendEntities.length).toBe(2);
      expect(result.current.filters.kind?.value).toBe('component');
    });

    act(() =>
      result.current.updateFilters({
        user: EntityUserFilter.all(),
      }),
    );

    await waitFor(() => {
      expect(result.current.filters.user?.value).toBe('all');
      expect(result.current.entities.length).toBe(2);
    });
    expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(1);
  });

  it('resolves query param filter values', async () => {
    const query = qs.stringify({
      filters: { kind: 'component', type: 'service' },
    });
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({
        location: `/catalog?${query}`,
        pagination,
      }),
    });

    await waitFor(() => {
      expect(result.current.queryParameters).toBeTruthy();
    });
    expect(result.current.queryParameters).toEqual({
      kind: 'component',
      type: 'service',
    });
  });

  it('fetch when frontend filters change', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    await waitFor(() => {
      expect(result.current.entities.length).toBe(2);
      expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(1);
    });

    act(() =>
      result.current.updateFilters({
        user: EntityUserFilter.owned(ownershipEntityRefs),
      }),
    );

    await waitFor(() => {
      expect(result.current.entities.length).toBe(1);
    });

    await waitFor(() => {
      expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(2);
    });
  });

  it('debounces multiple filter changes', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    await waitFor(() => {
      expect(result.current.backendEntities.length).toBeGreaterThan(0);
    });
    expect(result.current.backendEntities.length).toBe(2);
    expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.updateFilters({
        kind: new EntityKindFilter('api', 'API'),
      });
      result.current.updateFilters({ type: new EntityTypeFilter('service') });
    });

    await waitFor(() => {
      expect(mockCatalogApi.queryEntities).toHaveBeenNthCalledWith(2, {
        filter: { kind: 'api', 'spec.type': ['service'] },
        limit,
        orderFields,
      });
    });

    // `response.totalItems` is the backend's authoritative paginated total
    // for the OR-emitted backend filter shape and is propagated unchanged
    // whenever no multi-tag `EntityTagFilter` narrowing applies. The mock
    // returns `response.totalItems = 10` and the test exercises only
    // `EntityKindFilter` + `EntityTypeFilter`, neither of which defines a
    // frontend `filterEntity` predicate; so the displayed count is the
    // backend total (10), preserving pagination semantics (next-page
    // availability, `X of N` footers, offset clamping). The AAP multi-tag
    // count fix is exercised by dedicated unit and E2E tests against
    // `EntityTagFilter` directly.
    expect(result.current.totalItems).toBe(10);
  });

  it('recounts totalItems via unpaginated getEntities when multi-tag EntityTagFilter is active', async () => {
    // Multi-tag tag filtering surfaces an OR/AND mismatch: the backend
    // evaluates `{ 'metadata.tags': [a, b] }` as OR (returning a
    // superset), but the frontend narrows the rendered row list to AND
    // via `EntityTagFilter.filterEntity.every`. To keep the displayed
    // count consistent with the rendered row count across all pages,
    // `useEntityListProvider` issues a secondary unpaginated
    // `getEntities` request and applies the same AND predicate to the
    // unbounded result set. This test asserts that:
    //   1. `response.totalItems` is propagated unchanged for the
    //      initial single-filter fetch (no multi-tag narrowing).
    //   2. After a multi-tag `EntityTagFilter` is applied, the hook
    //      issues a secondary unpaginated `getEntities` request against
    //      the OR-emitted backend filter shape.
    //   3. The displayed `totalItems` is the AND-narrowed count derived
    //      from the secondary request — NOT the OR-superset
    //      `response.totalItems` and NOT the current page's row count
    //      (the previously broken `Math.min` behavior).
    const taggedEntities: Entity[] = [
      {
        apiVersion: '1',
        kind: 'Component',
        metadata: { name: 'a', tags: ['java', 'spring'] },
      },
      {
        apiVersion: '1',
        kind: 'Component',
        metadata: { name: 'b', tags: ['java', 'spring'] },
      },
      {
        apiVersion: '1',
        kind: 'Component',
        metadata: { name: 'c', tags: ['java'] },
      },
      {
        apiVersion: '1',
        kind: 'Component',
        metadata: { name: 'd', tags: ['spring'] },
      },
    ];

    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    // First, wait for the initial render driven by `InitialFiltersWrapper`
    // to settle. That render uses the default `queryEntities` mock which
    // returns `totalItems: 10` and the original two-component fixture
    // (`entities`). At this point no multi-tag narrowing applies, so the
    // count fix must NOT recount — `response.totalItems` is propagated
    // verbatim.
    await waitFor(() => {
      expect(result.current.entities.length).toBe(2);
      expect(result.current.totalItems).toBe(10);
    });
    expect(mockCatalogApi.getEntities).not.toHaveBeenCalled();

    // Now arrange the multi-tag scenario. The next `queryEntities` call
    // (triggered by the upcoming `updateFilters({ tags })`) returns the
    // OR-superset page with a distinctive `totalItems` (50) so the
    // assertion below cannot be accidentally satisfied by the
    // OR-superset value. The secondary unpaginated `getEntities` call
    // returns the same OR-superset, and the hook AND-narrows it to 2
    // entities via the same `entityFilter` predicate.
    mockCatalogApi.queryEntities!.mockResolvedValueOnce({
      items: taggedEntities,
      pageInfo: {},
      totalItems: 50,
    });
    mockCatalogApi.getEntities!.mockResolvedValueOnce({
      items: taggedEntities,
    });

    act(() =>
      result.current.updateFilters({
        tags: new EntityTagFilter(['java', 'spring']),
      }),
    );

    // AND-narrowed total via the secondary recount: 2 of the 4
    // OR-superset entities carry both tags. The OR-superset
    // `response.totalItems` of 50 must NOT leak through, and neither
    // must the current-page row count (the previously broken behavior).
    await waitFor(() => {
      expect(result.current.entities.length).toBe(2);
      expect(result.current.totalItems).toBe(2);
    });

    // Confirm the secondary recount was issued against the OR-emitted
    // backend filter shape (kind + tags as a single multi-value
    // `metadata.tags` array).
    expect(mockCatalogApi.getEntities).toHaveBeenCalledWith({
      filter: {
        kind: 'component',
        'metadata.tags': ['java', 'spring'],
      },
      order: orderFields,
    });
  });

  it('does not issue a secondary recount when a single tag is selected', async () => {
    // Single-tag selection has identical OR and AND semantics, so the
    // hook MUST NOT issue a secondary unpaginated `getEntities`
    // request — the backend's `response.totalItems` is already the
    // correct narrowed total. This test exercises the multi-tag guard
    // boundary so a regression that issues unnecessary backend traffic
    // (or, conversely, that fails to recount when truly needed) is
    // detected.
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    // Settle the initial render with the default mocks first.
    await waitFor(() => {
      expect(result.current.entities.length).toBe(2);
      expect(result.current.totalItems).toBe(10);
    });

    // Arrange the next `queryEntities` response with a distinctive
    // total (7) so the assertion below confirms the backend total is
    // propagated unchanged when only a single tag is selected.
    mockCatalogApi.queryEntities!.mockResolvedValueOnce({
      items: entities,
      pageInfo: { prevCursor: 'prevCursor', nextCursor: 'nextCursor' },
      totalItems: 7,
    });

    act(() =>
      result.current.updateFilters({
        tags: new EntityTagFilter(['java']),
      }),
    );

    await waitFor(() => {
      expect(result.current.totalItems).toBe(7);
    });
    // No secondary `getEntities` call should have been made — the
    // entire test runs in paginated cursor mode against `queryEntities`
    // only, and single-tag selection does not trigger the recount
    // branch.
    expect(mockCatalogApi.getEntities).not.toHaveBeenCalled();
  });

  it('returns an error on catalogApi failure', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    await waitFor(() => {
      expect(result.current.backendEntities.length).toBeGreaterThan(0);
    });
    expect(result.current.backendEntities.length).toBe(2);

    mockCatalogApi.queryEntities!.mockRejectedValueOnce('error');
    act(() => {
      result.current.updateFilters({
        kind: new EntityKindFilter('api', 'API'),
      });
    });
    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });
  });

  describe('pageInfo', () => {
    it('returns an empty pageInfo', async () => {
      mockCatalogApi.queryEntities!.mockResolvedValueOnce({
        items: [],
        pageInfo: {},
        totalItems: 10,
      });
      const { result } = renderHook(() => useEntityList(), {
        wrapper: createWrapper({ pagination }),
      });
      await waitFor(() => {
        expect(mockCatalogApi.queryEntities).toHaveBeenCalled();
      });

      expect(result.current.pageInfo).toStrictEqual({
        prev: undefined,
        next: undefined,
      });
    });

    it('returns pageInfo with next function and properly fetch next batch', async () => {
      const { result } = renderHook(() => useEntityList(), {
        wrapper: createWrapper({ pagination }),
      });
      await waitFor(() => {
        expect(mockCatalogApi.queryEntities).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(result.current.pageInfo!.next).toBeDefined();
      });

      act(() => {
        result.current.pageInfo!.next!();
      });

      await waitFor(() => {
        expect(mockCatalogApi.queryEntities).toHaveBeenCalledWith({
          cursor: 'nextCursor',
          limit,
        });
      });
    });

    it('returns pageInfo with prev function and properly fetch prev batch', async () => {
      const { result } = renderHook(() => useEntityList(), {
        wrapper: createWrapper({ pagination }),
      });
      await waitFor(() => {
        expect(mockCatalogApi.queryEntities).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(result.current.pageInfo!.prev).toBeDefined();
      });

      act(() => {
        result.current.pageInfo!.prev!();
      });

      await waitFor(() => {
        expect(mockCatalogApi.queryEntities).toHaveBeenCalledWith({
          cursor: 'prevCursor',
          limit,
        });
      });
    });

    it('should omit owners filter when kind is "user"', async () => {
      const { result } = renderHook(() => useEntityList(), {
        wrapper: createWrapper({ pagination }),
      });

      act(() => {
        result.current.updateFilters({
          kind: new EntityKindFilter('user', 'User'),
          owners: new EntityOwnerFilter(['user:default/guest']),
        });
      });

      await waitFor(() => {
        expect(mockCatalogApi.queryEntities).toHaveBeenCalled();
      });

      expect(mockCatalogApi.queryEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { kind: 'user' },
        }),
      );
    });

    it('should omit owners filter when kind is "group"', async () => {
      const { result } = renderHook(() => useEntityList(), {
        wrapper: createWrapper({ pagination }),
      });

      act(() => {
        result.current.updateFilters({
          kind: new EntityKindFilter('group', 'Group'),
          owners: new EntityOwnerFilter(['group:default/team-a']),
        });
      });

      await waitFor(() => {
        expect(mockCatalogApi.queryEntities).toHaveBeenCalled();
      });

      expect(mockCatalogApi.queryEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { kind: 'group' },
        }),
      );
    });
  });
});

describe(`<EntityListProvider pagination={{ mode: 'offset' }} />`, () => {
  const origReplaceState = window.history.replaceState;
  const pagination: EntityListPagination = { mode: 'offset' };
  const limit = 20;
  const orderFields = [{ field: 'metadata.name', order: 'asc' }];

  beforeEach(() => {
    window.history.replaceState = jest.fn();
  });
  afterEach(() => {
    window.history.replaceState = origReplaceState;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends search text to the backend', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
      initialProps: {
        userFilter: 'all',
      },
    });

    act(() =>
      result.current.updateFilters({
        text: new EntityTextFilter('2'),
      }),
    );

    await waitFor(() => {
      expect(mockCatalogApi.getEntities).not.toHaveBeenCalledTimes(1);
      expect(result.current.entities.length).toBe(1);
      expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(1);
      expect(mockCatalogApi.queryEntities).toHaveBeenCalledWith({
        filter: { kind: 'component' },
        limit,
        offset: 0,
        orderFields,
        fullTextFilter: {
          term: '2',
          fields: [
            'metadata.name',
            'metadata.title',
            'spec.profile.displayName',
          ],
        },
      });
    });
  });

  it('should send backend filters', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    await waitFor(() => {
      expect(result.current.backendEntities.length).toBe(2);
    });

    expect(result.current.entities.length).toBe(2);
    expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(1);
    expect(mockCatalogApi.queryEntities).toHaveBeenCalledWith({
      filter: { kind: 'component' },
      limit,
      offset: 0,
      orderFields,
    });
  });

  it('resolves frontend filters', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
      initialProps: {
        userFilter: 'all',
      },
    });

    act(() =>
      result.current.updateFilters({
        user: EntityUserFilter.owned(ownershipEntityRefs),
      }),
    );

    await waitFor(() => {
      expect(result.current.backendEntities.length).toBe(2);
      expect(result.current.entities.length).toBe(1);
      expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(1);
    });
  });

  it('applies frontend-only filters without refetching', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    await waitFor(() => {
      expect(result.current.backendEntities.length).toBe(2);
      expect(result.current.filters.kind?.value).toBe('component');
    });

    act(() =>
      result.current.updateFilters({
        user: EntityUserFilter.all(),
      }),
    );

    await waitFor(() => {
      expect(result.current.filters.user?.value).toBe('all');
      expect(result.current.entities.length).toBe(2);
    });
    expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(1);
  });

  it('resolves query param filter values', async () => {
    const query = qs.stringify({
      filters: { kind: 'component', type: 'service' },
    });
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({
        location: `/catalog?${query}`,
        pagination,
      }),
    });

    await waitFor(() => {
      expect(result.current.queryParameters).toBeTruthy();
    });
    expect(result.current.queryParameters).toEqual({
      kind: 'component',
      type: 'service',
    });
  });

  it('fetch when frontend filters change', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    await waitFor(() => {
      expect(result.current.entities.length).toBe(2);
      expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(1);
    });

    act(() =>
      result.current.updateFilters({
        user: EntityUserFilter.owned(ownershipEntityRefs),
      }),
    );

    await waitFor(() => {
      expect(result.current.entities.length).toBe(1);
    });

    await waitFor(() => {
      expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(2);
    });

    act(() =>
      result.current.updateFilters({
        user: EntityUserFilter.owned(ownershipEntityRefs),
      }),
    );

    await expect(() =>
      waitFor(() => {
        expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(3);
      }),
    ).rejects.toThrow();
  });

  it('fetch when limit change', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    await waitFor(() => {
      expect(result.current.entities.length).toBe(2);
      expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(1);
    });

    act(() => result.current.setLimit(50));

    await waitFor(() => {
      expect(result.current.entities.length).toBe(2);
    });

    await waitFor(() => {
      expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(2);
      expect(result.current.limit).toEqual(50);
    });
  });

  it('debounces multiple filter changes', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    await waitFor(() => {
      expect(result.current.backendEntities.length).toBeGreaterThan(0);
    });
    expect(result.current.backendEntities.length).toBe(2);
    expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.updateFilters({
        kind: new EntityKindFilter('api', 'API'),
      });
      result.current.updateFilters({ type: new EntityTypeFilter('service') });
    });

    await waitFor(() => {
      expect(mockCatalogApi.queryEntities).toHaveBeenNthCalledWith(2, {
        filter: { kind: 'api', 'spec.type': ['service'] },
        limit,
        offset: 0,
        orderFields,
      });
    });
  });

  it('recounts totalItems via unpaginated getEntities when multi-tag EntityTagFilter is active', async () => {
    // Offset-mode counterpart of the cursor-mode multi-tag recount test
    // in the `<EntityListProvider pagination />` describe block. The two
    // pagination modes share the same `computePaginatedTotalItems`
    // helper in `useEntityListProvider.tsx` but reach it through
    // distinct branches (offset fresh-fetch vs cursor fresh-fetch), so
    // both branches MUST be exercised to prevent a regression in either
    // path. See AAP §0.1.3 Critical Test Scenario:
    //   "Verify that when two or more tags are selected in the Catalog
    //   view, the displayed count of catalog items at the top correctly
    //   reflects the number of items matching *all* selected tags (AND
    //   logic). The actual displayed list should remain correct."
    const taggedEntities: Entity[] = [
      {
        apiVersion: '1',
        kind: 'Component',
        metadata: { name: 'a', tags: ['java', 'spring'] },
      },
      {
        apiVersion: '1',
        kind: 'Component',
        metadata: { name: 'b', tags: ['java', 'spring'] },
      },
      {
        apiVersion: '1',
        kind: 'Component',
        metadata: { name: 'c', tags: ['java'] },
      },
      {
        apiVersion: '1',
        kind: 'Component',
        metadata: { name: 'd', tags: ['spring'] },
      },
    ];

    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    // Settle the initial render driven by `InitialFiltersWrapper`. The
    // default `queryEntities` mock returns `totalItems: 10` with the
    // original two-component fixture (`entities`). At this point no
    // multi-tag narrowing applies, so the count fix must NOT recount —
    // `response.totalItems` is propagated verbatim.
    await waitFor(() => {
      expect(result.current.entities.length).toBe(2);
      expect(result.current.totalItems).toBe(10);
    });
    expect(mockCatalogApi.getEntities).not.toHaveBeenCalled();

    // Arrange the multi-tag scenario. The next `queryEntities` call
    // (triggered by the upcoming `updateFilters({ tags })`) returns the
    // OR-superset offset page with a distinctive `totalItems` (50) so
    // the assertion below cannot be accidentally satisfied by the
    // OR-superset value. The secondary unpaginated `getEntities` call
    // returns the same OR-superset, and the hook AND-narrows it to 2
    // entities via the same `entityFilter` predicate.
    mockCatalogApi.queryEntities!.mockResolvedValueOnce({
      items: taggedEntities,
      pageInfo: {},
      totalItems: 50,
    });
    mockCatalogApi.getEntities!.mockResolvedValueOnce({
      items: taggedEntities,
    });

    act(() =>
      result.current.updateFilters({
        tags: new EntityTagFilter(['java', 'spring']),
      }),
    );

    // AND-narrowed total via the secondary recount: 2 of the 4
    // OR-superset entities carry both tags. The OR-superset
    // `response.totalItems` of 50 must NOT leak through.
    await waitFor(() => {
      expect(result.current.entities.length).toBe(2);
      expect(result.current.totalItems).toBe(2);
    });

    // Confirm the secondary recount was issued against the OR-emitted
    // backend filter shape (kind + tags as a single multi-value
    // `metadata.tags` array). The wire format is the only shape
    // carried by `EntityFilterQuery` and remains OR-compatible after
    // the fix; the AND-narrowing happens client-side via
    // `EntityTagFilter.filterEntity.every`.
    expect(mockCatalogApi.getEntities).toHaveBeenCalledWith({
      filter: {
        kind: 'component',
        'metadata.tags': ['java', 'spring'],
      },
      order: orderFields,
    });
  });

  it('debounces multiple offset changes', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    await waitFor(() => {
      expect(result.current.backendEntities.length).toBeGreaterThan(0);
    });
    expect(result.current.backendEntities.length).toBe(2);
    expect(mockCatalogApi.queryEntities).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setOffset!(5);
      result.current.setOffset!(10);
    });

    await waitFor(() => {
      expect(mockCatalogApi.queryEntities).toHaveBeenNthCalledWith(2, {
        filter: { kind: 'component' },
        limit,
        offset: 10,
        orderFields,
      });
      expect(result.current.offset).toEqual(10);
    });
  });

  it('returns an error on catalogApi failure', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    await waitFor(() => {
      expect(result.current.backendEntities.length).toBeGreaterThan(0);
    });
    expect(result.current.backendEntities.length).toBe(2);

    mockCatalogApi.queryEntities!.mockRejectedValueOnce('error');
    act(() => {
      result.current.updateFilters({
        kind: new EntityKindFilter('api', 'API'),
      });
    });
    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });
  });

  it('should omit owners filter when kind is "user"', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    act(() => {
      result.current.updateFilters({
        kind: new EntityKindFilter('user', 'User'),
        owners: new EntityOwnerFilter(['user:default/guest']),
      });
    });

    await waitFor(() => {
      expect(mockCatalogApi.queryEntities).toHaveBeenCalled();
    });

    expect(mockCatalogApi.queryEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: { kind: 'user' },
      }),
    );
  });

  it('should omit owners filter when kind is "group"', async () => {
    const { result } = renderHook(() => useEntityList(), {
      wrapper: createWrapper({ pagination }),
    });

    act(() => {
      result.current.updateFilters({
        kind: new EntityKindFilter('group', 'Group'),
        owners: new EntityOwnerFilter(['group:default/team-a']),
      });
    });

    await waitFor(() => {
      expect(mockCatalogApi.queryEntities).toHaveBeenCalled();
    });

    expect(mockCatalogApi.queryEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: { kind: 'group' },
      }),
    );
  });
});

describe('versioned context', () => {
  it('should work explicitly with new versioned contexts', () => {
    const value: EntityListContextProps<any> = {
      filters: {},
      entities: [],
      backendEntities: [],
      updateFilters: jest.fn(),
      queryParameters: {},
      loading: true,
      limit: 277,
      setLimit: jest.fn(),
      setOffset: jest.fn(),
      paginationMode: 'none',
    };

    const { result } = renderHook(() => useEntityList(), {
      wrapper: ({ children }) => {
        const InitialFiltersWrapper = (f: PropsWithChildren<{}>) => {
          const { updateFilters } = useEntityList();
          useMountEffect(() => {
            updateFilters({
              kind: new EntityKindFilter('component', 'Component'),
            });
          });
          return <>{f.children}</>;
        };

        return (
          <MemoryRouter initialEntries={['/catalog']}>
            <TestApiProvider
              apis={[
                [configApiRef, mockApis.config()],
                [catalogApiRef, mockCatalogApi],
                [identityApiRef, mockIdentityApi],
                [storageApiRef, mockApis.storage()],
                [starredEntitiesApiRef, new MockStarredEntitiesApi()],
                [alertApiRef, { post: jest.fn() }],
                [translationApiRef, mockApis.translation()],
                [errorApiRef, { error$: jest.fn(), post: jest.fn() }],
              ]}
            >
              <NewEntityListContext.Provider
                value={createVersionedValueMap({ 1: value })}
              >
                <InitialFiltersWrapper>{children}</InitialFiltersWrapper>
              </NewEntityListContext.Provider>
            </TestApiProvider>
          </MemoryRouter>
        );
      },
    });

    expect(result.current.limit).toBe(277);
  });
});
