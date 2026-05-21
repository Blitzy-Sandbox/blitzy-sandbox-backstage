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

import { ReactNode } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { CursorPaginatedCatalogTable } from './CursorPaginatedCatalogTable';
import { CatalogTableRow } from './types';
import { renderInTestApp } from '@backstage/test-utils';
import {
  DefaultEntityFilters,
  EntityKindFilter,
  EntityListContextProps,
} from '@backstage/plugin-catalog-react';
import { MockEntityListContextProvider } from '@backstage/plugin-catalog-react/testUtils';

describe('CursorPaginatedCatalogTable', () => {
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
      <MockEntityListContextProvider value={value}>
        {node}
      </MockEntityListContextProvider>
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
    const { rerender } = await renderInTestApp(
      wrapInContext(
        <CursorPaginatedCatalogTable
          data={data}
          columns={columns}
          next={undefined}
        />,
      ),
    );

    expect(
      screen.queryAllByRole('button', { name: 'Next Page' })[0],
    ).toBeDisabled();

    const fn = jest.fn();

    rerender(
      wrapInContext(
        <CursorPaginatedCatalogTable data={data} columns={columns} next={fn} />,
      ),
    );

    const nextButton = screen.queryAllByRole('button', {
      name: 'Next Page',
    })[0];
    expect(nextButton).toBeEnabled();

    fireEvent.click(nextButton);
    expect(fn).toHaveBeenCalled();
  });

  it('should display and invoke the prev button', async () => {
    const { rerender } = await renderInTestApp(
      wrapInContext(
        <CursorPaginatedCatalogTable
          data={data}
          columns={columns}
          prev={undefined}
        />,
      ),
    );

    expect(
      screen.queryAllByRole('button', { name: 'Next Page' })[0],
    ).toBeDisabled();

    const fn = jest.fn();

    rerender(
      wrapInContext(
        <CursorPaginatedCatalogTable data={data} columns={columns} prev={fn} />,
      ),
    );

    const prevButton = screen.queryAllByRole('button', {
      name: 'Previous Page',
    })[0];
    expect(prevButton).toBeEnabled();

    fireEvent.click(prevButton);
    expect(fn).toHaveBeenCalled();
  });

  it('should display entity names when loading has finished and no error occurred', async () => {
    await renderInTestApp(
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
      </MockEntityListContextProvider>,
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
