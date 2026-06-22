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

import { useCallback } from 'react';

import { RefreshCw, Pencil } from 'lucide-react';

import {
  AppIcon,
  InfoCardVariants,
  Link,
  cn,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  ShadcnButton as Button,
} from '@backstage/core-components';
import {
  alertApiRef,
  errorApiRef,
  useApi,
  useRouteRef,
} from '@backstage/core-plugin-api';
import { useTranslationRef } from '@backstage/core-plugin-api/alpha';

import {
  ScmIntegrationIcon,
  scmIntegrationsApiRef,
} from '@backstage/integration-react';

import {
  ANNOTATION_EDIT_URL,
  ANNOTATION_LOCATION,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import {
  catalogApiRef,
  getEntitySourceLocation,
  useEntity,
} from '@backstage/plugin-catalog-react';
import { useEntityPermission } from '@backstage/plugin-catalog-react/alpha';
import { catalogEntityRefreshPermission } from '@backstage/plugin-catalog-common/alpha';

import { createFromTemplateRouteRef } from '../../routes';
import { catalogTranslationRef } from '../../alpha/translation';
import { useSourceTemplateCompoundEntityRef } from './hooks';
import { AboutContent } from './AboutContent';

export function useCatalogSourceIconLinkProps() {
  const { entity } = useEntity();
  const scmIntegrationsApi = useApi(scmIntegrationsApiRef);
  const { t } = useTranslationRef(catalogTranslationRef);
  const entitySourceLocation = getEntitySourceLocation(
    entity,
    scmIntegrationsApi,
  );
  return {
    label: t('aboutCard.viewSource'),
    disabled: !entitySourceLocation,
    icon: <ScmIntegrationIcon type={entitySourceLocation?.integrationType} />,
    href: entitySourceLocation?.locationTargetUrl,
  };
}

/**
 * Props for {@link EntityAboutCard}.
 *
 * @public
 */
export type AboutCardProps = {
  variant?: InfoCardVariants;
};

export interface InternalAboutCardProps extends AboutCardProps {
  subheader?: JSX.Element;
}

export function InternalAboutCard(props: InternalAboutCardProps) {
  const { variant } = props;
  const { entity } = useEntity();
  const catalogApi = useApi(catalogApiRef);
  const alertApi = useApi(alertApiRef);
  const errorApi = useApi(errorApiRef);
  const templateRoute = useRouteRef(createFromTemplateRouteRef);
  const sourceTemplateRef = useSourceTemplateCompoundEntityRef(entity);
  const { allowed: canRefresh } = useEntityPermission(
    catalogEntityRefreshPermission,
  );
  const { t } = useTranslationRef(catalogTranslationRef);

  const entityMetadataEditUrl =
    entity.metadata.annotations?.[ANNOTATION_EDIT_URL];

  const cardClass = cn(
    variant === 'gridItem' && 'flex flex-col h-[calc(100%-10px)] mb-2.5',
    variant === 'fullHeight' && 'flex flex-col h-full',
  );
  const cardContentClass = cn(
    (variant === 'gridItem' || variant === 'fullHeight') && 'flex-1',
  );

  const entityLocation = entity.metadata.annotations?.[ANNOTATION_LOCATION];
  // Limiting the ability to manually refresh to the less expensive locations
  const allowRefresh =
    entityLocation?.startsWith('url:') || entityLocation?.startsWith('file:');
  const refreshEntity = useCallback(async () => {
    try {
      await catalogApi.refreshEntity(stringifyEntityRef(entity));
      alertApi.post({
        message: t('aboutCard.refreshScheduledMessage'),
        severity: 'info',
        display: 'transient',
      });
    } catch (e) {
      errorApi.post(e);
    }
  }, [catalogApi, entity, alertApi, t, errorApi]);

  return (
    <Card className={cardClass}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-semibold">
          {t('aboutCard.title')}
        </CardTitle>
        <div className="flex items-center gap-1">
          {allowRefresh && canRefresh && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('aboutCard.refreshButtonAriaLabel')}
              title={t('aboutCard.refreshButtonTitle')}
              onClick={refreshEntity}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          {/*
           * QA finding F8 (CP7) — when the Edit Metadata button is
           * disabled (no `backstage.io/edit-url` annotation on the
           * entity), surface a tooltip and an aria-label that explain
           * WHY the action is unavailable. Previously the same generic
           * "Edit Metadata" text was used for both enabled and disabled
           * states, leaving users — especially screen-reader users —
           * with no explanation. The native HTML `title` attribute
           * (consumed by the existing core-components ShadcnButton
           * wrapper) is propagated to the wrapping span so the
           * disabled-state tooltip still appears on hover even though
           * `pointer-events: none` is applied to disabled buttons by
           * the design system. The `aria-label` swap makes the disabled
           * state distinguishable to assistive technology.
           */}
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              entityMetadataEditUrl
                ? t('aboutCard.editButtonAriaLabel')
                : t('aboutCard.editButtonDisabledAriaLabel')
            }
            title={
              entityMetadataEditUrl
                ? t('aboutCard.editButtonTitle')
                : t('aboutCard.editButtonDisabledTitle')
            }
            disabled={!entityMetadataEditUrl}
            asChild={!!entityMetadataEditUrl}
          >
            {entityMetadataEditUrl ? (
              <Link to={entityMetadataEditUrl}>
                <Pencil className="h-4 w-4" />
              </Link>
            ) : (
              <span title={t('aboutCard.editButtonDisabledTitle')}>
                <Pencil className="h-4 w-4" />
              </span>
            )}
          </Button>
          {sourceTemplateRef && templateRoute && (
            <Button
              variant="ghost"
              size="icon"
              title={t('aboutCard.createSimilarButtonTitle')}
              asChild
            >
              <Link
                to={templateRoute({
                  namespace: sourceTemplateRef.namespace,
                  templateName: sourceTemplateRef.name,
                })}
              >
                <AppIcon id="scaffolder" />
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className={cardContentClass}>
        <AboutContent entity={entity} />
      </CardContent>
    </Card>
  );
}

/**
 * Exported publicly via the EntityAboutCard
 *
 * NOTE: We generally do not accept pull requests to extend this class with more
 * props and customizability. If you need to tweak it, consider making a bespoke
 * card in your own repository instead, that is perfect for your own needs.
 */
export function AboutCard(props: AboutCardProps) {
  return <InternalAboutCard {...props} />;
}
