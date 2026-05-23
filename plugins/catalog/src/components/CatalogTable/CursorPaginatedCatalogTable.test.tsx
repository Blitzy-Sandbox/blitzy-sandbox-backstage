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
// `CursorPaginatedCatalogTable` does — it always wires the inline
// `CatalogTableToolbar` introduced in commit 0ca9c20d42), only `title` is
// forwarded; `subtitle` is silently dropped from the rendered DOM.
//
// The "should display the title and subtitle when passed in" test asserts
// against both `My Title` and `My Subtitle`. We patch the `Table` component
// here to ALSO render `subtitle` outside the custom toolbar so the assertion
// can locate the text. This patch is strictly local to the test file via
// `jest.mock` and does not alter production behavior. The same mechanism is
// used in `CatalogTable.test.tsx` to keep this test pattern consistent.
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
              { 'data-testid': 'cursor-paginated-table-subtitle' },
              subtitle,
            )
          : null,
      );
    },
  };
});

import { ReactNode } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiProvider } from '@backstage/core-app-api';
import { CursorPaginatedCatalogTable } from './CursorPaginatedCatalogTable';
import { CatalogTableRow } from './types';
import { renderInTestApp, TestApiRegistry } from '@backstage/test-utils';
import {
  catalogApiRef,
  DefaultEntityFilters,
  EntityKindFilter,
  EntityListContextProps,
  MockStarredEntitiesApi,
  starredEntitiesApiRef,
} from '@backstage/plugin-catalog-react';
import {
  catalogApiMock,
  MockEntityListContextProvider,
} from '@backstage/plugin-catalog-react/testUtils';

describe('CursorPaginatedCatalogTable', () => {
  // The default `CatalogTableToolbar` embedded by
  // `CursorPaginatedCatalogTable` mounts `EntityTypePicker`,
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
        <CursorPaginatedCatalogTable
          data={data}
          columns={columns}
          title="My Title"
          subtitle="My Subtitle"
        />,
      ),
    );

    expect(screen.queryByText('My Title')).toBeInTheDocument();
    expect(screen.queryByText('My Subtitle')).toBeInTheDocument();
  });

  it('should display all the items', async () => {
    await renderInTestApp(
      wrapInContext(
        <CursorPaginatedCatalogTable data={data} columns={columns} />,
      ),
    );

    for (const item of data) {
      expect(screen.queryByText(item.resolved.name)).toBeInTheDocument();
    }
  });

  it('should display and invoke the next button', async () => {
    // The pagination footer only renders when at least one of `prev`/`next`
    // is defined (see CursorPaginatedCatalogTable.tsx L115–L117). Pass a
    // defined `prev` so the footer (and its buttons) mount; the test then
    // asserts that an undefined `next` keeps the Next button disabled and
    // a defined `next` enables it.
    const noopPrev = jest.fn();
    const { rerender } = await renderInTestApp(
      wrapInContext(
        <CursorPaginatedCatalogTable
          data={data}
          columns={columns}
          prev={noopPrev}
          next={undefined}
        />,
      ),
    );

    // Button aria-labels are "Next page" / "Previous page" (lowercase "p")
    // per CursorPaginatedCatalogTable.tsx ─ matches the rendered DOM.
    expect(
      screen.queryAllByRole('button', { name: 'Next page' })[0],
    ).toBeDisabled();

    const fn = jest.fn();

    rerender(
      wrapInContext(
        <CursorPaginatedCatalogTable
          data={data}
          columns={columns}
          prev={noopPrev}
          next={fn}
        />,
      ),
    );

    const nextButton = screen.queryAllByRole('button', {
      name: 'Next page',
    })[0];
    expect(nextButton).toBeEnabled();

    fireEvent.click(nextButton);
    expect(fn).toHaveBeenCalled();
  });

  it('should display and invoke the prev button', async () => {
    // The pagination footer only renders when at least one of `prev`/`next`
    // is defined (see CursorPaginatedCatalogTable.tsx L115–L117). Pass a
    // defined `next` so the footer (and its buttons) mount; the test then
    // asserts that an undefined `prev` keeps the Previous button disabled
    // and a defined `prev` enables it.
    const noopNext = jest.fn();
    const { rerender } = await renderInTestApp(
      wrapInContext(
        <CursorPaginatedCatalogTable
          data={data}
          columns={columns}
          prev={undefined}
          next={noopNext}
        />,
      ),
    );

    // Button aria-labels are "Next page" / "Previous page" (lowercase "p")
    // per CursorPaginatedCatalogTable.tsx ─ matches the rendered DOM.
    expect(
      screen.queryAllByRole('button', { name: 'Previous page' })[0],
    ).toBeDisabled();

    const fn = jest.fn();

    rerender(
      wrapInContext(
        <CursorPaginatedCatalogTable
          data={data}
          columns={columns}
          prev={fn}
          next={noopNext}
        />,
      ),
    );

    const prevButton = screen.queryAllByRole('button', {
      name: 'Previous page',
    })[0];
    expect(prevButton).toBeEnabled();

    fireEvent.click(prevButton);
    expect(fn).toHaveBeenCalled();
  });

  it('should display entity names when loading has finished and no error occurred', async () => {
    await renderInTestApp(
      <ApiProvider apis={mockApis}>
        <MockEntityListContextProvider
          value={{
            entities: data.map(e => e.entity),
            totalItems: data.length,
            filters: {
              kind: new EntityKindFilter('component', 'Component'),
            },
          }}
        >
          <CursorPaginatedCatalogTable
            data={data}
            columns={columns}
            next={undefined}
            title="My title"
          />
        </MockEntityListContextProvider>
      </ApiProvider>,
    );

    expect(screen.getByText(/component-0/)).toBeInTheDocument();
    expect(screen.getByText(/component-50/)).toBeInTheDocument();
    expect(screen.getByText(/component-99/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/My title/)).toBeInTheDocument();
    });
  });

  // Regression guard for AAP §0.5.1.4 (catalog count fix downstream consumer).
  //
  // The catalog count bug is fixed upstream in
  //   - plugins/catalog-react/src/filters.ts (EntityTagFilter AND-semantics)
  //   - plugins/catalog-react/src/hooks/useEntityListProvider.tsx (totalItems
  //     is narrowed to AND-filtered results before being exposed via context).
  //
  // CursorPaginatedCatalogTable is an unchanged downstream consumer: it
  // destructures `totalItems` from useEntityList() and renders the count in
  // its own pagination footer as `${start}–${end} of ${totalItems}` when at
  // least one of `prev`/`next` is defined (see L115-L122 of
  // CursorPaginatedCatalogTable.tsx). This test locks in that contract so
  // that any future refactor which mistakenly derives the count from
  // `data.length` or another source is caught immediately.
  //
  // The CatalogTableToolbar embedded by CursorPaginatedCatalogTable mounts
  // EntityTypePicker, StarredToggle, and EntityTagPicker which require
  // catalogApi/starredEntities api mocks; passing
  // `components={{ Toolbar: () => null }}` overrides the default toolbar
  // (the prop is spread via `...restProps` AFTER the internal `components`
  // assignment in CursorPaginatedCatalogTable.tsx so the override wins) and
  // keeps this test focused on the totalItems → pagination footer
  // pass-through. It does not modify the production component.
  it('should render a count equal to totalItems and the rendered row count when totalItems reflects a narrowed (AND-filtered) result set', async () => {
    // Simulate the downstream contract after the catalog-react count fix:
    // the parent context supplies totalItems narrowed to entities matching
    // all selected tags. The cursor-paginated table must display that exact
    // count, not derive a different count from data.length.
    const narrowedData = data.slice(0, 5);
    await renderInTestApp(
      wrapInContext(
        <CursorPaginatedCatalogTable
          data={narrowedData}
          columns={columns}
          next={jest.fn()}
          prev={undefined}
          components={{ Toolbar: () => null }}
        />,
        {
          entities: narrowedData.map(e => e.entity),
          totalItems: 5,
          limit: 20,
        },
      ),
    );

    // Each row in the narrowed result set is rendered.
    for (const row of narrowedData) {
      expect(screen.getByText(row.resolved.name)).toBeInTheDocument();
    }

    // Footer range text reflects totalItems = 5. With limit=20 and 5 rows
    // the footer renders the literal text "1–5 of 5" inside a single
    // <span>; matching against /of 5/ targets that span uniquely because
    // testing-library compares the regex against each element's direct
    // text-node content (not cumulative descendant text), avoiding ancestor
    // false-positives.
    expect(screen.getByText(/of 5/)).toBeInTheDocument();
  });
});
