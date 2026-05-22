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

import {
  Entity,
  CompoundEntityRef,
  RELATION_PART_OF,
} from '@backstage/catalog-model';
import { OverflowTooltip, TableColumn } from '@backstage/core-components';
import { getEntityRelations } from '../../utils';
import {
  EntityRefLink,
  EntityRefLinks,
  humanizeEntityRef,
} from '../EntityRefLink';
import { EntityTableColumnTitle } from './TitleColumn';

/** @public */
export const columnFactories = Object.freeze({
  createEntityRefColumn<T extends Entity>(options: {
    defaultKind?: string;
  }): TableColumn<T> {
    const { defaultKind } = options;
    function formatContent(entity: T): string {
      return (
        entity.metadata?.title ||
        humanizeEntityRef(entity, {
          defaultKind,
        })
      );
    }

    return {
      title: <EntityTableColumnTitle translationKey="name" />,
      highlight: true,
      customFilterAndSearch(filter, entity) {
        // TODO: We could implement this more efficiently, like searching over
        // each field that is displayed individually (kind, namespace, name).
        // but that might confuse the user as it will behave different than a
        // simple text search.
        // Another alternative would be to cache the values. But writing them
        // into the entity feels bad too.
        return formatContent(entity).includes(filter);
      },
      customSort(entity1, entity2) {
        // TODO: We could implement this more efficiently by comparing field by field.
        // This has similar issues as above.
        return formatContent(entity1).localeCompare(formatContent(entity2));
      },
      render: entity => (
        <EntityRefLink
          entityRef={entity}
          defaultKind={defaultKind}
          title={entity.metadata?.title}
        />
      ),
    };
  },
  createEntityRelationColumn<T extends Entity>(options: {
    title: string | JSX.Element;
    relation: string;
    defaultKind?: string;
    filter?: { kind: string };
  }): TableColumn<T> {
    const { title, relation, defaultKind, filter: entityFilter } = options;

    function getRelations(entity: T): CompoundEntityRef[] {
      return getEntityRelations(entity, relation, entityFilter);
    }

    function formatContent(entity: T): string {
      return getRelations(entity)
        .map(r => humanizeEntityRef(r, { defaultKind }))
        .join(', ');
    }

    return {
      title,
      customFilterAndSearch(filter, entity) {
        return formatContent(entity).includes(filter);
      },
      customSort(entity1, entity2) {
        return formatContent(entity1).localeCompare(formatContent(entity2));
      },
      render: entity => {
        return (
          <EntityRefLinks
            entityRefs={getRelations(entity)}
            defaultKind={defaultKind}
          />
        );
      },
    };
  },
  // `createOwnerColumn` and `createSystemColumn` factories were removed
  // per AAP §0.1.2 and §0.6.1.2 ("delete `createOwnerColumn`" and "delete
  // `createSystemColumn`"). Owner and System functionality has been fully
  // removed across the application; these factories are no longer
  // exported from `columnFactories` so that no consumer can resurrect a
  // hidden Owner/System column anywhere in the UI. Downstream catalog
  // surfaces that previously composed these factories
  // (e.g., `RelatedEntitiesCard/presets.ts`) have already been updated
  // to drop those usages in earlier refactor passes.
  createDomainColumn<T extends Entity>(): TableColumn<T> {
    return this.createEntityRelationColumn({
      title: <EntityTableColumnTitle translationKey="domain" />,
      relation: RELATION_PART_OF,
      defaultKind: 'domain',
      filter: {
        kind: 'domain',
      },
    });
  },
  createMetadataDescriptionColumn<T extends Entity>(): TableColumn<T> {
    return {
      title: <EntityTableColumnTitle translationKey="description" />,
      field: 'metadata.description',
      render: entity => (
        <OverflowTooltip
          text={entity.metadata.description}
          placement="bottom-start"
          line={2}
        />
      ),
    };
  },
  createSpecLifecycleColumn<T extends Entity>(): TableColumn<T> {
    return {
      title: <EntityTableColumnTitle translationKey="lifecycle" />,
      field: 'spec.lifecycle',
    };
  },
  createSpecTypeColumn<T extends Entity>(): TableColumn<T> {
    return {
      title: <EntityTableColumnTitle translationKey="type" />,
      field: 'spec.type',
    };
  },
});
