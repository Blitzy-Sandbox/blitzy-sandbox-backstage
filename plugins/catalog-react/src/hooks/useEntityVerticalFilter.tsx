/*
 * Copyright 2026 The Backstage Authors
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

import { useEffect, useMemo, useRef, useState } from 'react';
import useAsync from 'react-use/esm/useAsync';
import isEqual from 'lodash/isEqual';
import sortBy from 'lodash/sortBy';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '../api';
import { useEntityList } from './useEntityListProvider';
import { EntityVerticalFilter } from '../filters';

const VERTICAL_FACET = 'metadata.labels.blitzy.com/vertical';

/**
 * Reads the distinct `blitzy.com/vertical` label values across the currently
 * selected kind and exposes them for a picker UI. Mirrors `useEntityTypeFilter`.
 *
 * @public
 */
export function useEntityVerticalFilter(): {
  loading: boolean;
  error?: Error;
  availableVerticals: string[];
  selectedVerticals: string[];
  setSelectedVerticals: (verticals: string[]) => void;
} {
  const catalogApi = useApi(catalogApiRef);
  const {
    filters: { kind: kindFilter, vertical: verticalFilter },
    queryParameters: { vertical: verticalParameter },
    updateFilters,
  } = useEntityList();

  const flattenedQueryVerticals = useMemo(
    () => [verticalParameter].flat().filter(Boolean) as string[],
    [verticalParameter],
  );

  const [selectedVerticals, setSelectedVerticals] = useState(
    flattenedQueryVerticals.length
      ? flattenedQueryVerticals
      : verticalFilter?.values ?? [],
  );

  useEffect(() => {
    if (flattenedQueryVerticals.length) {
      setSelectedVerticals(flattenedQueryVerticals);
    }
  }, [flattenedQueryVerticals]);

  const [availableVerticals, setAvailableVerticals] = useState<string[]>([]);
  const kind = useMemo(() => kindFilter?.value, [kindFilter]);

  const {
    error,
    loading,
    value: facets,
  } = useAsync(async () => {
    if (!kind) return [];
    return catalogApi
      .getEntityFacets({ filter: { kind }, facets: [VERTICAL_FACET] })
      .then(response => response.facets[VERTICAL_FACET] || []);
  }, [kind, catalogApi]);

  const facetsRef = useRef(facets);
  useEffect(() => {
    const oldFacets = facetsRef.current;
    facetsRef.current = facets;
    if (loading || !kind || oldFacets === facets || !facets) return;

    const newVerticals = [
      ...new Set(sortBy(facets, f => -f.count).map(f => f.value)),
    ];
    setAvailableVerticals(newVerticals);

    const stillValid = selectedVerticals.filter(v => newVerticals.includes(v));
    if (!isEqual(selectedVerticals, stillValid)) {
      setSelectedVerticals(stillValid);
    }
  }, [loading, kind, selectedVerticals, facets]);

  useEffect(() => {
    updateFilters({
      vertical: selectedVerticals.length
        ? new EntityVerticalFilter(selectedVerticals)
        : undefined,
    });
  }, [selectedVerticals, updateFilters]);

  return {
    loading,
    error,
    availableVerticals,
    selectedVerticals,
    setSelectedVerticals,
  };
}
