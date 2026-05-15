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

import { Share } from 'lucide-react';
import { AlertApi } from '@backstage/core-plugin-api';
import { DocsTableRow } from './types';
import { FavoriteToggleIcon } from '@backstage/core-components';

/**
 * Not directly exported, but through DocsTable.actions and EntityListDocsTable.actions
 *
 * @public
 */
export const actionFactories = {
  createCopyDocsUrlAction(alertApi: AlertApi) {
    return (row: DocsTableRow) => {
      return {
        icon: () => <Share className="h-4 w-4" />,
        tooltip: 'Copy link to clipboard',
        onClick: () => {
          const url = `${window.location.origin}${row.resolved.docsUrl}`;
          window.navigator.clipboard.writeText(url).then(
            () =>
              alertApi.post({
                message: 'Documentation link copied to clipboard',
                severity: 'success',
                display: 'transient',
              }),
            () =>
              alertApi.post({
                message: 'Failed to copy link to clipboard',
                severity: 'error',
              }),
          );
        },
      };
    };
  },
  createStarEntityAction(
    isStarredEntity: Function,
    toggleStarredEntity: Function,
  ) {
    return (row: DocsTableRow) => {
      const entity = row.entity;
      const isStarred = isStarredEntity(entity);
      return {
        icon: () => <FavoriteToggleIcon isFavorite={isStarred} />,
        tooltip: isStarred ? 'Remove from favorites' : 'Add to favorites',
        onClick: () => toggleStarredEntity(entity),
        active: isStarred,
      };
    };
  },
};
