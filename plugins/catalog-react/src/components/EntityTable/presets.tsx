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

import { ComponentEntity, SystemEntity } from '@backstage/catalog-model';
import { TableColumn } from '@backstage/core-components';
import { columnFactories } from './columns';

// Owner and System columns intentionally omitted per AAP §0.1.3 CRITICAL
// directive: "Perform a full removal of this functionality across the
// application." The user-stated requirement is that no Owner link and no
// System link surface anywhere when a user views a project (entity). These
// presets are consumed across multiple cards (ProvidingComponentsCard,
// ConsumingComponentsCard, and any other table-style listing that reuses
// EntityTable.systemEntityColumns / EntityTable.componentEntityColumns), so
// removing the columns here enforces the full-removal mandate uniformly.
export const systemEntityColumns: TableColumn<SystemEntity>[] = [
  columnFactories.createEntityRefColumn({ defaultKind: 'system' }),
  columnFactories.createDomainColumn(),
  columnFactories.createMetadataDescriptionColumn(),
];

export const componentEntityColumns: TableColumn<ComponentEntity>[] = [
  columnFactories.createEntityRefColumn({ defaultKind: 'component' }),
  columnFactories.createSpecTypeColumn(),
  columnFactories.createSpecLifecycleColumn(),
  columnFactories.createMetadataDescriptionColumn(),
];
