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
  Content,
  PageWithHeader,
  TableColumn,
  TableProps,
} from '@backstage/core-components';
import { configApiRef, useApi } from '@backstage/core-plugin-api';
import {
  EntityHasProjectHistoryPicker,
  EntityKindPicker,
  EntityListPagination,
  EntityListProvider,
} from '@backstage/plugin-catalog-react';
import { ReactNode } from 'react';
import { CatalogTable, CatalogTableRow } from '../CatalogTable';
import { catalogTranslationRef } from '../../alpha/translation';
import { useTranslationRef } from '@backstage/core-plugin-api/alpha';
import { CatalogTableColumnsFunc } from '../CatalogTable/types';

/** @internal */
export type BaseCatalogPageProps = {
  content?: ReactNode;
  pagination?: EntityListPagination;
};

/** @internal */
export function BaseCatalogPage(props: BaseCatalogPageProps) {
  const { content = <CatalogTable />, pagination } = props;
  const orgName =
    useApi(configApiRef).getOptionalString('organization.name') ?? 'Backstage';
  const { t } = useTranslationRef(catalogTranslationRef);

  return (
    <PageWithHeader title={t('indexPage.title', { orgName })} themeId="home">
      <Content>
        {/*
         * QA finding F2 (CP7) — the global top-bar (registered by
         * `packages/app/src/modules/appModuleTopBar.tsx`) already mounts a
         * single application-wide Support button sourced from
         * `app.support.items` in app-config. The previous in-page
         * `<ContentHeader><SupportButton>...</SupportButton></ContentHeader>`
         * block rendered a second, redundant Support affordance directly
         * below the top-bar on every catalog page, violating AAP §0.5.1.1
         * ("a single Support button per page"). The ContentHeader wrapper
         * is removed along with the button because the only content it
         * carried was that one button.
         */}
        <EntityListProvider pagination={pagination}>
          <div style={{ display: 'none' }}>
            <EntityKindPicker initialFilter="component" />
            <EntityHasProjectHistoryPicker />
          </div>
          {content}
        </EntityListProvider>
      </Content>
    </PageWithHeader>
  );
}

/**
 * Props for root catalog pages.
 *
 * @public
 */
export interface DefaultCatalogPageProps {
  columns?: TableColumn<CatalogTableRow>[] | CatalogTableColumnsFunc;
  actions?: TableProps<CatalogTableRow>['actions'];
  tableOptions?: TableProps<CatalogTableRow>['options'];
  emptyContent?: ReactNode;
  pagination?: EntityListPagination;
}

export function DefaultCatalogPage(props: DefaultCatalogPageProps) {
  const {
    columns,
    actions,
    tableOptions = {},
    emptyContent,
    pagination,
  } = props;

  return (
    <BaseCatalogPage
      content={
        <CatalogTable
          columns={columns}
          actions={actions}
          tableOptions={tableOptions}
          emptyContent={emptyContent}
        />
      }
      pagination={pagination}
    />
  );
}
