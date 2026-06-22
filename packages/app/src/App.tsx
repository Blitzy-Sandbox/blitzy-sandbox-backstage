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

import { createApp } from '@backstage/frontend-defaults';
import { guestSignInPageModule } from './GuestSignInPage';
import notFoundErrorPage from './examples/notFoundErrorPageExtension';
import userSettingsPlugin from '@backstage/plugin-user-settings/alpha';

import {
  createFrontendModule,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';

import {
  techdocsPlugin,
  TechDocsReaderPage,
  EntityTechdocsContent,
} from '@backstage/plugin-techdocs';
import appVisualizerPlugin from '@backstage/plugin-app-visualizer';
import {
  techDocsMermaidAddonModule,
  techDocsLightBoxAddonModule,
} from '@backstage/plugin-techdocs-module-addons-contrib/alpha';
import {
  convertLegacyPageExtension,
  convertLegacyPlugin,
} from '@backstage/core-compat-api';
import { convertLegacyEntityContentExtension } from '@backstage/plugin-catalog-react/alpha';
import { pluginInfoResolver } from './pluginInfoResolver';
import { appModuleTopBar } from './modules/appModuleTopBar';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import apiDocsPlugin from '@backstage/plugin-api-docs/alpha';
import searchPlugin from '@backstage/plugin-search/alpha';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleInfo } from '@fortawesome/free-solid-svg-icons';
import { Navigate } from 'react-router-dom';

/*

# Notes

TODO:
 - proper createApp
 - connect extensions and plugins, provide method?
 - higher level API for creating standard extensions + higher order framework API for creating those?
 - extension config schema + validation
 - figure out how to resolve configured extension ref to runtime value, e.g. '@backstage/plugin-graphiql#GraphiqlPage'
 - make sure all shorthands work + tests
 - figure out package structure / how to ship, frontend-plugin-api/frontend-app-api
 - figure out routing, useRouteRef in the new system
 - Legacy plugins / interop
 - dynamic updates, runtime API

*/

/* core */

// const discoverPackages = async () => {
//   // stub for now, deferring package discovery til later
//   return ['@backstage/plugin-graphiql'];
// };

/* graphiql package */

/* app.tsx */

/**
 * Registers the TechDocs reader route and the per-entity TechDocs content
 * extension via the legacy-plugin compatibility utilities. The reader path
 * omits a trailing wildcard because the AppRoutes extension already appends
 * "/*" to every route path.
 */
const convertedTechdocsPlugin = convertLegacyPlugin(techdocsPlugin, {
  extensions: [
    convertLegacyPageExtension(TechDocsReaderPage, {
      name: 'reader',
      path: '/docs/:namespace/:kind/:name',
    }),
    convertLegacyEntityContentExtension(EntityTechdocsContent),
  ],
});

/**
 * Root redirect: the bare URL `/` redirects to `/catalog` so that the Catalog
 * page becomes the application's landing surface after the Dashboard removal.
 *
 * Implementation: a tiny PageBlueprint extension registered at path `/` whose
 * loader resolves to React Router v6's <Navigate to="/catalog" replace />.
 * The `replace` prop ensures the redirect does not leave a navigable
 * "back" entry in the browser history pointing at `/`.
 */
const rootRedirectModule = createFrontendModule({
  pluginId: 'app',
  extensions: [
    PageBlueprint.make({
      name: 'rootRedirect',
      params: {
        path: '/',
        loader: async () => <Navigate to="/catalog" replace />,
      },
    }),
  ],
});

// customize catalog example
const customizedCatalog = catalogPlugin.withOverrides({
  extensions: [
    catalogPlugin.getExtension('entity-content:catalog/overview').override({
      params: {
        icon: <FontAwesomeIcon icon={faCircleInfo} />,
      },
    }),
  ],
});

const notFoundErrorPageModule = createFrontendModule({
  pluginId: 'app',
  extensions: [notFoundErrorPage],
});

const app = createApp({
  features: [
    customizedCatalog,
    convertedTechdocsPlugin,
    userSettingsPlugin,
    appVisualizerPlugin,
    apiDocsPlugin,
    searchPlugin,
    notFoundErrorPageModule,
    appModuleTopBar,
    // rootRedirectModule: redirects bare URL / to /catalog (replaces the
    // deleted dashboard landing).
    rootRedirectModule,
    guestSignInPageModule,
    techDocsMermaidAddonModule,
    techDocsLightBoxAddonModule,
  ],
  advanced: {
    pluginInfoResolver,
  },
  /* Handled through config instead */
  // bindRoutes({ bind }) {
  //   bind(pagesPlugin.externalRoutes, { pageX: pagesPlugin.routes.pageX });
  // },
});

// const legacyApp = createLegacyApp({ plugins: [legacyGraphiqlPlugin] });

export default app.createRoot();

// const routes = (
//   <FlatRoutes>
//     {/* <Route path="/" element={<Navigate to="catalog" />} />
//     <Route path="/catalog" element={<CatalogIndexPage />} />
//     <Route
//       path="/catalog/:namespace/:kind/:name"
//       element={<CatalogEntityPage />}
//     >
//       <EntityLayout>
//         <EntityLayout.Route path="/" title="Overview">
//           <Grid container spacing={3} alignItems="stretch">
//             <Grid item md={6} xs={12}>
//               <EntityAboutCard variant="gridItem" />
//             </Grid>

//             <Grid item md={4} xs={12}>
//               <EntityLinksCard />
//             </Grid>
//           </Grid>
//         </EntityLayout.Route>

//         <EntityLayout.Route path="/todos" title="TODOs">
//           <EntityTodoContent />
//         </EntityLayout.Route>
//       </EntityLayout>
//     </Route>
//     <Route
//       path="/catalog-import"
//       element={
//           <CatalogImportPage />
//       }
//     /> */}
//     {/* <Route
//       path="/tech-radar"
//       element={<TechRadarPage width={1500} height={800} />}
//     /> */}
//     <Route path="/graphiql" element={<GraphiQLPage />} />
//   </FlatRoutes>
// );

// export default app.createRoot(
//   <>
//     {/* <AlertDisplay transientTimeoutMs={2500} />
//     <OAuthRequestDialog /> */}
//     <AppRouter>{routes}</AppRouter>
//   </>,
// );
