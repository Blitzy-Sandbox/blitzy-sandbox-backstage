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

import { waitFor, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Entity } from '@backstage/catalog-model';
import { EntityTypePicker } from './EntityTypePicker';
import { MockEntityListContextProvider } from '@backstage/plugin-catalog-react/testUtils';
import { catalogApiRef } from '../../api';
import { EntityKindFilter, EntityTypeFilter } from '../../filters';
import { alertApiRef } from '@backstage/core-plugin-api';
import { ApiProvider } from '@backstage/core-app-api';
import { renderInTestApp, TestApiRegistry } from '@backstage/test-utils';
import { mockApis } from '@backstage/frontend-test-utils';
import { GetEntityFacetsResponse } from '@backstage/catalog-client';

const entities: Entity[] = [
  {
    apiVersion: '1',
    kind: 'Component',
    metadata: {
      name: 'component-1',
    },
    spec: {
      type: 'service',
    },
  },
  {
    apiVersion: '1',
    kind: 'Component',
    metadata: {
      name: 'component-2',
    },
    spec: {
      type: 'website',
    },
  },
  {
    apiVersion: '1',
    kind: 'Component',
    metadata: {
      name: 'component-3',
    },
    spec: {
      type: 'library',
    },
  },
];

const apis = TestApiRegistry.from(
  [
    catalogApiRef,
    {
      getEntityFacets: jest.fn().mockResolvedValue({
        facets: {
          'spec.type': entities.map(e => ({
            value: (e.spec as any).type,
            count: 1,
          })),
        },
      } as GetEntityFacetsResponse),
    },
  ],
  [alertApiRef, mockApis.alert()],
);

// Radix Select uses scrollIntoView and pointer-capture APIs not available in jsdom
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = jest.fn().mockReturnValue(false);
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = jest.fn();
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = jest.fn();
  }
});

describe('<EntityTypePicker/>', () => {
  it('renders available entity types', async () => {
    await renderInTestApp(
      <ApiProvider apis={apis}>
        <MockEntityListContextProvider
          value={{
            filters: { kind: new EntityKindFilter('component', 'Component') },
          }}
        >
          <EntityTypePicker />
        </MockEntityListContextProvider>
      </ApiProvider>,
    );
    // After the shadcn/ui migration the picker uses Radix Select. The
    // collapsed trigger renders with `role="combobox"` and the option
    // listbox is portalled into the document only after a real pointer
    // event toggles it open — `fireEvent.click` does not trigger Radix
    // Select's internal pointerdown handler in jsdom (the polyfills
    // installed in `beforeAll` ensure userEvent does). Using
    // `userEvent.click` reliably opens the listbox and surfaces the
    // option labels.
    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeInTheDocument();

    await userEvent.click(trigger);

    // Radix Select renders option labels with the capitalization the
    // picker applies (see EntityTypePicker.tsx —
    // `type.charAt(0).toUpperCase() + type.slice(1)`).
    await waitFor(() => screen.getByText('Service'));

    entities.forEach(entity => {
      const raw = entity.spec!.type as string;
      const label = raw.charAt(0).toUpperCase() + raw.slice(1);
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it('sets the selected type filter', async () => {
    const updateFilters = jest.fn();
    await renderInTestApp(
      <ApiProvider apis={apis}>
        <MockEntityListContextProvider
          value={{
            filters: { kind: new EntityKindFilter('component', 'Component') },
            updateFilters,
          }}
        >
          <EntityTypePicker />
        </MockEntityListContextProvider>
      </ApiProvider>,
    );
    const trigger = screen.getByRole('combobox');
    await userEvent.click(trigger);

    await waitFor(() => screen.getByText('Service'));
    await userEvent.click(screen.getByText('Service'));

    expect(updateFilters).toHaveBeenLastCalledWith({
      type: new EntityTypeFilter(['service']),
    });

    await userEvent.click(trigger);
    // The "All" option is rendered with title casing
    // (`t('entityTypePicker.optionAllTitle')` → "All").
    await userEvent.click(screen.getByText('All'));

    expect(updateFilters).toHaveBeenLastCalledWith({ type: undefined });
  });

  it('respects the query parameter filter value', async () => {
    const updateFilters = jest.fn();
    const queryParameters = { type: 'tool' };
    await renderInTestApp(
      <ApiProvider apis={apis}>
        <MockEntityListContextProvider
          value={{
            updateFilters,
            queryParameters,
          }}
        >
          <EntityTypePicker initialFilter="tool" hidden />
        </MockEntityListContextProvider>
        ,
      </ApiProvider>,
    );

    expect(updateFilters).toHaveBeenLastCalledWith({
      type: new EntityTypeFilter(['tool']),
    });
  });

  it('responds to external queryParameters changes', async () => {
    const updateFilters = jest.fn();
    const rendered = await renderInTestApp(
      <ApiProvider apis={apis}>
        <MockEntityListContextProvider
          value={{
            updateFilters,
            queryParameters: { type: 'service' },
          }}
        >
          <EntityTypePicker />
        </MockEntityListContextProvider>
      </ApiProvider>,
    );
    expect(updateFilters).toHaveBeenLastCalledWith({
      type: new EntityTypeFilter(['service']),
    });
    rendered.rerender(
      <ApiProvider apis={apis}>
        <MockEntityListContextProvider
          value={{
            updateFilters,
            queryParameters: { type: 'tool' },
          }}
        >
          <EntityTypePicker />
        </MockEntityListContextProvider>
      </ApiProvider>,
    );
    expect(updateFilters).toHaveBeenLastCalledWith({
      type: new EntityTypeFilter(['tool']),
    });
  });
});
