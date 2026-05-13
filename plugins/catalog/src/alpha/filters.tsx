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

import { CatalogFilterBlueprint } from '@backstage/plugin-catalog-react/alpha';

const catalogKindCatalogFilter = CatalogFilterBlueprint.makeWithOverrides({
  name: 'kind',
  config: {
    schema: {
      initialFilter: z => z.string().default('component'),
    },
  },
  factory(originalFactory, { config }) {
    return originalFactory({
      loader: async () => {
        const { EntityKindPicker } = await import(
          '@backstage/plugin-catalog-react'
        );
        return (
          <div style={{ display: 'none' }}>
            <EntityKindPicker initialFilter={config.initialFilter} />
          </div>
        );
      },
    });
  },
});

const catalogTagCatalogFilter = CatalogFilterBlueprint.make({
  name: 'tag',
  params: {
    loader: async () => {
      const { EntityTagPicker } = await import(
        '@backstage/plugin-catalog-react'
      );
      return <EntityTagPicker />;
    },
  },
});

const catalogTypeCatalogFilter = CatalogFilterBlueprint.make({
  name: 'type',
  params: {
    loader: async () => {
      const { EntityTypePicker } = await import(
        '@backstage/plugin-catalog-react'
      );
      return <EntityTypePicker />;
    },
  },
});

const catalogListCatalogFilter = CatalogFilterBlueprint.makeWithOverrides({
  name: 'list',
  config: {
    schema: {
      initialFilter: z => z.enum(['owned', 'starred', 'all']).default('owned'),
    },
  },
  factory(originalFactory, { config }) {
    return originalFactory({
      loader: async () => {
        const { UserListPicker } = await import(
          '@backstage/plugin-catalog-react'
        );
        return <UserListPicker initialFilter={config.initialFilter} />;
      },
    });
  },
});

// this is the default order that the filters will be applied in
export default [
  catalogKindCatalogFilter,
  catalogTypeCatalogFilter,
  catalogListCatalogFilter,
  catalogTagCatalogFilter,
];
