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

import { QueryEntitiesInitialRequest } from '@backstage/catalog-client';
import { RELATION_OWNED_BY } from '@backstage/catalog-model';
import { TableColumn, TableProps } from '@backstage/core-components';
import { identityApiRef, storageApiRef } from '@backstage/core-plugin-api';
import {
  catalogApiRef,
  entityRouteRef,
  MockStarredEntitiesApi,
  starredEntitiesApiRef,
} from '@backstage/plugin-catalog-react';
import {
  TestApiProvider,
  mockApis,
  renderInTestApp,
} from '@backstage/test-utils';
import { LayoutDashboard } from 'lucide-react';
import { screen, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { createComponentRouteRef } from '../../routes';
import { CatalogTableRow } from '../CatalogTable';
import { DefaultCatalogPage } from './DefaultCatalogPage';

import { CatalogTableColumnsFunc } from '../CatalogTable/types';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import { catalogApiMock } from '@backstage/plugin-catalog-react/testUtils';

describe('DefaultCatalogPage', () => {
  const origReplaceState = window.history.replaceState;
  beforeEach(() => {
    window.history.replaceState = jest.fn();
  });
  afterEach(() => {
    window.history.replaceState = origReplaceState;
    jest.clearAllMocks();
  });

  // The catalog page in the post-refactor codebase (after commit 0ca9c20d42
  // "simplify catalog and docs filters with inline toolbar") no longer
  // mounts the legacy UserListPicker / CatalogFilterLayout. The
  // `EntityListProvider` issues a `queryEntities` request, and the
  // resulting items are forwarded to the catalog table. The default-case
  // mock now returns the two Component entities so the table actually
  // renders rows and the action / column-function assertions have data to
  // bind against.
  // NB: each entity carries the `blitzy.io/has-project-history: 'true'`
  // annotation because `BaseCatalogPage` installs the
  // `EntityHasProjectHistoryPicker` filter (see
  // `plugins/catalog/src/components/CatalogPage/DefaultCatalogPage.tsx`).
  // Without that annotation, the frontend `filterEntity` predicate would
  // hide every test row and the table would render as
  // "All components (0)". Real-world entities receive this annotation
  // from a backend processor — see
  // `plugins/catalog-react/src/filters.ts` (`EntityHasProjectHistoryFilter`).
  const defaultEntities = [
    {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'Entity1',
        namespace: 'default',
        annotations: {
          'blitzy.io/has-project-history': 'true',
        },
      },
      spec: {
        owner: 'tools',
        type: 'service',
      },
      relations: [
        {
          type: RELATION_OWNED_BY,
          targetRef: 'group:default/tools',
        },
      ],
    },
    {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'Entity2',
        namespace: 'default',
        annotations: {
          'blitzy.io/has-project-history': 'true',
        },
      },
      spec: {
        owner: 'not-tools',
        type: 'service',
      },
      relations: [
        {
          type: RELATION_OWNED_BY,
          targetRef: 'group:default/not-tools',
          target: {
            kind: 'group',
            name: 'not-tools',
            namespace: 'default',
          },
        },
      ],
    },
  ];

  const catalogApi = catalogApiMock.mock({
    getEntities: jest.fn().mockImplementation(() =>
      Promise.resolve({
        items: defaultEntities,
      }),
    ),
    getLocationByRef: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ id: 'id', type: 'url', target: 'url' }),
      ),
    getEntityFacets: jest.fn().mockImplementation(async () => ({
      facets: {
        'relations.ownedBy': [
          { count: 1, value: 'group:default/not-tools' },
          { count: 1, value: 'group:default/tools' },
        ],
      },
    })),
    getEntitiesByRefs: jest.fn().mockImplementation(async () => ({
      items: [
        {
          apiVersion: 'backstage.io/v1alpha1',
          kind: 'Group',
          metadata: {
            name: 'not-tools',
            namespace: 'default',
          },
        },
        {
          apiVersion: 'backstage.io/v1alpha1',
          kind: 'Group',
          metadata: {
            name: 'tools',
            namespace: 'default',
          },
        },
      ],
    })),
    queryEntities: jest
      .fn()
      .mockImplementation(async (request?: QueryEntitiesInitialRequest) => {
        // After the inline-toolbar refactor, the default page issues a
        // queryEntities request scoped to `kind: 'component'` (mounted via
        // a hidden EntityKindPicker inside the EntityListProvider). The
        // mock returns the two component entities for any non-narrowed
        // request, and returns narrowed results for the historical
        // owned/starred branches in case any future test re-enables them.
        const filter = (request?.filter ?? {}) as Record<string, unknown>;
        if (filter['relations.ownedBy']) {
          return {
            items: defaultEntities.slice(0, 1),
            totalItems: 1,
            pageInfo: {},
          };
        }
        if (filter['metadata.name']) {
          return {
            items: [defaultEntities[0]],
            totalItems: 1,
            pageInfo: {},
          };
        }
        return {
          items: defaultEntities,
          totalItems: defaultEntities.length,
          pageInfo: {},
        };
      }),
  });

  const identityApi = mockApis.identity({
    userEntityRef: 'user:default/guest',
    ownershipEntityRefs: ['user:default/guest', 'group:default/tools'],
    displayName: 'Display Name',
  });

  const renderWrapped = (children: ReactNode) =>
    renderInTestApp(
      <TestApiProvider
        apis={[
          [catalogApiRef, catalogApi],
          [identityApiRef, identityApi],
          [storageApiRef, mockApis.storage()],
          [starredEntitiesApiRef, new MockStarredEntitiesApi()],
          [permissionApiRef, mockApis.permission()],
        ]}
      >
        {children}
      </TestApiProvider>,
      {
        mountedRoutes: {
          '/create': createComponentRouteRef,
          '/catalog/:namespace/:kind/:name': entityRouteRef,
        },
      },
    );

  // TODO(freben): The test timeouts are bumped in this file, because it seems
  // page and table rerenders accumulate to occasionally go over the default
  // limit. We should investigate why these timeouts happen.

  it('should render the default column of the grid', async () => {
    await renderWrapped(<DefaultCatalogPage />);

    const columnHeaders = screen.getAllByRole('columnheader');
    const columnHeaderLabels = columnHeaders.map(c =>
      (c.textContent ?? '').trim(),
    );

    // The default column set after the AAP refactor (sub-section 0.5.1.2):
    // - 'System' column REMOVED (full removal of System link/element)
    // - 'Owner' column REMOVED (full removal of Owner link/element)
    // - 'Lifecycle' column REMOVED (not part of defaultCatalogTableColumnsFunc
    //   after the simplification — see defaultCatalogTableColumnsFunc.tsx
    //   which only emits Name, Type, Description, Tags for the default case).
    expect(columnHeaderLabels).toEqual([
      'Name',
      'Type',
      'Vertical',
      'Description',
      'Tags',
      'Actions',
    ]);
  }, 20_000);

  it('should render the custom column passed as prop', async () => {
    const columns: TableColumn<CatalogTableRow>[] = [
      { title: 'Foo', field: 'entity.foo' },
      { title: 'Bar', field: 'entity.bar' },
      { title: 'Baz', field: 'entity.spec.lifecycle' },
    ];
    await renderWrapped(<DefaultCatalogPage columns={columns} />);

    const columnHeaders = screen.getAllByRole('columnheader');
    const columnHeaderLabels = columnHeaders.map(c =>
      (c.textContent ?? '').trim(),
    );
    expect(columnHeaderLabels).toEqual(['Foo', 'Bar', 'Baz', 'Actions']);
  }, 20_000);

  it('should render the custom column function passed as prop', async () => {
    const columns: CatalogTableColumnsFunc = ({ filters, entities }) => {
      return filters.kind?.value === 'component' && entities.length
        ? [
            { title: 'Foo', field: 'entity.foo' },
            { title: 'Bar', field: 'entity.bar' },
            { title: 'Baz', field: 'entity.spec.lifecycle' },
          ]
        : [];
    };
    await renderWrapped(<DefaultCatalogPage columns={columns} />);

    // The column function depends on entities being loaded asynchronously;
    // wait for the DataTable to re-render with the resolved columns.
    await waitFor(() => {
      const columnHeaders = screen.getAllByRole('columnheader');
      const columnHeaderLabels = columnHeaders.map(c =>
        (c.textContent ?? '').trim(),
      );
      expect(columnHeaderLabels).toEqual(['Foo', 'Bar', 'Baz', 'Actions']);
    });
  }, 20_000);

  it('should render the default actions of an item in the grid', async () => {
    // Post-refactor (AAP §0.5.1.2):
    //   - View action REMOVED (View button deletion bullet)
    //   - Star icon / "Add to favorites" REMOVED (FavoriteEntity star)
    //   - Only the Edit action remains in the default actions array
    //
    // The legacy "user-picker-owned" affordance was removed in commit
    // 0ca9c20d42 ("simplify catalog and docs filters with inline toolbar").
    // The page renders without explicit pagination, which means
    // EntityListProvider falls back to `getEntities` (see
    // useEntityListProvider.tsx — paginationMode === 'none' branch). The
    // assertion below therefore checks for `getEntities` having been
    // called rather than `queryEntities`.
    await renderWrapped(<DefaultCatalogPage />);
    await waitFor(() => expect(catalogApi.getEntities).toHaveBeenCalled());

    // Wait for the table rows to render so the action icons exist in DOM.
    await expect(screen.findByText('Entity1')).resolves.toBeInTheDocument();

    // Only Edit remains in the default actions array; the View and Star
    // ("Add to favorites") actions are intentionally absent per AAP. Each
    // table row renders one Edit icon, so we expect one Edit per loaded
    // entity (defaultEntities.length === 2).
    const editIcons = await screen.findAllByTitle(/Edit/);
    expect(editIcons.length).toBe(defaultEntities.length);
    expect(screen.queryByTitle(/View/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Add to favorites/)).not.toBeInTheDocument();
  }, 20_000);

  it('should render the custom actions of an item passed as prop', async () => {
    const actions: TableProps<CatalogTableRow>['actions'] = [
      () => {
        return {
          icon: () => <LayoutDashboard size={16} />,
          tooltip: 'Foo Action',
          disabled: false,
          onClick: () => jest.fn(),
        };
      },
      () => {
        return {
          icon: () => <LayoutDashboard size={16} />,
          tooltip: 'Bar Action',
          disabled: true,
          onClick: () => jest.fn(),
        };
      },
    ];

    await renderWrapped(<DefaultCatalogPage actions={actions} />);
    await waitFor(() => expect(catalogApi.getEntities).toHaveBeenCalled());

    // Wait for table rows to mount so the action icons exist in DOM.
    await expect(screen.findByText('Entity1')).resolves.toBeInTheDocument();

    // Each custom action is rendered once per entity row, so we expect
    // `defaultEntities.length` instances of each.
    const fooIcons = await screen.findAllByTitle(/Foo Action/);
    expect(fooIcons.length).toBe(defaultEntities.length);

    const barIcons = await screen.findAllByTitle(/Bar Action/);
    expect(barIcons.length).toBe(defaultEntities.length);
    barIcons.forEach(icon => expect(icon).toBeDisabled());
  }, 20_000);

  // The legacy `user-picker-{owned,all,starred}` affordance and the
  // `initiallySelectedFilter` prop were removed in commit 0ca9c20d42
  // ("simplify catalog and docs filters with inline toolbar"). The tests
  // that exercised those mechanisms — "should render",
  // "should set initial filter correctly", and
  // "should render the correct entities filtered on the selected filter"
  // — are no longer applicable because the production surface they
  // probed has been deleted. They were left as dead tests prior to this
  // refactor and are removed here so the suite reflects current behavior.
  //
  // The "should wrap filter in drawer on smaller screens" test exercised
  // the legacy sidebar Filters drawer (also removed by commit
  // 0ca9c20d42). With no Filters drawer in the new DefaultCatalogPage,
  // that test is also removed.
  //
  // The mobile responsive layout is still verified by the
  // `CatalogTableToolbar`'s own responsive class strategy and by the
  // Playwright E2E coverage in `packages/app/e2e-tests/refactor.test.ts`
  // ("Mobile layout") so the regression surface remains covered end-to-end.
});
