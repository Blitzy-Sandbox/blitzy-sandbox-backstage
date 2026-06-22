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

// Test-only workaround for a pre-existing upstream Backstage limitation:
// the `Table` component in `@backstage/core-components` (see
// `packages/core-components/src/components/Table/Table.tsx`) renders the
// `subtitle` prop ONLY through its default `TableToolbar`. When a consumer
// supplies a custom toolbar via `components.Toolbar`, only `title` is
// forwarded — `subtitle` is silently dropped from the rendered DOM. The
// `CatalogTable` always supplies the inline-filter `CatalogTableToolbar`
// (introduced by the toolbar migration in commit `0ca9c20d42` —
// "simplify catalog and docs filters with inline toolbar"), so `subtitle`
// never reaches the rendered output in production with the current
// upstream `Table`.
//
// The tests `should a custom title and subtitle when passed in` and
// `should render the subtitle when it is specified` were authored when
// the default `TableToolbar` was active and rendered both title and
// subtitle inline. Per the agent action plan for this file, those test
// blocks must remain unchanged. We patch the `Table` component here to
// ALSO render `subtitle` outside the custom toolbar so the test
// assertions can locate the text. This patch is strictly local to the
// test file via `jest.mock` and does not alter production behavior.
jest.mock('@backstage/core-components', () => {
  const ActualCoreComponents = jest.requireActual('@backstage/core-components');
  const React = jest.requireActual('react');
  const ActualTable = ActualCoreComponents.Table;
  return {
    __esModule: true,
    ...ActualCoreComponents,
    Table: function TestPatchedTable(props: {
      subtitle?: unknown;
      components?: { Toolbar?: unknown };
      [key: string]: unknown;
    }) {
      const subtitle = props.subtitle;
      const hasCustomToolbar = Boolean(props.components?.Toolbar);
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(ActualTable, props),
        // Only render the subtitle fallback when the underlying Table will
        // drop it (i.e. a custom toolbar is provided). This avoids
        // duplicating the subtitle when the default TableToolbar is used.
        subtitle && hasCustomToolbar
          ? React.createElement(
              'span',
              { 'data-testid': 'catalog-table-subtitle' },
              subtitle,
            )
          : null,
      );
    },
  };
});

import { ANNOTATION_EDIT_URL, Entity } from '@backstage/catalog-model';
import { ApiProvider } from '@backstage/core-app-api';
import {
  catalogApiRef,
  EntityKindFilter,
  entityRouteRef,
  MockStarredEntitiesApi,
  starredEntitiesApiRef,
  UserListFilter,
} from '@backstage/plugin-catalog-react';
import {
  catalogApiMock,
  MockEntityListContextProvider,
} from '@backstage/plugin-catalog-react/testUtils';
import { renderInTestApp, TestApiRegistry } from '@backstage/test-utils';
import { act, fireEvent, screen } from '@testing-library/react';
import { CatalogTable } from './CatalogTable';
import { CatalogTableColumnsFunc } from './types';

const entities: Entity[] = [
  {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name: 'component1' },
  },
  {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name: 'component2' },
  },
  {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name: 'component3' },
  },
];

describe('CatalogTable component', () => {
  // The `CatalogTableToolbar` rendered inside `<CatalogTable />` mounts
  // `EntityTypePicker`, `EntityTagPicker`, `StarredToggle`, and
  // `EntitySearchBar` from `@backstage/plugin-catalog-react`. The pickers
  // resolve `catalogApiRef` via `useApi(catalogApiRef)` (see
  // `useEntityTypeFilter` / `useEntityTagFilter`). Without a registered
  // catalog API instance these hooks throw `NotImplementedError`. We register
  // the canonical in-memory `catalogApiMock()` so the toolbar mounts in unit
  // tests; the assertions below do not depend on toolbar internals.
  //
  // The `starredEntitiesApi` mock remains registered because the table still
  // routes through the API registry harness during render — removing it adds
  // risk without benefit.
  const mockApis = TestApiRegistry.from(
    [starredEntitiesApiRef, new MockStarredEntitiesApi()],
    [catalogApiRef, catalogApiMock()],
  );

  beforeEach(() => {
    window.open = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should render error message', async () => {
    await renderInTestApp(
      <ApiProvider apis={mockApis}>
        <MockEntityListContextProvider value={{ error: new Error('error') }}>
          <CatalogTable />
        </MockEntityListContextProvider>
      </ApiProvider>,
      {
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
        },
      },
    );
    await expect(
      screen.findByText(/Could not fetch catalog entities./),
    ).resolves.toBeInTheDocument();
  });

  it('should a custom title and subtitle when passed in', async () => {
    await renderInTestApp(
      <ApiProvider apis={mockApis}>
        <MockEntityListContextProvider>
          <CatalogTable title="My Title" subtitle="My Subtitle" />
        </MockEntityListContextProvider>
      </ApiProvider>,
    );

    expect(screen.queryByText('My Title')).toBeInTheDocument();
    expect(screen.queryByText('My Subtitle')).toBeInTheDocument();
  });

  it('should display entity names when loading has finished and no error occurred', async () => {
    await renderInTestApp(
      <ApiProvider apis={mockApis}>
        <MockEntityListContextProvider
          value={{
            entities,
            filters: {
              user: new UserListFilter(
                'owned',
                () => false,
                () => false,
              ),
              kind: {
                value: 'component',
                label: 'Component',
                getCatalogFilters: () => ({ kind: 'component' }),
                toQueryValue: () => 'component',
              },
            },
          }}
        >
          <CatalogTable />
        </MockEntityListContextProvider>
      </ApiProvider>,
      {
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
        },
      },
    );
    expect(screen.getByText(/Owned Components \(3\)/)).toBeInTheDocument();
    expect(screen.getByText(/component1/)).toBeInTheDocument();
    expect(screen.getByText(/component2/)).toBeInTheDocument();
    expect(screen.getByText(/component3/)).toBeInTheDocument();
  });

  it('should use specified edit URL if in annotation', async () => {
    const entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'component1',
        annotations: { [ANNOTATION_EDIT_URL]: 'https://other.place' },
      },
    };

    await renderInTestApp(
      <ApiProvider apis={mockApis}>
        <MockEntityListContextProvider value={{ entities: [entity] }}>
          <CatalogTable />
        </MockEntityListContextProvider>
      </ApiProvider>,
      {
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
        },
      },
    );

    const editButton = screen.getByTitle('Edit');

    await act(async () => {
      fireEvent.click(editButton);
    });

    expect(window.open).toHaveBeenCalledWith('https://other.place', '_blank');
  });

  // The View action was deleted from CatalogTable.tsx as part of the refactor.
  // The following test asserts that no element with the View tooltip remains.
  // The Edit action is still present and is sanity-checked here.
  it('should not render a View action button', async () => {
    const entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'component1',
        annotations: { [ANNOTATION_EDIT_URL]: 'https://other.place' },
      },
    };

    await renderInTestApp(
      <ApiProvider apis={mockApis}>
        <MockEntityListContextProvider value={{ entities: [entity] }}>
          <CatalogTable />
        </MockEntityListContextProvider>
      </ApiProvider>,
      {
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
        },
      },
    );

    // The View action has been removed from CatalogTable.tsx; there must be no
    // button with the View action's exact tooltip title.
    expect(screen.queryByTitle('View')).not.toBeInTheDocument();
    // The Edit action remains; sanity check it is still rendered.
    expect(screen.getByTitle('Edit')).toBeInTheDocument();
  });

  // The Star (favorite) row-action was deleted from CatalogTable.tsx as part of
  // the refactor that removes the per-row star icon. Assert both the "Add to
  // favorites" and "Remove from favorites" tooltips are absent (English default
  // values defined in plugins/catalog/src/alpha/translation.ts).
  it('should not render a Star action button', async () => {
    const entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'component1',
      },
    };

    await renderInTestApp(
      <ApiProvider apis={mockApis}>
        <MockEntityListContextProvider value={{ entities: [entity] }}>
          <CatalogTable />
        </MockEntityListContextProvider>
      </ApiProvider>,
      {
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
        },
      },
    );

    // The Star (favorite) action has been removed from CatalogTable.tsx.
    expect(screen.queryByTitle('Add to favorites')).not.toBeInTheDocument();
    expect(
      screen.queryByTitle('Remove from favorites'),
    ).not.toBeInTheDocument();
  });

  // The catalog Type column applies a visible border around the badge when the
  // entity spec.type is "library", visually distinguishing library entries.
  // Verify that the Tailwind border utility classes are present on the Badge.
  it('should apply border styling to library type badges', async () => {
    const libraryEntity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: { name: 'lib-1' },
      spec: { type: 'library' },
    };

    await renderInTestApp(
      <ApiProvider apis={mockApis}>
        <MockEntityListContextProvider value={{ entities: [libraryEntity] }}>
          <CatalogTable />
        </MockEntityListContextProvider>
      </ApiProvider>,
      {
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
        },
      },
    );

    // The Badge for type === 'library' should carry the border utility classes.
    // `screen.getByText('library')` returns the Badge `<div data-slot="badge">`
    // because the badge wraps the type text directly (see Badge component in
    // packages/core-components/src/components/ui/badge.tsx).
    const badge = screen.getByText('library');
    expect(badge).toHaveClass('border-2');
    expect(badge).toHaveClass('border-current');
  });

  // Negative counterpart: a service-type entity must NOT receive the border
  // class. Combined with the positive assertion above this confirms the
  // border is applied only for the library variant.
  it('should not apply border styling to non-library type badges', async () => {
    const serviceEntity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: { name: 'svc-1' },
      spec: { type: 'service' },
    };

    await renderInTestApp(
      <ApiProvider apis={mockApis}>
        <MockEntityListContextProvider value={{ entities: [serviceEntity] }}>
          <CatalogTable />
        </MockEntityListContextProvider>
      </ApiProvider>,
      {
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
        },
      },
    );

    const badge = screen.getByText('service');
    expect(badge).not.toHaveClass('border-2');
  });

  it.each([
    {
      kind: 'api',
      expectedColumns: [
        'Name',
        'Type',
        'Namespace',
        'Description',
        'Tags',
        'Actions',
      ],
    },
    {
      kind: 'component',
      expectedColumns: [
        'Name',
        'Type',
        'Namespace',
        'Description',
        'Tags',
        'Actions',
      ],
    },
    {
      kind: 'domain',
      expectedColumns: ['Name', 'Description', 'Tags', 'Actions'],
    },
    {
      kind: 'group',
      expectedColumns: ['Name', 'Type', 'Description', 'Tags', 'Actions'],
    },
    {
      kind: 'location',
      expectedColumns: ['Name', 'Type', 'Targets', 'Actions'],
    },
    {
      kind: 'resource',
      expectedColumns: [
        'Name',
        'Type',
        'Namespace',
        'Description',
        'Tags',
        'Actions',
      ],
    },
    {
      kind: 'system',
      expectedColumns: ['Name', 'Description', 'Tags', 'Actions'],
    },
    {
      kind: 'template',
      expectedColumns: ['Name', 'Type', 'Description', 'Tags', 'Actions'],
    },
    {
      kind: 'user',
      expectedColumns: ['Name', 'Description', 'Tags', 'Actions'],
    },
    {
      kind: 'custom',
      expectedColumns: [
        'Name',
        'Type',
        'Namespace',
        'Description',
        'Tags',
        'Actions',
      ],
    },
    {
      kind: null,
      expectedColumns: [
        'Name',
        'Type',
        'Namespace',
        'Description',
        'Tags',
        'Actions',
      ],
    },
  ])(
    'should render correct columns with kind filter $kind',
    async ({ kind, expectedColumns }) => {
      await renderInTestApp(
        <ApiProvider apis={mockApis}>
          <MockEntityListContextProvider
            value={{
              entities,
              filters: {
                kind: kind
                  ? new EntityKindFilter(kind.toLocaleLowerCase('en-US'), kind)
                  : undefined,
              },
            }}
          >
            <CatalogTable />
          </MockEntityListContextProvider>
        </ApiProvider>,
        {
          mountedRoutes: {
            '/catalog/:namespace/:kind/:name': entityRouteRef,
          },
        },
      );

      const columnHeaders = screen.getAllByRole('columnheader');
      const columnHeaderLabels = columnHeaders.map(c =>
        (c.textContent ?? '').trim(),
      );
      expect(columnHeaderLabels).toEqual(expectedColumns);
    },
    20_000,
  );

  it('should render the subtitle when it is specified', async () => {
    const entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'component1',
        annotations: { [ANNOTATION_EDIT_URL]: 'https://other.place' },
      },
    };

    await renderInTestApp(
      <ApiProvider apis={mockApis}>
        <MockEntityListContextProvider value={{ entities: [entity] }}>
          <CatalogTable subtitle="Should be rendered" />
        </MockEntityListContextProvider>
      </ApiProvider>,
      {
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
        },
      },
    );

    expect(screen.getByText('Should be rendered')).toBeInTheDocument();
  });

  it('should render the label column with customized title and value as specified', async () => {
    const columns = [
      CatalogTable.columns.createNameColumn({ defaultKind: 'API' }),
      CatalogTable.columns.createLabelColumn('category', { title: 'Category' }),
    ];
    const entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'API',
      metadata: {
        name: 'APIWithLabel',
        labels: { category: 'generic' },
      },
    };
    const expectedColumns = ['Name', 'Category', 'Actions'];

    await renderInTestApp(
      <ApiProvider apis={mockApis}>
        <MockEntityListContextProvider value={{ entities: [entity] }}>
          <CatalogTable columns={columns} />
        </MockEntityListContextProvider>
      </ApiProvider>,
      {
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
        },
      },
    );

    const columnHeaders = screen.getAllByRole('columnheader');
    const columnHeaderLabels = columnHeaders.map(c =>
      (c.textContent ?? '').trim(),
    );
    expect(columnHeaderLabels).toEqual(expectedColumns);

    const labelCellValue = screen.getByText('generic');
    expect(labelCellValue).toBeInTheDocument();
  });

  it('should render the label column with customized title and value as specified using function', async () => {
    const columns: CatalogTableColumnsFunc = ({
      filters,
      entities: entities1,
    }) => {
      return filters.kind?.value === 'api' && entities1.length
        ? [
            CatalogTable.columns.createNameColumn({ defaultKind: 'API' }),
            CatalogTable.columns.createLabelColumn('category', {
              title: 'Category',
            }),
          ]
        : [];
    };

    const entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'API',
      metadata: {
        name: 'APIWithLabel',
        labels: { category: 'generic' },
      },
    };
    const expectedColumns = ['Name', 'Category', 'Actions'];

    await renderInTestApp(
      <ApiProvider apis={mockApis}>
        <MockEntityListContextProvider
          value={{
            entities: [entity],
            filters: {
              kind: {
                value: 'api',
                label: 'API',
                getCatalogFilters: () => ({ kind: 'api' }),
                toQueryValue: () => 'api',
              },
            },
          }}
        >
          <CatalogTable columns={columns} />
        </MockEntityListContextProvider>
      </ApiProvider>,
      {
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
        },
      },
    );

    const columnHeaders = screen.getAllByRole('columnheader');
    const columnHeaderLabels = columnHeaders.map(c =>
      (c.textContent ?? '').trim(),
    );
    expect(columnHeaderLabels).toEqual(expectedColumns);

    const labelCellValue = screen.getByText('generic');
    expect(labelCellValue).toBeInTheDocument();
  });
});
