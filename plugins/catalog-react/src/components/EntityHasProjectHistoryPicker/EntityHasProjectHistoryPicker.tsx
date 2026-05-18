/*
 * Copyright 2024 The Backstage Authors
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

import { useEffect } from 'react';
import { EntityHasProjectHistoryFilter } from '../../filters';
import { useEntityList } from '../../hooks';

/**
 * Props for {@link EntityHasProjectHistoryPicker}.
 *
 * @public
 */
export interface EntityHasProjectHistoryPickerProps {
  /**
   * If `true`, mounts an active `EntityHasProjectHistoryFilter(true)` on the
   * surrounding `EntityListProvider`. Pass `false` (or omit the picker) to
   * leave the filter unset.
   */
  initialFilter?: boolean;
}

/**
 * Headless picker that installs an `EntityHasProjectHistoryFilter` into the
 * surrounding `EntityListProvider`. When active, the filter hides catalog
 * entities whose `blitzy.io/has-project-history` annotation is explicitly
 * `'false'`.
 *
 * Renders nothing — mount it inside `BaseCatalogPage`'s hidden filter slot
 * to apply the filter silently and unconditionally.
 *
 * @public
 */
export const EntityHasProjectHistoryPicker = (
  props: EntityHasProjectHistoryPickerProps,
) => {
  const { initialFilter = true } = props;
  const { updateFilters } = useEntityList();

  useEffect(() => {
    updateFilters({
      hasProjectHistory: initialFilter
        ? new EntityHasProjectHistoryFilter(true)
        : undefined,
    });
  }, [initialFilter, updateFilters]);

  return null;
};
