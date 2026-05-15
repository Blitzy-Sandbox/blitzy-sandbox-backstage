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

import { useMemo } from 'react';
import { cn, StarIcon } from '@backstage/core-components';
import { useStarredEntities } from '../../hooks';
import { useEntityList } from '../../hooks/useEntityListProvider';
import { EntityUserFilter } from '../../filters';

/** @public */
export const StarredToggle = () => {
  const { filters, updateFilters } = useEntityList();
  const { starredEntities } = useStarredEntities();

  const starredFilter = useMemo(
    () => EntityUserFilter.starred(Array.from(starredEntities)),
    [starredEntities],
  );

  const isActive = filters.user?.value === 'starred';

  const handleToggle = () => {
    updateFilters({ user: isActive ? undefined : starredFilter });
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-pressed={isActive}
      className={cn(
        'flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-input bg-background px-3 py-2 text-sm font-normal shadow-sm text-muted-foreground',
        'transition-colors hover:bg-accent hover:text-accent-foreground',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        isActive && 'bg-accent text-accent-foreground',
      )}
    >
      <StarIcon fontSize="small" />
      <span>Starred</span>
    </button>
  );
};
