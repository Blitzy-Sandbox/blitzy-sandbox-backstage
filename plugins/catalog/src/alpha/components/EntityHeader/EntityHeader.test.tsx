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

/**
 * Component-level tests for the alpha `EntityHeader`.
 *
 * Scope (per AAP §0.5.1.2 and the Checkpoint 3 review finding):
 *
 *   1. The FavoriteEntity star MUST NOT be rendered next to the entity
 *      title. Previously, `<FavoriteEntity entity={entity} />` was
 *      rendered at the end of the `EntityHeaderTitle` block. The user
 *      requirement "Remove the star icon from the project's title"
 *      mandates a full removal from this surface.
 *
 *   2. The entity display name MUST still render. The star removal
 *      must not regress the title rendering for either entities with
 *      a custom `metadata.title` or entities that fall back to the
 *      kind/name composition.
 *
 *   3. The breadcrumbs subtitle MUST still render when
 *      `parentEntityRelations` matches an entity relation. This guards
 *      against accidental removal of the surrounding subtitle logic
 *      while editing the title block.
 *
 *   4. The EntityContextMenu and entity labels MUST still render so
 *      that catalog navigation, inspect, and unregister flows still
 *      work after the star removal.
 *
 * These tests run as Jest+RTL component tests using
 * `renderInTestApp` and the catalog test API mocks, matching the
 * pattern established in the sibling
 * `plugins/catalog/src/components/EntityLayout/EntityLayout.test.tsx`.
 */

import { Entity } from '@backstage/catalog-model';
import { ApiProvider } from '@backstage/core-app-api';
import { alertApiRef } from '@backstage/core-plugin-api';
import {
  catalogApiRef,
  EntityProvider,
  entityRouteRef,
  starredEntitiesApiRef,
  MockStarredEntitiesApi,
} from '@backstage/plugin-catalog-react';
import { catalogApiMock } from '@backstage/plugin-catalog-react/testUtils';
import { permissionApiRef } from '@backstage/plugin-permission-react';
import { renderInTestApp, TestApiRegistry } from '@backstage/test-utils';
import { mockApis } from '@backstage/frontend-test-utils';
import { screen } from '@testing-library/react';

import { EntityHeader } from './EntityHeader';
import { rootRouteRef, unregisterRedirectRouteRef } from '../../../routes';

describe('alpha EntityHeader', () => {
  const apis = TestApiRegistry.from(
    [catalogApiRef, catalogApiMock()],
    [alertApiRef, mockApis.alert()],
    [starredEntitiesApiRef, new MockStarredEntitiesApi()],
    [permissionApiRef, mockApis.permission()],
  );

  /**
   * Helper that wraps the entity-context provider and the router
   * scaffolding needed for `useRouteRefParams(entityRouteRef)` and the
   * unregister redirect route used inside `EntityHeader`.
   */
  const renderHeader = async (entity: Entity) => {
    await renderInTestApp(
      <ApiProvider apis={apis}>
        <EntityProvider entity={entity}>
          <EntityHeader />
        </EntityProvider>
      </ApiProvider>,
      {
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
          '/catalog': rootRouteRef,
          '/testRoute': unregisterRedirectRouteRef,
        },
      },
    );
  };

  it('renders the entity name when no custom title is set', async () => {
    const entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'my-entity',
        namespace: 'default',
      },
      spec: { type: 'service' },
    } as Entity;

    await renderHeader(entity);

    // The entity display name (or fallback name) must surface in the
    // header. `EntityDisplayName` falls back to the name when no
    // display-name metadata is present, so we assert the literal
    // `my-entity` string is present somewhere in the title surface.
    expect(screen.getByText('my-entity')).toBeInTheDocument();
  });

  it('renders the entity custom title when `metadata.title` is set', async () => {
    const entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'my-entity',
        namespace: 'default',
        title: 'My Pretty Title',
      },
      spec: { type: 'service' },
    } as Entity;

    await renderHeader(entity);

    expect(screen.getByText('My Pretty Title')).toBeInTheDocument();
  });

  it('does NOT render the FavoriteEntity star icon next to the entity title', async () => {
    // Per AAP §0.5.1.2 CRITICAL: "Remove the star icon from the
    // project's title." This test verifies the FavoriteEntity
    // affordance is fully removed from the alpha `EntityHeader` so
    // that the star icon is absent on every alpha-catalog entity
    // page rendered via `customizedCatalog`.
    const entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'my-entity',
        namespace: 'default',
      },
      spec: { type: 'service' },
    } as Entity;

    await renderHeader(entity);

    // The title still renders the entity name.
    expect(screen.getByText('my-entity')).toBeInTheDocument();

    // FavoriteEntity in plugin-catalog-react renders an IconButton
    // with one of the following accessible names depending on
    // starred state. Asserting NONE of these are present locks the
    // removal in place. These selectors mirror the assertions used
    // in EntityLayout.test.tsx for the classic header to keep the
    // contract identical across the alpha + classic surfaces.
    expect(
      screen.queryByRole('button', { name: /favorit/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/add to favorites/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/remove from favorites/i),
    ).not.toBeInTheDocument();

    // Defensive check: the literal "star" / "favorite" wording also
    // must not appear as visible text near the title.
    expect(screen.queryByText(/^Add to favorites$/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/^Remove from favorites$/i),
    ).not.toBeInTheDocument();
  });

  it('renders the parent-entity breadcrumb subtitle when `parentEntityRelations` matches an entity relation', async () => {
    // Guards against accidentally removing the breadcrumb subtitle
    // logic alongside the star removal. The subtitle is computed by
    // `EntityHeaderSubtitle`, which looks up the parent entity via
    // the catalog API; the mock catalog API returns no ancestor by
    // default, so only the direct parent breadcrumb text is asserted
    // here.
    const entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'my-entity',
        namespace: 'default',
        title: 'My Component',
      },
      spec: { type: 'service' },
      relations: [
        {
          type: 'partOf',
          targetRef: 'system:default/my-system',
        },
      ],
    } as Entity;

    await renderInTestApp(
      <ApiProvider apis={apis}>
        <EntityProvider entity={entity}>
          <EntityHeader parentEntityRelations={['partOf']} />
        </EntityProvider>
      </ApiProvider>,
      {
        mountedRoutes: {
          '/catalog/:namespace/:kind/:name': entityRouteRef,
          '/catalog': rootRouteRef,
          '/testRoute': unregisterRedirectRouteRef,
        },
      },
    );

    // Both the entity title and the parent breadcrumb must be
    // visible — title removal must not regress the subtitle path.
    expect(screen.getByText('My Component')).toBeInTheDocument();
    expect(screen.getByText('my-system')).toBeInTheDocument();
  });

  it('renders the EntityContextMenu (inspect / unregister) trigger', async () => {
    // Verifies that the surrounding header chrome — the context-menu
    // trigger consumers rely on for inspect and unregister flows —
    // still renders after the star removal. This is the same
    // `menu-button` selector used by `EntityLayout.test.tsx`.
    const entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'my-entity',
        namespace: 'default',
      },
      spec: { type: 'service' },
    } as Entity;

    await renderHeader(entity);

    // The EntityContextMenu trigger is identified by the same
    // `menu-button` test id used in EntityLayout.test.tsx.
    expect(screen.queryAllByTestId('menu-button').length).toBeGreaterThan(0);
  });
});
