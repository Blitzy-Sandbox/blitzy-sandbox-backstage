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

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Table, TableProps } from '@backstage/core-components';
import { CatalogTableRow } from './types';
import { CatalogTableToolbar } from './CatalogTableToolbar';

type PaginatedCatalogTableProps = {
  prev?(): void;
  next?(): void;
} & TableProps<CatalogTableRow>;

/**
 * @internal
 */
export function CursorPaginatedCatalogTable(props: PaginatedCatalogTableProps) {
  const { columns, data, next, prev, options, ...restProps } = props;

  return (
    <div>
      <Table
        columns={columns}
        data={data}
        options={{
          ...options,
          paging: false,
          pageSize: Number.MAX_SAFE_INTEGER,
          emptyRowsWhenPaging: false,
        }}
        components={{ Toolbar: CatalogTableToolbar }}
        {...restProps}
      />
      {(prev || next) && (
        <div className="flex items-center justify-end border-t border-border px-4 py-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous page"
              disabled={!prev}
              onClick={() => prev?.()}
              className="inline-flex items-center justify-center h-8 w-8 rounded-full hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next page"
              disabled={!next}
              onClick={() => next?.()}
              className="inline-flex items-center justify-center h-8 w-8 rounded-full hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
