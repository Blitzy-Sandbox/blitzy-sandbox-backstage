/*
 * Copyright 2025 The Backstage Authors
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

import { HeaderLabel } from '@backstage/core-components';
import { Entity } from '@backstage/catalog-model';
import { useTranslationRef } from '@backstage/core-plugin-api/alpha';
import { catalogTranslationRef } from '../../translation';

type EntityLabelsProps = {
  entity: Entity;
};

// Per AAP §0.1.3 CRITICAL ("Perform a full removal of this functionality
// across the application") and §0.5.4 ("The HeaderLabel cluster renders
// without the Owner label"), the Owner HeaderLabel — together with the
// embedded EntityRefLinks affordance that navigated to the owning Group
// entity — has been removed from this alpha entity-page header surface.
// Only the Lifecycle HeaderLabel remains.
export function EntityLabels(props: EntityLabelsProps) {
  const { entity } = props;
  const { t } = useTranslationRef(catalogTranslationRef);
  return (
    <>
      {entity.spec?.lifecycle && (
        <HeaderLabel
          label={t('entityLabels.lifecycleLabel')}
          value={entity.spec.lifecycle?.toString()}
        />
      )}
    </>
  );
}
