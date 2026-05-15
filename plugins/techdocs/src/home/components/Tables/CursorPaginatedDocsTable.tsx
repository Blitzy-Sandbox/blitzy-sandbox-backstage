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

import { useState, useEffect, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { Table, TableProps } from '@backstage/core-components';
import { useEntityList } from '@backstage/plugin-catalog-react';
import { DocsTableRow } from './types';
import { DocsTableToolbar } from './DocsTableToolbar';

type PaginatedDocsTableProps = {
  prev?(): void;
  next?(): void;
} & TableProps<DocsTableRow>;

/**
 * @internal
 */
export function CursorPaginatedDocsTable(props: PaginatedDocsTableProps) {
  const { actions, columns, data, next, prev, title, isLoading, options } =
    props;
  const { totalItems, limit } = useEntityList();

  const [pageIndex, setPageIndex] = useState(0);
  const [goToFirst, setGoToFirst] = useState(false);
  const [goToLast, setGoToLast] = useState(false);

  // Reset pageIndex when prev disappears unexpectedly (e.g. filter change resets cursor)
  const prevRef = useRef(prev);
  useEffect(() => {
    if (prevRef.current !== undefined && prev === undefined) {
      setPageIndex(0);
      setGoToFirst(false);
      setGoToLast(false);
    }
    prevRef.current = prev;
  }, [prev]);

  // Step-by-step navigation to first page; re-fires each time prev gets a new
  // reference (i.e. after each successful fetch)
  useEffect(() => {
    if (!goToFirst) return;
    if (!prev) {
      setGoToFirst(false);
      return;
    }
    setPageIndex(i => i - 1);
    prev();
  }, [goToFirst, prev]);

  // Step-by-step navigation to last page
  useEffect(() => {
    if (!goToLast) return;
    if (!next) {
      setGoToLast(false);
      return;
    }
    setPageIndex(i => i + 1);
    next();
  }, [goToLast, next]);

  const handlePrev = () => {
    setGoToFirst(false);
    setGoToLast(false);
    setPageIndex(i => i - 1);
    prev?.();
  };

  const handleNext = () => {
    setGoToFirst(false);
    setGoToLast(false);
    setPageIndex(i => i + 1);
    next?.();
  };

  const handleFirst = () => {
    if (!prev) return;
    setGoToLast(false);
    setGoToFirst(true);
  };

  const handleLast = () => {
    if (!next) return;
    setGoToFirst(false);
    setGoToLast(true);
  };

  const pageSize = limit || data.length;
  const start = pageIndex * pageSize + 1;
  const end = Math.min(
    (pageIndex + 1) * pageSize,
    totalItems ?? start + data.length - 1,
  );

  const btnClass =
    'inline-flex items-center justify-center h-8 w-8 rounded-full hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

  return (
    <div>
      <Table
        title={isLoading ? '' : title}
        columns={columns}
        data={data}
        options={{
          ...options,
          paging: false,
          pageSize: Number.MAX_SAFE_INTEGER,
          emptyRowsWhenPaging: false,
        }}
        actions={actions}
        isLoading={isLoading}
        components={{ Toolbar: DocsTableToolbar }}
      />
      {(prev || next) && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-sm text-muted-foreground">
          <span>
            {totalItems !== undefined
              ? `${start}–${end} of ${totalItems}`
              : `${data.length} items`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="First page"
              disabled={!prev}
              onClick={handleFirst}
              className={btnClass}
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Previous page"
              disabled={!prev}
              onClick={handlePrev}
              className={btnClass}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next page"
              disabled={!next}
              onClick={handleNext}
              className={btnClass}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Last page"
              disabled={!next}
              onClick={handleLast}
              className={btnClass}
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
