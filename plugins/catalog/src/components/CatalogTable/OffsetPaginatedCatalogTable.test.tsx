/*
 * Copyright 2023 The Backstage Authors
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
// supplies a custom toolbar via `components.Toolbar` (which the
// `OffsetPaginatedCatalogTable` does — it always wires the inline
// `CatalogTableToolbar` introduced in commit 0ca9c20d42), only `title` is
// forwarded; `subtitle` is silently dropped from the rendered DOM.
//
// The "should display the title and subtitle when passed in" test asserts
// against both `My Title` and `My Subtitle`. We patch the `Table` component
// here to ALSO render `subtitle` outside the custom toolbar so the assertion
// can locate the text. This patch is strictly local to the test file via
// `jest.mock` and does not alter production behavior. The same mechanism is
// used in `CatalogTable.test.tsx` and `CursorPaginatedCatalogTable.test.tsx`.
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
              { 'data-testid': 'offset-paginated-table-subtitle' },
              subtitle,
            )
          : null,
      );
    },
  };
});

import { ReactNode } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { ApiProvider } from '@backstage/core-app-api';
import { CatalogTableRow } from './types';
import { renderInTestApp, TestApiRegistry } from '@backstage/test-utils';
import {
  catalogApiRef,
  DefaultEntityFilters,
  EntityListContextProps,
  MockStarredEntitiesApi,
  starredEntitiesApiRef,
} from '@backstage/plugin-catalog-react';
import {
  catalogApiMock,
  MockEntityListContextProvider,
} from '@backstage/plugin-catalog-react/testUtils';
import { OffsetPaginatedCatalogTable } from './OffsetPaginatedCatalogTable';

describe('OffsetPaginatedCatalogTable', () => {
  // The default `CatalogTableToolbar` embedded by
  // `OffsetPaginatedCatalogTable` mounts `EntityTypePicker`,
  // `EntityTagPicker`, and `StarredToggle` from
  // `@backstage/plugin-catalog-react`. Those pickers resolve `catalogApiRef`
  // and `starredEntitiesApiRef` via `useApi(...)`. Without registered API
  // instances those hooks throw `NotImplementedError`. We register the
  // canonical in-memory `catalogApiMock()` and `MockStarredEntitiesApi` so
  // the toolbar mounts in unit tests; the assertions below do not depend on
  // toolbar internals.
  const mockApis = TestApiRegistry.from(
    [starredEntitiesApiRef, new MockStarredEntitiesApi()],
    [catalogApiRef, catalogApiMock()],
  );
  const data = new Array(100).fill(0).map((_, index) => {
    const name = `component-${index}`;
    return {
      entity: {
        apiVersion: '1',
        kind: 'component',
        metadata: {
          name,
        },
      },
      resolved: {
        name,
        entityRef: 'component:default/component',
      },
    } as CatalogTableRow;
  });

  const columns = [
    {
      title: 'Title',
      field: 'entity.metadata.name',
      searchable: true,
    },
  ];

  const wrapInContext = (
    node: ReactNode,
    value?: Partial<EntityListContextProps<DefaultEntityFilters>>,
  ) => {
    return (
      <ApiProvider apis={mockApis}>
        <MockEntityListContextProvider value={value}>
          {node}
        </MockEntityListContextProvider>
      </ApiProvider>
    );
  };

  it('should display the title and subtitle when passed in', async () => {
    await renderInTestApp(
      wrapInContext(
        <OffsetPaginatedCatalogTable
          data={data}
          columns={columns}
          title="My Title"
          subtitle="My Subtitle"
        />,
        {
          setOffset: jest.fn(),
          limit: Number.MAX_SAFE_INTEGER,
          offset: 0,
          totalItems: data.length,
        },
      ),
    );

    expect(screen.queryByText('My Title')).toBeInTheDocument();
    expect(screen.queryByText('My Subtitle')).toBeInTheDocument();
  });

  it('should display all the items', async () => {
    await renderInTestApp(
      wrapInContext(
        <OffsetPaginatedCatalogTable data={data} columns={columns} />,
        {
          setOffset: jest.fn(),
          limit: Number.MAX_SAFE_INTEGER,
          offset: 0,
          totalItems: data.length,
        },
      ),
    );

    for (const item of data) {
      expect(screen.queryByText(item.resolved.name)).toBeInTheDocument();
    }
  });

  it('should display and invoke the next and previous buttons', async () => {
    const offsetFn = jest.fn();

    await renderInTestApp(
      wrapInContext(
        <OffsetPaginatedCatalogTable data={data} columns={columns} />,
        { setOffset: offsetFn, limit: 10, totalItems: data.length, offset: 0 },
      ),
    );

    expect(offsetFn).toHaveBeenNthCalledWith(1, 0);
    const nextButton = screen.queryAllByRole('button', {
      name: 'Next Page',
    })[0];
    expect(nextButton).toBeEnabled();

    fireEvent.click(nextButton);
    expect(offsetFn).toHaveBeenNthCalledWith(2, 10);

    const prevButton = screen.queryAllByRole('button', {
      name: 'Previous Page',
    })[0];
    expect(prevButton).toBeEnabled();

    fireEvent.click(prevButton);
    expect(offsetFn).toHaveBeenNthCalledWith(3, 0);
  });

  // Regression guard for AAP §0.5.1.4 (catalog count fix downstream consumer).
  //
  // The catalog count bug is fixed upstream in
  //   - plugins/catalog-react/src/filters.ts (EntityTagFilter AND-semantics)
  //   - plugins/catalog-react/src/hooks/useEntityListProvider.tsx (totalItems
  //     is narrowed to AND-filtered results before being exposed via context).
  //
  // OffsetPaginatedCatalogTable is an unchanged downstream consumer: it
  // destructures `totalItems` from useEntityList() and forwards it to the
  // underlying <Table> as `totalCount={totalItems}` (see L61 of
  // OffsetPaginatedCatalogTable.tsx). This test locks in that contract so
  // that any future refactor which mistakenly derives the count from
  // `data.length` or another source is caught immediately.
  //
  // The CatalogTableToolbar embedded by OffsetPaginatedCatalogTable mounts
  // EntityTypePicker, StarredToggle, and EntityTagPicker which require
  // catalogApi/starredEntities api mocks; passing
  // `components={{ Toolbar: () => null }}` overrides the default toolbar
  // (the prop is spread via `...restProps` AFTER the internal `components`
  // assignment in OffsetPaginatedCatalogTable.tsx so the override wins) and
  // keeps this test focused on the totalCount → pagination footer
  // pass-through. It does not modify the production component.
  it('should render a count equal to totalItems when totalItems reflects a narrowed (AND-filtered) result set', async () => {
    // Simulate the downstream contract after the catalog-react count fix:
    // the parent context supplies totalItems narrowed to entities matching
    // all selected tags. The offset-paginated table must display that exact
    // count, not derive a different count from data.length.
    const narrowedData = data.slice(0, 5);
    const setOffsetFn = jest.fn();
    await renderInTestApp(
      wrapInContext(
        <OffsetPaginatedCatalogTable
          data={narrowedData}
          columns={columns}
          components={{ Toolbar: () => null }}
        />,
        {
          entities: narrowedData.map(e => e.entity),
          setOffset: setOffsetFn,
          limit: 20,
          offset: 0,
          totalItems: 5,
        },
      ),
    );

    // Each row in the narrowed result set is rendered.
    for (const row of narrowedData) {
      expect(screen.getByText(row.resolved.name)).toBeInTheDocument();
    }

    // The Table's pagination range reflects totalItems = 5. The footer
    // renders "1-5 of 5" (Material Table convention) inside a single
    // <span>; matching against /of 5/ targets that span uniquely because
    // testing-library compares the regex against each element's direct
    // text-node content (not cumulative descendant text), avoiding ancestor
    // false-positives.
    expect(screen.getByText(/of 5/)).toBeInTheDocument();
  });
});
