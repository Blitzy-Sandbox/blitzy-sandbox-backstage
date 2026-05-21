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
import {
  humanizeEntityRef,
  EntityRefLink,
} from '@backstage/plugin-catalog-react';
import { CatalogTableRow } from './types';
import {
  Badge,
  OverflowTooltip,
  TableColumn,
} from '@backstage/core-components';
import { Entity } from '@backstage/catalog-model';
import { JsonArray } from '@backstage/types';
import { EntityTableColumnTitle } from '@backstage/plugin-catalog-react/alpha';

/**
 * Maps a lifecycle value to a semantic badge variant for visual differentiation.
 */
function lifecycleBadgeVariant(
  lifecycle: string | undefined,
): 'success' | 'warning' | 'info' | 'secondary' | 'outline' {
  switch (lifecycle?.toLowerCase()) {
    case 'production':
      return 'success';
    case 'experimental':
      return 'warning';
    case 'deprecated':
      return 'outline';
    default:
      return 'info';
  }
}

/**
 * Maps an entity spec type to a muted badge variant.
 */
function typeBadgeVariant(
  type: string | undefined,
): 'secondary' | 'info' | 'outline' {
  switch (type?.toLowerCase()) {
    case 'service':
      return 'info';
    case 'library':
      return 'secondary';
    default:
      return 'outline';
  }
}

// The columnFactories symbol is not directly exported, but through the
// CatalogTable.columns field.
/** @public */
export const columnFactories = Object.freeze({
  createNameColumn(options?: {
    defaultKind?: string;
  }): TableColumn<CatalogTableRow> {
    function formatContent(entity: Entity): string {
      return (
        entity.metadata?.title ||
        humanizeEntityRef(entity, {
          defaultKind: options?.defaultKind,
        })
      );
    }

    return {
      title: <EntityTableColumnTitle translationKey="name" />,
      field: 'resolved.entityRef',
      highlight: true,
      customSort({ entity: entity1 }, { entity: entity2 }) {
        // TODO: We could implement this more efficiently by comparing field by field.
        // This has similar issues as above.
        return formatContent(entity1).localeCompare(formatContent(entity2));
      },
      render: ({ entity }) => (
        <EntityRefLink
          entityRef={entity}
          defaultKind={options?.defaultKind || 'Component'}
        />
      ),
    };
  },
  createSpecTargetsColumn(): TableColumn<CatalogTableRow> {
    return {
      title: <EntityTableColumnTitle translationKey="targets" />,
      field: 'entity.spec.targets',
      customFilterAndSearch: (query, row) => {
        let targets: JsonArray = [];
        if (
          row.entity?.spec?.targets &&
          Array.isArray(row.entity?.spec?.targets)
        ) {
          targets = row.entity?.spec?.targets;
        } else if (row.entity?.spec?.target) {
          targets = [row.entity?.spec?.target];
        }
        return targets
          .join(', ')
          .toLocaleUpperCase('en-US')
          .includes(query.toLocaleUpperCase('en-US'));
      },
      render: ({ entity }) => (
        <>
          {(entity?.spec?.targets || entity?.spec?.target) && (
            <OverflowTooltip
              text={(
                (entity!.spec!.targets as JsonArray) || [entity.spec.target]
              ).join(', ')}
              placement="bottom-start"
            />
          )}
        </>
      ),
    };
  },
  createSpecTypeColumn(
    options: {
      hidden: boolean;
    } = { hidden: false },
  ): TableColumn<CatalogTableRow> {
    return {
      title: <EntityTableColumnTitle translationKey="type" />,
      field: 'entity.spec.type',
      hidden: options.hidden,
      width: 'auto',
      render: ({ entity }) => {
        const type = entity.spec?.type as string | undefined;
        if (!type) return null;
        // Apply a visible border around the badge when the entity type is
        // "library" so library entries are visually distinguished in the
        // catalog type column. Comparison is case-insensitive to match the
        // pattern used by `typeBadgeVariant` above. The border uses
        // `border-current` so its color follows the badge's foreground color
        // for the chosen variant.
        const isLibrary = type.toLowerCase() === 'library';
        return (
          <Badge
            variant={typeBadgeVariant(type)}
            className={
              isLibrary ? 'border-2 border-current rounded' : undefined
            }
          >
            {type}
          </Badge>
        );
      },
    };
  },
  createSpecLifecycleColumn(): TableColumn<CatalogTableRow> {
    return {
      title: <EntityTableColumnTitle translationKey="lifecycle" />,
      field: 'entity.spec.lifecycle',
      render: ({ entity }) => {
        const lifecycle = entity.spec?.lifecycle as string | undefined;
        return lifecycle ? (
          <Badge variant={lifecycleBadgeVariant(lifecycle)}>{lifecycle}</Badge>
        ) : null;
      },
    };
  },
  createMetadataDescriptionColumn(): TableColumn<CatalogTableRow> {
    return {
      title: <EntityTableColumnTitle translationKey="description" />,
      field: 'entity.metadata.description',
      render: ({ entity }) => (
        <OverflowTooltip
          text={entity.metadata.description}
          placement="bottom-start"
        />
      ),
      width: 'auto',
    };
  },
  createTagsColumn(): TableColumn<CatalogTableRow> {
    return {
      title: <EntityTableColumnTitle translationKey="tags" />,
      field: 'entity.metadata.tags',
      cellStyle: {
        padding: '0px 16px 0px 20px',
      },
      render: ({ entity }) => (
        <>
          {entity.metadata.tags &&
            entity.metadata.tags.map(t => (
              <Badge key={t} variant="outline" className="m-0.5">
                {t}
              </Badge>
            ))}
        </>
      ),
      width: 'auto',
    };
  },
  createTitleColumn(options?: {
    hidden?: boolean;
  }): TableColumn<CatalogTableRow> {
    return {
      title: <EntityTableColumnTitle translationKey="title" />,
      field: 'entity.metadata.title',
      hidden: options?.hidden,
      searchable: true,
    };
  },
  createLabelColumn(
    key: string,
    options?: { title?: string; defaultValue?: string },
  ): TableColumn<CatalogTableRow> {
    function formatContent(keyLabel: string, entity: Entity): string {
      const labels: Record<string, string> | undefined =
        entity.metadata?.labels;
      return (labels && labels[keyLabel]) || '';
    }

    return {
      title: options?.title || (
        <EntityTableColumnTitle translationKey="label" />
      ),
      field: 'entity.metadata.labels',
      cellStyle: {
        padding: '0px 16px 0px 20px',
      },
      customSort({ entity: entity1 }, { entity: entity2 }) {
        return formatContent(key, entity1).localeCompare(
          formatContent(key, entity2),
        );
      },
      render: ({ entity }: { entity: Entity }) => {
        const labels: Record<string, string> | undefined =
          entity.metadata?.labels;
        const specifiedLabelValue =
          (labels && labels[key]) || options?.defaultValue;
        return (
          <>
            {specifiedLabelValue && (
              <Badge key={specifiedLabelValue} variant="outline">
                {specifiedLabelValue}
              </Badge>
            )}
          </>
        );
      },
      width: 'auto',
    };
  },
  createNamespaceColumn(): TableColumn<CatalogTableRow> {
    return {
      title: <EntityTableColumnTitle translationKey="namespace" />,
      field: 'entity.metadata.namespace',
      width: 'auto',
    };
  },
});
