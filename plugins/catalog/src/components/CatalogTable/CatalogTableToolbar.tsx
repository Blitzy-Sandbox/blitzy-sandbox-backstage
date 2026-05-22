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
import { ReactElement } from 'react';
import {
  EntitySearchBar,
  EntityTagPicker,
  EntityTypePicker,
} from '@backstage/plugin-catalog-react';

/** @public */
export type CatalogTableToolbarClassKey = 'root' | 'text';

/**
 * `CatalogTableToolbar` renders the Catalog table's header strip:
 * title text on the left and filter controls (search, type, starred,
 * tags) on the right.
 *
 * Responsive layout strategy (addresses CP8 QA Issue #3 — catalog card
 * horizontal overflow at 375px):
 *
 * - Mobile (<640px / Tailwind `sm`): the toolbar collapses to a vertical
 *   stack — title row first, then filter row beneath it. The filter row
 *   itself uses `flex-wrap` with full-width search so that no control is
 *   clipped or pushed off-screen.
 * - Desktop (≥640px): the original single-row layout is preserved with
 *   the title pinned left and the filter cluster right-aligned via
 *   `sm:justify-end`.
 *
 * Implementation notes:
 *
 * - Outer container uses `flex-col sm:flex-row` to switch orientation at
 *   the `sm:` breakpoint (which Tailwind v4 defaults to 640px). Items
 *   inside continue to use `items-start sm:items-center` so that the
 *   title baseline is preserved on desktop while still allowing the
 *   stacked layout to align cleanly on mobile.
 * - The filter cluster's `min-w-0 sm:min-w-[24rem]` removes the lower
 *   bound on mobile, allowing the cluster to shrink with the viewport,
 *   while keeping a sensible minimum on desktop so controls do not
 *   collapse to unreadable widths at intermediate viewport widths.
 * - The search bar uses `w-full sm:flex-1 sm:max-w-xs` so it fills the
 *   row on mobile (a single primary input) and behaves as a flexible
 *   1-fr column on desktop, capped at `xs` (20rem ≈ 320px) so it does
 *   not dominate the row at very wide viewports.
 * - The tag picker drops its fixed `w-44` and uses `w-32 sm:w-44`
 *   instead so it does not push the row over 375px on mobile while
 *   keeping its previous size on desktop.
 */
export function CatalogTableToolbar(props: {
  title?: string | ReactElement<any>;
}) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 pt-2.5 pl-3 sm:pl-5 pb-1.5 pr-3 sm:pr-4 flex-wrap">
      {/*
       * CP9 QA fix — Issue #11 (MAJOR, WCAG 1.3.1 Info & Relationships):
       *
       * The Catalog page renders an h1 (`Blitzy Sandbox Catalog`) at
       * the top via `PageWithHeader`, so a nested level-2 heading is
       * the correct successor. Previously this element was an `<h5>`,
       * which created a 4-level skip (h1 → h5) that Lighthouse axe-core
       * flagged via the `heading-order` audit. Changing to `<h2>` while
       * preserving the `text-lg font-medium` visual treatment keeps
       * pixel-identical rendering with a semantically-correct heading.
       */}
      <h2 className="truncate text-lg font-medium shrink-0 max-w-full">
        {props.title}
      </h2>
      <div className="flex w-full sm:w-auto sm:flex-1 items-center gap-2 sm:justify-end min-w-0 flex-wrap">
        <div className="w-full sm:flex-1 sm:max-w-xs sm:min-w-[180px]">
          <EntitySearchBar />
        </div>
        <EntityTypePicker inline />
        {/*
         * CP9 QA fix — Issue #5 (MINOR, UX consistency):
         *
         * The `<StarredToggle />` filter button is removed because the
         * companion `FavoriteEntity` star icon on entity pages was
         * removed per AAP §0.5.1.2. With no way to populate the starred
         * set, the filter would always render zero rows and confuse
         * users. Removing the toggle keeps the filter UI honest with
         * the available functionality.
         */}
        <div className="w-32 sm:w-44 shrink-0">
          <EntityTagPicker inline />
        </div>
      </div>
    </div>
  );
}
