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
  Entity,
  parseEntityRef,
  RELATION_OWNED_BY,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { AlphaEntity } from '@backstage/catalog-model/alpha';
import { EntityFilter, UserListFilterKind } from './types';
import { getEntityRelations } from './utils/getEntityRelations';
import { EntityOrderQuery } from '@backstage/catalog-client';

/**
 * Filter entities based on Kind.
 * @public
 */
export class EntityKindFilter implements EntityFilter {
  readonly value: string;
  readonly label: string;

  constructor(value: string, label: string) {
    this.value = value;
    this.label = label;
  }

  getCatalogFilters(): Record<string, string | string[]> {
    return { kind: this.value };
  }

  toQueryValue(): string {
    return this.value;
  }
}

/**
 * Filters entities based on type
 * @public
 */
export class EntityTypeFilter implements EntityFilter {
  readonly value: string | string[];

  constructor(value: string | string[]) {
    this.value = value;
  }

  // Simplify `string | string[]` for consumers, always returns an array
  getTypes(): string[] {
    return Array.isArray(this.value) ? this.value : [this.value];
  }

  getCatalogFilters(): Record<string, string | string[]> {
    return { 'spec.type': this.getTypes() };
  }

  toQueryValue(): string[] {
    return this.getTypes();
  }
}

/**
 * Filters entities based on tag, with AND semantics across all selected tag values.
 *
 * @remarks
 *
 * When multiple tag values are selected, the user-visible contract is that the
 * displayed list and the displayed count both reflect entities whose
 * `metadata.tags` array contains **all** selected values (logical AND).
 *
 * This AND semantics is enforced by a two-layer design:
 *
 * 1. `filterEntity` uses `Array.prototype.every` to require that every selected
 *    tag value is present in the entity's `metadata.tags`. This is the canonical
 *    source of truth for AND-narrowing the rendered row list.
 *
 * 2. `getCatalogFilters` emits the wire-format-compatible shape
 *    `{ 'metadata.tags': this.values }`. The Backstage catalog backend's
 *    `EntitiesSearchFilter` evaluates this as OR across the listed values
 *    (returning a SUPERSET of the AND-narrowed result). The frontend narrows
 *    the displayed row list via `filterEntity`, and when more than one tag
 *    value is selected `useEntityListProvider` issues a secondary unpaginated
 *    `getEntities` request and applies the same AND predicate to derive the
 *    true global AND-narrowed total. The pagination footer therefore tracks
 *    the rendered row count for any tag combination, and pagination metadata
 *    (next-page availability, offset clamping, `X of N` footers) remains
 *    consistent with the backend's authoritative paginated total whenever no
 *    multi-tag narrowing is active.
 *
 * The wire format `EntityFilterQuery` (in `@backstage/catalog-client`) is
 * `Record<string, string | symbol | (string | symbol)[]>`; same-key values are
 * deduplicated by the backend filter parser into a single `EntitiesSearchFilter`
 * that is evaluated as OR. There is no wire-format path to emit AND across
 * same-key values, which is why the AND-correction lives in the React layer.
 *
 * @public
 */
export class EntityTagFilter implements EntityFilter {
  readonly values: string[];

  constructor(values: string[]) {
    this.values = values;
  }

  /**
   * Returns true when the entity's `metadata.tags` contains **every** selected
   * tag value. This is the source-of-truth AND predicate that anchors both the
   * rendered row list and the displayed count.
   */
  filterEntity(entity: Entity): boolean {
    return this.values.every(v => (entity.metadata.tags ?? []).includes(v));
  }

  /**
   * Emits the wire-format-compatible catalog filter for `metadata.tags`. The
   * backend evaluates this as OR across listed values (returning a superset);
   * the displayed row list is narrowed to AND by `filterEntity`, and the
   * displayed total is narrowed to AND by `useEntityListProvider` via a
   * secondary unpaginated `getEntities` request whenever more than one tag
   * value is selected.
   */
  getCatalogFilters(): Record<string, string | string[]> {
    return { 'metadata.tags': this.values };
  }

  toQueryValue(): string[] {
    return this.values;
  }
}

/**
 * Filters entities where the text matches spec, title or tags.
 * @public
 */
export class EntityTextFilter implements EntityFilter {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  filterEntity(entity: Entity): boolean {
    const words = this.toUpperArray(this.value.split(/\s/));
    const exactMatch = this.toUpperArray([entity.metadata.tags]);
    const partialMatch = this.toUpperArray([
      entity.metadata.name,
      entity.metadata.title,
      (entity.spec?.profile as { displayName?: string })?.displayName,
    ]);

    for (const word of words) {
      if (
        exactMatch.every(m => m !== word) &&
        partialMatch.every(m => !m.includes(word))
      ) {
        return false;
      }
    }

    return true;
  }

  getFullTextFilters() {
    return {
      term: this.value,
      // Update this to be more dynamic based on table columns.
      fields: ['metadata.name', 'metadata.title', 'spec.profile.displayName'],
    };
  }

  toQueryValue() {
    return this.value;
  }

  private toUpperArray(
    value: Array<string | string[] | undefined>,
  ): Array<string> {
    return value
      .flat()
      .filter((m): m is string => Boolean(m))
      .map(m => m.toLocaleUpperCase('en-US'));
  }
}

/**
 * Filter matching entities that are owned by group.
 * @public
 *
 * CAUTION: This class may contain both full and partial entity refs.
 */
export class EntityOwnerFilter implements EntityFilter {
  readonly values: string[];
  constructor(values: string[]) {
    this.values = values.reduce((fullRefs, ref) => {
      // Attempt to remove bad entity references here.
      try {
        fullRefs.push(
          stringifyEntityRef(parseEntityRef(ref, { defaultKind: 'Group' })),
        );
        return fullRefs;
      } catch (err) {
        return fullRefs;
      }
    }, [] as string[]);
  }

  getCatalogFilters(): Record<string, string | string[]> {
    return { 'relations.ownedBy': this.values };
  }

  filterEntity(entity: Entity): boolean {
    return this.values.some(v =>
      getEntityRelations(entity, RELATION_OWNED_BY).some(
        o => stringifyEntityRef(o) === v,
      ),
    );
  }

  /**
   * Get the URL query parameter value. May be a mix of full and humanized entity refs.
   * @returns list of entity refs.
   */
  toQueryValue(): string[] {
    return this.values;
  }
}

/**
 * Filters entities on lifecycle.
 * @public
 */
export class EntityLifecycleFilter implements EntityFilter {
  readonly values: string[];

  constructor(values: string[]) {
    this.values = values;
  }

  getCatalogFilters(): Record<string, string | string[]> {
    return { 'spec.lifecycle': this.values };
  }

  filterEntity(entity: Entity): boolean {
    return this.values.some(v => entity.spec?.lifecycle === v);
  }

  toQueryValue(): string[] {
    return this.values;
  }
}

/**
 * Filters entities to those within the given namespace(s).
 * @public
 */
export class EntityNamespaceFilter implements EntityFilter {
  readonly values: string[];

  constructor(values: string[]) {
    this.values = values;
  }

  getCatalogFilters(): Record<string, string | string[]> {
    return { 'metadata.namespace': this.values };
  }
  filterEntity(entity: Entity): boolean {
    return this.values.some(v => entity.metadata.namespace === v);
  }

  toQueryValue(): string[] {
    return this.values;
  }
}

/**
 * @public
 */
export class EntityUserFilter implements EntityFilter {
  readonly value: UserListFilterKind;
  readonly refs?: string[];

  private constructor(value: UserListFilterKind, refs?: string[]) {
    this.value = value;
    this.refs = refs;
  }

  static owned(ownershipEntityRefs: string[]) {
    return new EntityUserFilter('owned', ownershipEntityRefs);
  }

  static all() {
    return new EntityUserFilter('all');
  }

  static starred(starredEntityRefs: string[]) {
    return new EntityUserFilter('starred', starredEntityRefs);
  }

  getCatalogFilters(): Record<string, string[]> {
    if (this.value === 'owned') {
      return { 'relations.ownedBy': this.refs ?? [] };
    }
    if (this.value === 'starred') {
      return {
        'metadata.name': this.refs?.map(e => parseEntityRef(e).name) ?? [],
      };
    }
    return {};
  }

  filterEntity(entity: Entity) {
    if (this.value === 'starred') {
      return this.refs?.includes(stringifyEntityRef(entity)) ?? true;
    }
    // used only for retro-compatibility with non paginated data.
    // This is supposed to return always true for paginated
    // owned entities, since the filters are applied server side.
    if (this.value === 'owned') {
      const relations = getEntityRelations(entity, RELATION_OWNED_BY);

      return (
        this.refs?.some(v =>
          relations.some(o => stringifyEntityRef(o) === v),
        ) ?? false
      );
    }
    return true;
  }

  toQueryValue(): string {
    return this.value;
  }
}

/**
 * Filters entities based on whatever the user has starred or owns them.
 * @deprecated use EntityUserFilter
 * @public
 */
export class UserListFilter implements EntityFilter {
  readonly value: UserListFilterKind;
  readonly isOwnedEntity: (entity: Entity) => boolean;
  readonly isStarredEntity: (entity: Entity) => boolean;

  constructor(
    value: UserListFilterKind,
    isOwnedEntity: (entity: Entity) => boolean,
    isStarredEntity: (entity: Entity) => boolean,
  ) {
    this.value = value;
    this.isOwnedEntity = isOwnedEntity;
    this.isStarredEntity = isStarredEntity;
  }

  filterEntity(entity: Entity): boolean {
    switch (this.value) {
      case 'owned':
        return this.isOwnedEntity(entity);
      case 'starred':
        return this.isStarredEntity(entity);
      default:
        return true;
    }
  }

  toQueryValue(): string {
    return this.value;
  }
}

/**
 * Filters entities based if it is an orphan or not.
 * @public
 */
export class EntityOrphanFilter implements EntityFilter {
  readonly value: boolean;

  constructor(value: boolean) {
    this.value = value;
  }

  getCatalogFilters(): Record<string, string | string[]> {
    if (this.value) {
      return { 'metadata.annotations.backstage.io/orphan': String(this.value) };
    }
    return {};
  }

  filterEntity(entity: Entity): boolean {
    const orphan = entity.metadata.annotations?.['backstage.io/orphan'];
    return orphan !== undefined && this.value.toString() === orphan;
  }
}

/**
 * Hides entities that do not have `blitzy.io/has-project-history: 'true'`.
 *
 * Filtering is pushed to the catalog API via an annotation-equality filter
 * so pagination counts and per-page row counts reflect the post-filter
 * result. The trade-off is that entities whose annotation is missing (the
 * backend processor has not stamped them yet) are hidden during that
 * backfill window — typically one processor cycle after a backend restart
 * with a fresh cache.
 * @public
 */
export class EntityHasProjectHistoryFilter implements EntityFilter {
  readonly value: boolean;

  constructor(value: boolean) {
    this.value = value;
  }

  getCatalogFilters(): Record<string, string | string[]> {
    if (!this.value) return {};
    return { 'metadata.annotations.blitzy.io/has-project-history': 'true' };
  }

  filterEntity(entity: Entity): boolean {
    if (!this.value) return true;
    return (
      entity.metadata.annotations?.['blitzy.io/has-project-history'] === 'true'
    );
  }
}

/**
 * Filters entities by the `blitzy.com/vertical` label. Multi-select is OR:
 * selecting `banking` and `retail` returns entities in either. When no
 * values are selected the filter is inactive and returned by the picker
 * as `undefined`.
 * @public
 */
export class EntityVerticalFilter implements EntityFilter {
  readonly values: string[];

  constructor(values: string[]) {
    this.values = values;
  }

  getCatalogFilters(): Record<string, string | string[]> {
    if (!this.values.length) return {};
    return { 'metadata.labels.blitzy.com/vertical': this.values };
  }

  filterEntity(entity: Entity): boolean {
    if (!this.values.length) return true;
    const v = entity.metadata.labels?.['blitzy.com/vertical'];
    return v !== undefined && this.values.includes(v);
  }

  toQueryValue(): string[] {
    return this.values;
  }
}

/**
 * Filters entities based on if it has errors or not.
 * @public
 */
export class EntityErrorFilter implements EntityFilter {
  readonly value: boolean;

  constructor(value: boolean) {
    this.value = value;
  }

  filterEntity(entity: Entity): boolean {
    const error =
      ((entity as AlphaEntity)?.status?.items?.length as number) > 0;
    return error !== undefined && this.value === error;
  }
}

/**
 * Sort entities by a given field/column.
 * @public
 */
export class EntityOrderFilter implements EntityFilter {
  readonly values: [string, 'asc' | 'desc'][];

  constructor(values: [string, 'asc' | 'desc'][]) {
    this.values = values;
  }

  getOrderFilters(): EntityOrderQuery {
    return this.values.map(([field, order]) => ({ field, order }));
  }

  toQueryValue(): string[] {
    return this.values.flat();
  }
}
