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

import { Search, X } from 'lucide-react';
import { cn } from '@backstage/core-components';
import { useEffect, useMemo, useState } from 'react';
import useDebounce from 'react-use/lib/useDebounce';
import { useEntityList } from '../../hooks/useEntityListProvider';
import { EntityTextFilter } from '../../filters';
import { catalogReactTranslationRef } from '../../translation';
import { useTranslationRef } from '@backstage/core-plugin-api/alpha';

/** @public */
export type CatalogReactEntitySearchBarClassKey = 'searchToolbar' | 'input';

/**
 * Renders search bar for filtering the entity list.
 * @public
 */
export const EntitySearchBar = () => {
  const { t } = useTranslationRef(catalogReactTranslationRef);

  const {
    updateFilters,
    queryParameters: { text: textParameter },
  } = useEntityList();

  const queryParamTextFilter = useMemo(
    () => [textParameter].flat()[0],
    [textParameter],
  );

  const [search, setSearch] = useState(queryParamTextFilter ?? '');

  useDebounce(
    () => {
      updateFilters({
        text: search.length ? new EntityTextFilter(search) : undefined,
      });
    },
    250,
    [search, updateFilters],
  );

  useEffect(() => {
    if (queryParamTextFilter) {
      setSearch(queryParamTextFilter);
    }
  }, [queryParamTextFilter]);

  return (
    <div className={cn('flex items-center px-0 py-0')}>
      <div className="relative w-full">
        {/*
         * CP9 QA fix — Issue #19 (LOW, a11y best practice + Chrome
         * DevTools form-field check):
         *
         * The catalog search `<input>` previously relied on
         * `aria-label="search"` for its accessible name. That alone is
         * WCAG-acceptable (SC 4.1.2), but Chrome DevTools' Issues panel
         * still flags the form field as lacking an associated
         * `<label for="...">` element. Adding a visually-hidden
         * `<label htmlFor>` paired with `id="input-with-icon-adornment"`
         * satisfies both requirements: screen readers continue to
         * announce the field correctly, and tooling no longer reports a
         * label-association defect. The label text is sourced from the
         * existing translation namespace so it remains localized.
         */}
        <label htmlFor="input-with-icon-adornment" className="sr-only">
          {t('entitySearchBar.placeholder')}
        </label>
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          aria-label={t('entitySearchBar.placeholder')}
          id="input-with-icon-adornment"
          className={cn(
            'flex h-9 w-full rounded-lg border border-input bg-background py-2 text-sm shadow-sm transition-colors',
            'pl-8 pr-8',
            'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
          placeholder={t('entitySearchBar.placeholder')}
          autoComplete="off"
          onChange={event => setSearch(event.target.value)}
          value={search}
        />
        <button
          type="button"
          aria-label="clear search"
          className={cn(
            'absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center',
            'h-7 w-7 rounded-md transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            search.length === 0 && 'pointer-events-none opacity-50',
          )}
          onClick={() => setSearch('')}
          disabled={search.length === 0}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
